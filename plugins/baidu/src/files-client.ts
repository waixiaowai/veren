/**
 * 文件能力：列目录、关键字检索、元数据（含下载直链）、建目录与文件管理
 * （复制/移动/重命名/删除）。条目形状一律先守卫再返回；文件标识统一转
 * 字符串，杜绝大整数精度丢失。
 * The file capabilities: directory listing, keyword search, metadata (with
 * the download dlink), mkdir, and file management (copy/move/rename/delete).
 * Every entry is shape-guarded before it returns; file ids normalize to
 * strings so no bigint precision is lost.
 *
 * @module @veren/baidu-pan
 */
import type { BaiduPanClient } from './client.js'
import { baiduPanError } from './errors.js'
import type { FileCategory, FileEntry, FileMeta } from './types.js'

/** xpan list/filesearch 条目的原始形状。The raw xpan list/filesearch entry shape. */
interface RawEntry {
  readonly fs_id?: unknown
  readonly path?: unknown
  readonly server_filename?: unknown
  readonly isdir?: unknown
  readonly size?: unknown
  readonly category?: unknown
  readonly md5?: unknown
  readonly server_mtime?: unknown
  readonly server_ctime?: unknown
  readonly dlink?: unknown
}

/** 单个条目的形状守卫：fsid 与 path 必有，其余取安全缺省。The per-entry shape guard: fsid and path required, the rest take safe defaults. */
function parseEntry(raw: RawEntry, wantDlink: boolean): FileEntry | FileMeta | undefined {
  if (typeof raw.path !== 'string' || raw.path.length === 0) return undefined
  const fsid = raw.fs_id === undefined ? undefined : String(raw.fs_id)
  if (fsid === undefined || fsid.length === 0) return undefined
  const base: FileEntry = {
    fsid,
    path: raw.path,
    name: typeof raw.server_filename === 'string' ? raw.server_filename : raw.path.split('/').pop() ?? raw.path,
    isDir: raw.isdir === 1 || raw.isdir === true,
    size: typeof raw.size === 'number' && raw.size >= 0 ? raw.size : 0,
    category: (typeof raw.category === 'number' && raw.category >= 0 && raw.category <= 7
      ? raw.category : 0) as FileCategory,
    md5: typeof raw.md5 === 'string' ? raw.md5 : '',
    serverMtime: typeof raw.server_mtime === 'number' ? raw.server_mtime : 0,
    serverCtime: typeof raw.server_ctime === 'number' ? raw.server_ctime : 0,
  }
  if (!wantDlink) return base
  if (typeof raw.dlink !== 'string' || raw.dlink.length === 0) return undefined
  return { ...base, dlink: raw.dlink } as FileMeta
}

/** 条目数组的形状守卫：坏条目剔除而非整批失败。The entry-array shape guard: bad entries drop rather than fail the whole batch. */
function parseEntries(json: Record<string, unknown>, wantDlink: boolean): FileEntry[] {
  const list = json['list']
  if (!Array.isArray(list)) return []
  const entries: FileEntry[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const parsed = parseEntry(raw as RawEntry, wantDlink)
    if (parsed !== undefined) entries.push(parsed)
  }
  return entries
}

/** 列目录参数。Directory-listing parameters. */
export interface ListOptions {
  readonly dir: string
  readonly order?: 'name' | 'time' | 'size'
  readonly desc?: boolean
  /** 偏移量；传 limit 时必须一并传（服务端会忽略单传的 limit）。Start offset; required whenever limit is set (a lone limit is ignored server-side). */
  readonly start?: number
  readonly limit?: number
  readonly folderOnly?: boolean
}

/** 列目录：同步返回条目；分页越界返回空数组而非错误。Lists a directory: entries come back synchronously; out-of-range paging returns an empty array, not an error. */
export async function listDir(client: BaiduPanClient, options: ListOptions): Promise<FileEntry[]> {
  const params: Record<string, string> = {
    method: 'list',
    dir: options.dir,
    web: '1',
    ...(options.order === undefined ? {} : { order: options.order, desc: options.desc === true ? '1' : '0' }),
    ...(options.limit === undefined ? {} : { start: String(options.start ?? 0), limit: String(options.limit) }),
  }
  const response = await client.call('xpan/file', params)
  const entries = parseEntries(response.json, false)
  return options.folderOnly === true ? entries.filter(entry => entry.isDir) : entries
}

/** 关键字检索参数。Keyword-search parameters. */
export interface SearchOptions {
  readonly keyword: string
  /** 限定目录（授权根内）；缺省在授权根内递归。The scoped directory (inside the root); default scopes the root recursively. */
  readonly dir?: string
  readonly page?: number
  readonly num?: number
}

/** 检索结果：总数与当页条目。The search result: total plus the page's entries. */
export interface SearchResult {
  readonly total: number
  readonly entries: FileEntry[]
}

/** 关键字检索（服务端全量搜索接口）。Keyword search (the server-side search endpoint). */
export async function searchFiles(client: BaiduPanClient, options: SearchOptions): Promise<SearchResult> {
  const params: Record<string, string> = {
    method: 'filesearch',
    keyword: options.keyword,
    web: '1',
    ...(options.dir === undefined ? {} : { dir: options.dir }),
    page: String(options.page ?? 1),
    num: String(options.num ?? 30),
  }
  const response = await client.call('xpan/file', params)
  const total = response.json['total']
  return { total: typeof total === 'number' ? total : 0, entries: parseEntries(response.json, false) }
}

/** 元数据参数（1–100 个文件标识）。The metadata parameters (1–100 fsids). */
export interface MetaOptions {
  readonly fsids: readonly string[]
}

/** 元数据（含下载直链）：批量取 1–100 个标识。The metadata (with dlink): batch 1–100 fsids. */
export async function fileMetas(client: BaiduPanClient, options: MetaOptions): Promise<FileMeta[]> {
  if (options.fsids.length === 0 || options.fsids.length > 100) {
    throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'fsids must hold 1..100 entries' })
  }
  const response = await client.call('xpan/multimedia', {
    method: 'filemetas',
    fsids: JSON.stringify(options.fsids.map(fsid => Number(fsid))),
    dlink: '1',
    extra: '1',
  })
  const metas: FileMeta[] = []
  for (const entry of parseEntries(response.json, true)) {
    if ('dlink' in entry) metas.push(entry)
  }
  return metas
}

/** 建目录（可多级）；同名冲突按失败处理，不静默改名。Creates a directory (multi-level); a name conflict fails rather than silently renaming. */
export async function makeDir(client: BaiduPanClient, path: string): Promise<{ fsid: string; path: string }> {
  const response = await client.call('xpan/file', { method: 'create', path, isdir: '1', rtype: '0' }, { method: 'POST' })
  const fsId = response.json['fs_id']
  if (fsId === undefined) throw baiduPanError('BDPAN_UPSTREAM', { detail: 'create returned no fs_id' })
  return { fsid: String(fsId), path }
}

/** filemanager 的单条操作指令。One filemanager operation entry. */
export type ManageEntry = { path: string; newname?: string } | { path: string; dest?: string }

/** 执行文件管理操作（复制/移动/重命名/删除，同步形态）。Runs one file-management operation (copy/move/rename/delete, synchronous). */
export async function fileManage(client: BaiduPanClient, op: 'copy' | 'move' | 'rename' | 'delete', entries: readonly ManageEntry[]): Promise<void> {
  if (entries.length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'filelist is empty' })
  const response = await client.call('xpan/filemanager', {
    method: 'filemanager',
    op,
    async: '0',
    ondup: 'fail',
    filelist: JSON.stringify(entries),
  }, { method: 'POST' })
  void response
}
