/**
 * 上传编排：预创建 →（秒传命中即返回）→ 缺失分片逐一上传 → 创建文件。
 * 分片默认 4 MiB；创建一步不参与网络层重试——超时属于"结果不确定"，
 * 禁止盲目重发以免产生重复文件，折成 BDPAN_OUTPUT_UNCERTAIN 交调用方确认。
 * The upload orchestration: precreate → (fast-upload hit returns early) →
 * upload the missing slices one by one → create. Slices default to 4 MiB;
 * the create step is exempt from network-layer retries — a timeout there is
 * an uncertain outcome, and blind re-sending is forbidden (duplicate files),
 * so it folds into BDPAN_OUTPUT_UNCERTAIN for the caller to verify.
 *
 * @module @veren/baidu-pan
 */
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, openSync, readSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { BaiduPanClient } from './client.js'
import { API_BASE } from './config.js'
import { BaiduPanError, baiduPanError } from './errors.js'
import type { UploadReceipt } from './types.js'

/** 分片上传基址（d.pcs.baidu.com，与 xpan API 主机不同）。The slice-upload base (d.pcs.baidu.com, a different host than the xpan API). */
export const SLICE_BASE = 'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2'

/** 本地文件事实：大小与逐分片 MD5。The local-file facts: size plus per-slice MD5s. */
export interface LocalFacts {
  readonly bytes: number
  readonly blocks: readonly string[]
}

/** 冲突策略（缺省 fail：同名返回已存在而不覆盖）。The conflict policy (fail by default: same-named fails instead of overwriting). */
export type ConflictPolicy = 'fail' | 'rename' | 'overwrite'

/** 上传请求。The upload request. */
export interface UploadOptions {
  readonly localPath: string
  readonly remotePath: string
  readonly sliceBytes?: number
  readonly conflictPolicy?: ConflictPolicy
}

/** precreate 响应的形状守卫。The precreate response shape guard. */
function parsePrecreate(json: Record<string, unknown>): { fastUpload: boolean; uploadId: string; missingBlocks: number[]; fsid?: string } {
  const uploadId = json['uploadid']
  const blockList = json['block_list']
  if (json['return_type'] === 2) {
    const fsId = json['fs_id']
    if (fsId === undefined) throw baiduPanError('BDPAN_UPSTREAM', { detail: 'fast-upload returned no fs_id' })
    return { fastUpload: true, uploadId: '', missingBlocks: [], fsid: String(fsId) }
  }
  if (typeof uploadId !== 'string' || uploadId.length === 0 || !Array.isArray(blockList)) {
    throw baiduPanError('BDPAN_UPSTREAM', { detail: 'precreate payload missing uploadid/block_list' })
  }
  const missingBlocks = blockList.filter((item): item is number => typeof item === 'number')
  return { fastUpload: false, uploadId, missingBlocks, fsid: undefined }
}

/** 读取本地文件事实：大小 + 逐分片 MD5；非普通文件在此响亮失败。Reads the local facts: size plus per-slice MD5s; a non-regular file fails loudly here. */
export async function readLocalFacts(localPath: string, sliceBytes: number): Promise<LocalFacts> {
  const stats = await stat(localPath)
  if (!stats.isFile()) throw baiduPanError('BDPAN_INVALID_ARG', { detail: `${localPath} is not a regular file` })
  const blocks: string[] = []
  const stream = createReadStream(localPath, { highWaterMark: sliceBytes })
  for await (const chunk of stream) blocks.push(createHash('md5').update(chunk as Buffer).digest('hex'))
  return { bytes: stats.size, blocks }
}

/** rtype：官方冲突策略码（0 失败 / 1 改名 / 3 覆盖）。The rtype: the official conflict codes (0 fail / 1 rename / 3 overwrite). */
function rtypeOf(policy: ConflictPolicy): string {
  return policy === 'rename' ? '1' : policy === 'overwrite' ? '3' : '0'
}

/** 预创建：携带逐分片 MD5，服务端决定秒传或列缺失分片。The precreate: carries the per-slice MD5s; the server answers fast-upload or the missing slices. */
async function precreate(client: BaiduPanClient, options: UploadOptions, facts: LocalFacts): Promise<ReturnType<typeof parsePrecreate>> {
  const response = await client.call('xpan/file', {
    method: 'precreate',
    path: options.remotePath,
    size: String(facts.bytes),
    isdir: '0',
    block_list: JSON.stringify(facts.blocks),
    rtype: rtypeOf(options.conflictPolicy ?? 'fail'),
  }, { method: 'POST' })
  return parsePrecreate(response.json)
}

/** 上传单个分片（multipart object 形态）。Uploads one slice (the multipart object form). */
async function uploadSlice(client: BaiduPanClient, remotePath: string, uploadId: string, seq: number, slice: Buffer): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(slice)]), 'blob')
  const response = await client.rawCall(SLICE_BASE, {
    method: 'upload',
    type: 'object',
    uploadid: uploadId,
    path: remotePath,
    partseq: String(seq),
  }, { method: 'POST', multipart: form })
  const md5 = response.json['md5']
  if (typeof md5 !== 'string' || md5.length === 0) throw baiduPanError('BDPAN_UPSTREAM', { detail: `slice ${seq} returned no md5` })
  return md5
}

/** 创建文件（收尾一步）：不参与网络重试；网络失败折成"结果不确定"。Creates the file (the closing step): no network retries; a network failure folds into "uncertain outcome". */
async function createFile(client: BaiduPanClient, options: UploadOptions, facts: LocalFacts, uploadId: string, partMd5s: readonly string[]): Promise<UploadReceipt> {
  try {
    const response = await client.rawCall(`${API_BASE}/xpan/file`, {
      method: 'create',
      path: options.remotePath,
      size: String(facts.bytes),
      uploadid: uploadId,
      block_list: JSON.stringify(partMd5s),
      rtype: rtypeOf(options.conflictPolicy ?? 'fail'),
    }, { method: 'POST' })
    const fsId = response.json['fs_id']
    if (fsId === undefined) throw baiduPanError('BDPAN_OUTPUT_UNCERTAIN', { retryable: true, detail: 'create returned no fs_id; verify the remote path before retrying' })
    return {
      fsid: String(fsId),
      path: options.remotePath,
      bytes: facts.bytes,
      md5: typeof response.json['md5'] === 'string' ? response.json['md5'] : '',
      viaFastUpload: false,
    }
  } catch (error) {
    // 只有网络类失败才折成结果不确定；errno 类失败原样上抛。
    // Only network-class failures fold into "uncertain"; errno failures propagate verbatim.
    if (error instanceof BaiduPanError && error.code === 'BDPAN_NETWORK') {
      throw baiduPanError('BDPAN_OUTPUT_UNCERTAIN', { retryable: true, detail: 'network failed during create; verify the remote path first', cause: error })
    }
    throw error
  }
}

/** 读取第 seq 个分片（同步随机读，调用方持有句柄）。Reads the seq-th slice (sync random read; the caller owns the handle). */
function readSlice(handle: number, seq: number, sliceBytes: number): Buffer {
  const buffer = Buffer.alloc(sliceBytes)
  const bytesRead = readSync(handle, buffer, 0, sliceBytes, seq * sliceBytes)
  return buffer.subarray(0, bytesRead)
}

/**
 * 上传入口：三段式编排；秒传直接回执，分片只传服务端缺失的序号。
 * The upload entry: the three-phase orchestration; fast-upload returns
 * directly, and only the server-missing slice indexes get uploaded.
 */
export async function uploadFile(client: BaiduPanClient, options: UploadOptions): Promise<UploadReceipt> {
  const sliceBytes = options.sliceBytes ?? 4 * 1024 * 1024
  const facts = await readLocalFacts(options.localPath, sliceBytes)
  const pre = await precreate(client, options, facts)
  if (pre.fastUpload && pre.fsid !== undefined) {
    return { fsid: pre.fsid, path: options.remotePath, bytes: facts.bytes, md5: facts.blocks[0] ?? '', viaFastUpload: true }
  }
  const handle = openSync(options.localPath, 'r')
  try {
    const partMd5s: string[] = []
    for (const seq of pre.missingBlocks) {
      partMd5s.push(await uploadSlice(client, options.remotePath, pre.uploadId, seq, readSlice(handle, seq, sliceBytes)))
    }
    return await createFile(client, options, facts, pre.uploadId, partMd5s)
  } finally {
    closeSync(handle)
  }
}
