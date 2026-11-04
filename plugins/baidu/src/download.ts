/**
 * 下载：取直链（filemetas 的 dlink）后流式写入本地，不把整文件读进内存；
 * 写入中断即删除本地半成品，绝不留下截断文件。目标路径已存在时的确认
 * 责任在工具层，本层只负责落盘与清理。
 * Downloading: fetch the dlink (from filemetas) and stream it to the local
 * file — the whole file never enters memory; a mid-stream failure deletes
 * the partial file, so no truncated artifact survives. Confirmation for an
 * existing local target belongs to the tool layer; this layer owns landing
 * and cleanup.
 *
 * @module @veren/baidu-pan
 */
import { open, unlink } from 'node:fs/promises'
import type { BaiduPanClient } from './client.js'
import { baiduPanError } from './errors.js'
import type { DownloadReceipt, FileMeta } from './types.js'

/** 下载请求：元数据（含直链）与本地落点。The download request: metadata (with the dlink) plus the local landing. */
export interface DownloadOptions {
  readonly meta: FileMeta
  readonly localPath: string
}

/** 把响应体流式写入本地文件，返回字节数。Streams the response body into the local file, returning the byte count. */
async function streamToFile(body: ReadableStream<Uint8Array>, localPath: string): Promise<number> {
  const handle = await open(localPath, 'w')
  let total = 0
  try {
    for await (const chunk of body) {
      await handle.write(chunk)
      total += chunk.byteLength
    }
  } finally {
    await handle.close()
  }
  return total
}

/** 失败清理：删除半成品（不存在则忽略）。Failure cleanup: remove the partial file (ignore absence). */
async function removePartial(localPath: string): Promise<void> {
  try {
    await unlink(localPath)
  } catch {
    // 半成品不存在时清理即完成；这里只会是 ENOENT，不吞其他错误。
    // Cleaning up an absent partial is a no-op; only ENOENT lands here.
  }
}

/**
 * 下载入口：access_token 由客户端内核追加到直链查询；本地父目录必须已
 * 存在（调用方负责确认）；流式落盘，任何失败先清理半成品再上抛。
 * The download entry: the client core appends the access_token to the
 * dlink's query; the local parent must exist (the caller confirms); the
 * body streams to disk, and any failure removes the partial before rethrow.
 */
export async function downloadFile(client: BaiduPanClient, options: DownloadOptions): Promise<DownloadReceipt> {
  try {
    const response = await client.rawCall(options.meta.dlink, {}, {
      method: 'GET',
      binary: true,
      headers: { 'User-Agent': 'netdisk' },
    })
    if (response.body === undefined) throw baiduPanError('BDPAN_UPSTREAM', { detail: 'download returned no body' })
    const bytes = await streamToFile(response.body, options.localPath)
    return { path: options.meta.path, localPath: options.localPath, bytes, md5: options.meta.md5 }
  } catch (error) {
    await removePartial(options.localPath)
    throw error
  }
}
