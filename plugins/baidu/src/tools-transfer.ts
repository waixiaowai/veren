/**
 * 传输工具：本地上传（工作区相对或绝对路径）与远端下载。同名冲突默认
 * 失败；overwrite 只有在用户明确同意后才能传——技能纪律把确认责任放在
 * 调用之前。下载的本地父目录必须已存在，半成品一律清理。
 * The transfer tools: local upload (workspace-relative or absolute) and
 * remote download. Same-named conflicts fail by default; overwrite may only
 * be passed after the user explicitly agreed — the skill discipline puts the
 * confirmation before the call. Downloads demand an existing local parent
 * and clean up all partials.
 *
 * @module @veren/baidu-pan
 */
import { access } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { baiduPanError } from './errors.js'
import { downloadFile } from './download.js'
import { uploadFile } from './upload.js'
import { fileMetas } from './files-client.js'
import { displayPath, foldErrors, formatBytes, outputOneOf, requireLocalPath, requirePath, resolveEntries, textBlock, type ExecFace } from './toolkit.js'
import type { BaiduPanWorld } from './world.js'

/** ok 规范值的 schema 面（传输）。The ok value's schema faces (transfer). */
const UPLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    action: { type: 'string', required: true, enum: ['created', 'renamed', 'overwritten', 'fast-uploaded'] },
    fsid: { type: 'string', required: true },
    path: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
  },
} as const

const DOWNLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    path: { type: 'string', required: true },
    localPath: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
  },
} as const

/** 上传/下载工具参数的 wire 形态。The upload/download arguments' wire shape. */
interface UploadArgs {
  readonly local_path: string
  readonly remote_path: string
  readonly overwrite?: boolean
}

interface DownloadArgs {
  readonly remote_path: string
  readonly local_path: string
  readonly overwrite?: boolean
}

/** 上传渲染：落点 + 动作 + 大小。The upload render: landing + action + size. */
function renderUpload(value: unknown): string {
  const data = value as { kind?: string; action?: string; path?: string; bytes?: number }
  if (data.kind !== 'ok') return JSON.stringify(value)
  const action = { created: '已创建', renamed: '已改名保存', overwritten: '已覆盖', 'fast-uploaded': '秒传完成' }[data.action ?? 'created'] ?? '已保存'
  return `上传完成 / uploaded（${action}）：${displayPath(data.path ?? '')}（${formatBytes(data.bytes ?? 0)}）`
}

/** 下载渲染：本地落点 + 大小。The download render: local landing + size. */
function renderDownload(value: unknown): string {
  const data = value as { kind?: string; path?: string; localPath?: string; bytes?: number }
  if (data.kind !== 'ok') return JSON.stringify(value)
  return `下载完成 / downloaded：${data.localPath ?? ''}（来自 ${displayPath(data.path ?? '')}，${formatBytes(data.bytes ?? 0)}）`
}

/** 本地路径是否已存在（access 探测，ENOENT 之外的原样上抛）。Whether the local path exists (access probe; anything beyond ENOENT propagates). */
async function pathExists(localPath: string): Promise<boolean> {
  try {
    await access(localPath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** 本地落点的占用检查：已存在且未获覆盖同意 → 需要确认。The local-landing occupancy check: existing without overwrite consent → confirmation needed. */
async function requireLocalFree(localPath: string, overwrite: boolean): Promise<void> {
  if (await pathExists(localPath) && !overwrite) {
    throw baiduPanError('BDPAN_CONFIRM_REQUIRED', { retryable: true, detail: `local file exists: ${localPath}` })
  }
}

/** 上传的执行闭包。The upload execute closure. */
function uploadExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: UploadArgs, exec: ExecFace) => {
    const localPath = requireLocalPath(world, exec.agent?.id, args.local_path)
    const remotePath = requirePath(world, args.remote_path)
    const receipt = await uploadFile(world.client, {
      localPath,
      remotePath,
      ...(args.overwrite === true ? { conflictPolicy: 'overwrite' as const } : {}),
    })
    const action: 'fast-uploaded' | 'overwritten' | 'created' = receipt.viaFastUpload ? 'fast-uploaded' : args.overwrite === true ? 'overwritten' : 'created'
    return { kind: 'ok' as const, action, fsid: receipt.fsid, path: receipt.path, bytes: receipt.bytes }
  })
}

/** 下载的执行闭包：守门 → 定位条目 → 占用检查 → 直链流式落盘。The download execute closure: gate → locate the entry → occupancy check → stream via the dlink. */
function downloadExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: DownloadArgs, exec: ExecFace) => {
    const remotePath = requirePath(world, args.remote_path)
    const localPath = requireLocalPath(world, exec.agent?.id, args.local_path)
    const [entry] = await resolveEntries(world, [remotePath])
    if (entry === undefined) throw baiduPanError('BDPAN_NOT_FOUND', { detail: remotePath })
    if (entry.isDir) throw baiduPanError('BDPAN_CONTENT_UNSUPPORTED', { detail: 'directories cannot be downloaded file-by-file' })
    await requireLocalFree(localPath, args.overwrite === true)
    const [meta] = await fileMetas(world.client, { fsids: [entry.fsid] })
    if (meta === undefined) throw baiduPanError('BDPAN_NOT_FOUND', { detail: remotePath })
    const receipt = await downloadFile(world.client, { meta, localPath })
    return { kind: 'ok' as const, path: receipt.path, localPath: receipt.localPath, bytes: receipt.bytes }
  })
}

/** upload 工具定义。The upload tool definition. */
function uploadTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__upload',
    description: 'Upload one local file into the Baidu Netdisk authorized root. local_path may be workspace-relative (the calling session\'s workspace) or absolute; remote_path lands inside the root. Same-named conflicts fail with BDPAN_ALREADY_EXISTS; pass overwrite=true ONLY after the user explicitly agreed to replace that exact file. Slices at 4 MiB with fast-upload support.',
    parameters: {
      local_path: { type: 'string', required: true, description: 'Local file path: workspace-relative or absolute; must be a regular file' },
      remote_path: { type: 'string', required: true, description: 'Remote file path inside the authorized root' },
      overwrite: { type: 'boolean', description: 'Replace an existing same-named remote file; requires prior user confirmation' },
    },
    timeoutMs: 600_000,
    output: { schema: outputOneOf(UPLOAD_SCHEMA), render: (_args, value) => textBlock(renderUpload(value)) },
    execute: uploadExecute(world),
  })
}

/** download 工具定义。The download tool definition. */
function downloadTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__download',
    description: 'Download one file from the authorized root to a local path (workspace-relative or absolute). The local parent directory must already exist; an existing local file fails with BDPAN_CONFIRM_REQUIRED unless the user agreed to overwrite. Directories cannot be downloaded — pick individual files.',
    parameters: {
      remote_path: { type: 'string', required: true, description: 'Remote file path inside the authorized root' },
      local_path: { type: 'string', required: true, description: 'Local landing path: workspace-relative or absolute (file, not directory)' },
      overwrite: { type: 'boolean', description: 'Replace an existing local file; requires prior user confirmation' },
    },
    timeoutMs: 600_000,
    output: { schema: outputOneOf(DOWNLOAD_SCHEMA), render: (_args, value) => textBlock(renderDownload(value)) },
    execute: downloadExecute(world),
  })
}

/**
 * 在当前作用域注册上传与下载工具；逆序清理，随作用域卸载不泄漏。
 * Registers the upload and download tools on the calling scope;
 * reverse-order disposal, no leak when the scope unloads.
 */
export function registerTransferTools(ctx: Context, world: BaiduPanWorld): () => void {
  const tools = [uploadTool(world), downloadTool(world)]
  const disposers = tools.map(tool => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
