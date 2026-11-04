/**
 * 数据文件服务：列表、预览、下载路径解析与越界防护（design/api.md §7–§8）。
 * The data-file service: listing, preview, download path resolution and the
 * escape guard (design api.md §7–§8).
 *
 * @module @veren/crawler/control/data
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { CrawlerError } from '../errors.ts'

/** 数据文件列表项 / one data-file list entry */
export interface DataFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: string
  fileType: string
}

/** 越界访问 / the out-of-root escape error */
function pathOutOfRoot(): CrawlerError {
  return new CrawlerError('DATA_PATH_OUT_OF_ROOT', '无权访问该路径', {})
}

/** 文件不存在 / the missing-file error */
function fileNotFound(path: string): CrawlerError {
  return new CrawlerError('DATA_FILE_NOT_FOUND', '数据文件不存在', { path })
}

/**
 * 把请求的相对路径解析到数据根内；越界即拒绝。
 * Resolves the requested relative path inside the data root; escapes are
 * rejected.
 */
export function resolveWithinRoot(dataRoot: string, relativePath: string): string {
  const root = resolve(dataRoot)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + sep)) throw pathOutOfRoot()
  return target
}

/** 递归列出数据根下的全部文件 / recursively list all files under the data root */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

/**
 * 列出数据根下的数据文件（含相对路径与类型）。
 * Lists the data files under the data root (relative paths and types).
 */
export async function listDataFiles(dataRoot: string): Promise<DataFileInfo[]> {
  const root = resolve(dataRoot)
  const files = await walk(root)
  const infos: DataFileInfo[] = []
  for (const full of files) {
    const info = await stat(full).catch(() => null)
    if (info === null) continue
    infos.push({
      name: basename(full),
      path: full.slice(root.length + 1),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      fileType: extname(full).replace(/^\./, ''),
    })
  }
  return infos.sort((a, b) => a.path.localeCompare(b.path))
}

/** 预览载荷：文本行或 JSON 数组 / the preview payload: text lines or a json array */
export interface DataPreview {
  data: Record<string, unknown>[]
  total: number
}

/**
 * 读取并预览一个数据文件：json 解析为数组，jsonl 逐行解析，其余按文本行。
 * Reads and previews one data file: json parses as an array, jsonl per
 * line, everything else as text lines.
 */
export async function previewDataFile(dataRoot: string, relativePath: string, limit: number): Promise<DataPreview> {
  const file = resolveWithinRoot(dataRoot, relativePath)
  const text = await readFile(file, 'utf8').catch(() => {
    throw fileNotFound(relativePath)
  })
  return parsePreview(text, limit)
}

/** 解析预览内容 / parse the preview content */
function parsePreview(text: string, limit: number): DataPreview {
  const lines = text.trim().split('\n').filter((line) => line.length > 0)
  const rows: Record<string, unknown>[] = []
  for (const line of lines) {
    const parsed: unknown = tryJson(line)
    if (Array.isArray(parsed)) rows.push(...(parsed as Record<string, unknown>[]))
    else if (parsed !== null) rows.push(parsed as Record<string, unknown>)
    else rows.push({ text: line })
    if (rows.length >= limit) break
  }
  return { data: rows.slice(0, limit), total: rows.length }
}

/** 尽力 JSON 解析 / best-effort JSON parse */
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** 读取文件字节（下载用）；越界与缺失照常拒绝 / read file bytes (for download); escapes and misses reject as usual */
export async function readDataFile(dataRoot: string, relativePath: string): Promise<Buffer> {
  const file = resolveWithinRoot(dataRoot, relativePath)
  return await readFile(file).catch(() => {
    throw fileNotFound(relativePath)
  })
}
