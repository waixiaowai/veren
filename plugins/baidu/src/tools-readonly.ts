/**
 * 只读工具：账号、容量、列目录、关键字检索与元数据。全部无风险级，
 * 未登录一律 BDPAN_AUTH_REQUIRED 拒绝出网；数据脸带 fsid 供后续工具
 * 链接，渲染脸只给"我的应用数据/…"显示路径，内部标识不进人话文本。
 * The read-only tools: account, quota, listing, keyword search, and
 * metadata. All risk-free; unsigned-in calls refuse with BDPAN_AUTH_REQUIRED
 * before anything goes out. The data face carries fsids for tool chaining;
 * the render face speaks only "我的应用数据/…" display paths — internal ids
 * never enter human-facing text.
 *
 * @module @veren/baidu-pan
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { baiduPanError } from './errors.js'
import { fileMetas, listDir, searchFiles } from './files-client.js'
import { displayPath, FILE_ENTRY_SCHEMA, foldErrors, formatBytes, outputOneOf, requirePath, textBlock } from './toolkit.js'
import type { BaiduPanWorld } from './world.js'
import type { FileEntry } from './types.js'

/** ok 规范值的 schema 面（只读工具）。The ok value's schema faces (read-only tools). */
const ACCOUNT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    uid: { type: 'string', required: true },
    displayName: { type: 'string', required: true },
    vipType: { type: 'integer', required: true },
  },
} as const

const QUOTA_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    totalBytes: { type: 'integer', required: true },
    usedBytes: { type: 'integer', required: true },
    freeBytes: { type: 'integer', required: true },
    expireWithin7Days: { type: 'boolean', required: true },
  },
} as const

const LIST_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    dir: { type: 'string', required: true },
    entries: { type: 'array', required: true, items: FILE_ENTRY_SCHEMA },
  },
} as const

const SEARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    keyword: { type: 'string', required: true },
    total: { type: 'integer', required: true },
    entries: { type: 'array', required: true, items: FILE_ENTRY_SCHEMA },
  },
} as const

const META_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    metas: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: { ...FILE_ENTRY_SCHEMA.properties, dlink: { type: 'string', required: true } },
      },
    },
  },
} as const

/** 条目的数据脸投影（显式返回类型，匹配 schema 推断面）。The entry's data-face projection (explicit return type matching the schema's inferred face). */
function entryShape(entry: FileEntry): { fsid: string; path: string; name: string; isDir: boolean; size: number; md5: string; category: number; serverMtime: number; serverCtime: number } {
  return { fsid: entry.fsid, path: entry.path, name: entry.name, isDir: entry.isDir, size: entry.size, md5: entry.md5, category: entry.category, serverMtime: entry.serverMtime, serverCtime: entry.serverCtime }
}

/** 外来值的兜底渲染（规范错误值等）。The fallback render for foreign values (canonical error values included). */
function renderFallback(value: unknown): string {
  return JSON.stringify(value)
}

/** 账号渲染。Renders the account. */
function renderAccount(value: unknown): string {
  const data = value as { kind?: string; displayName?: string; vipType?: number }
  if (data.kind !== 'ok') return renderFallback(value)
  const vip = ['普通账号', '会员', '超级会员'][data.vipType ?? 0] ?? '普通账号'
  return `已登录：${data.displayName}（${vip}）/ Signed in: ${data.displayName}`
}

/** 容量渲染。Renders the quota. */
function renderQuota(value: unknown): string {
  const data = value as { kind?: string; totalBytes?: number; usedBytes?: number; freeBytes?: number; expireWithin7Days?: boolean }
  if (data.kind !== 'ok') return renderFallback(value)
  const expiry = data.expireWithin7Days === true ? '\n注意：7 天内有容量到期 / Note: quota expires within 7 days' : ''
  return `已用 ${formatBytes(data.usedBytes ?? 0)} / 总量 ${formatBytes(data.totalBytes ?? 0)}，剩余 ${formatBytes(data.freeBytes ?? 0)}${expiry}`
}

/** 条目清单渲染（list 与 search 共用骨架）。The entry-list render (one skeleton for list and search). */
function renderEntries(header: string, entries: Array<{ name: string; isDir: boolean; size: number; path: string }>): string {
  const lines = entries.map(entry => {
    const kind = entry.isDir ? 'dir' : 'file'
    const size = entry.isDir ? '' : ` ${formatBytes(entry.size)}`
    return `- [${kind}] ${entry.name}${size} — ${displayPath(entry.path)}`
  })
  return [header, ...lines].join('\n')
}

/** list 渲染。The list render. */
function renderList(value: unknown): string {
  const data = value as { kind?: string; dir?: string; entries?: FileEntry[] }
  if (data.kind !== 'ok') return renderFallback(value)
  return renderEntries(`目录 ${displayPath(data.dir ?? '')} — ${(data.entries ?? []).length} 项`, data.entries ?? [])
}

/** search 渲染。The search render. */
function renderSearch(value: unknown): string {
  const data = value as { kind?: string; keyword?: string; total?: number; entries?: FileEntry[] }
  if (data.kind !== 'ok') return renderFallback(value)
  return renderEntries(`检索"${data.keyword ?? ''}"共 ${data.total ?? 0} 项，本页 ${(data.entries ?? []).length} 项`, data.entries ?? [])
}

/** 元数据渲染：带直链可用性提示。The metadata render: with dlink readiness. */
function renderMetas(value: unknown): string {
  const data = value as { kind?: string; metas?: Array<{ name: string; size: number; dlink: string }> }
  if (data.kind !== 'ok') return renderFallback(value)
  return (data.metas ?? []).map(meta => `- ${meta.name} ${formatBytes(meta.size)} — 直链可用 / dlink ready`).join('\n')
}

/** list 工具参数的 wire 形态。The list tool arguments' wire shape. */
interface ListArgs {
  readonly dir: string
  readonly order?: 'name' | 'time' | 'size'
  readonly desc?: boolean
  readonly folder_only?: boolean
  readonly start?: number
  readonly limit?: number
}

/** whoami 的执行闭包。The whoami execute closure. */
function whoamiExecute(world: BaiduPanWorld) {
  return foldErrors(async () => {
    const profile = await world.client.profile()
    return { kind: 'ok' as const, uid: profile.uid, displayName: profile.displayName, vipType: profile.vipType }
  })
}

/** quota 的执行闭包。The quota execute closure. */
function quotaExecute(world: BaiduPanWorld) {
  return foldErrors(async () => {
    const quota = await world.client.quota()
    return { kind: 'ok' as const, totalBytes: quota.totalBytes, usedBytes: quota.usedBytes, freeBytes: quota.freeBytes, expireWithin7Days: quota.expireWithin7Days }
  })
}

/** list 的执行闭包：守门后取归一化目录。The list execute closure: the normalized, guarded directory. */
function listExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: ListArgs) => {
    const dir = requirePath(world, args.dir)
    const entries = await listDir(world.client, {
      dir,
      ...(args.order === undefined ? {} : { order: args.order, desc: args.desc }),
      ...(args.start === undefined ? {} : { start: args.start }),
      ...(args.limit === undefined ? {} : { limit: Math.min(args.limit, 1000) }),
      ...(args.folder_only === true ? { folderOnly: true } : {}),
    })
    return { kind: 'ok' as const, dir, entries: entries.map(entryShape) }
  })
}

/** search 的执行闭包。The search execute closure. */
function searchExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: { keyword: string; dir?: string; page?: number; num?: number }) => {
    if (args.keyword.trim().length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'keyword is empty' })
    const scope = args.dir === undefined ? undefined : requirePath(world, args.dir)
    const result = await searchFiles(world.client, {
      keyword: args.keyword,
      ...(scope === undefined ? {} : { dir: scope }),
      ...(args.page === undefined ? {} : { page: args.page }),
      ...(args.num === undefined ? {} : { num: Math.min(Math.max(args.num, 1), 100) }),
    })
    return { kind: 'ok' as const, keyword: args.keyword, total: result.total, entries: result.entries.map(entryShape) }
  })
}

/** meta 的执行闭包。The meta execute closure. */
function metaExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: { fsids?: readonly string[] }) => {
    const fsids = args.fsids ?? []
    if (fsids.length === 0 || fsids.length > 100) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'fsids must hold 1..100 entries' })
    const metas = await fileMetas(world.client, { fsids })
    return { kind: 'ok' as const, metas: metas.map(meta => ({ ...entryShape(meta), dlink: meta.dlink })) }
  })
}

/** whoami 工具定义。The whoami tool definition. */
function whoamiTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__whoami',
    description: 'Return the signed-in Baidu Netdisk account (display name and VIP tier). Use it to confirm the sign-in state before file operations; unsigned-in deployments answer BDPAN_AUTH_REQUIRED and sign-in lives in the host settings.',
    parameters: {},
    timeoutMs: 120_000,
    output: { schema: outputOneOf(ACCOUNT_SCHEMA), render: (_args, value) => textBlock(renderAccount(value)) },
    execute: whoamiExecute(world),
  })
}

/** quota 工具定义。The quota tool definition. */
function quotaTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__quota',
    description: 'Return the Baidu Netdisk capacity snapshot: total, used, free bytes, and whether quota expires within 7 days. Use it before large uploads to check headroom.',
    parameters: {},
    timeoutMs: 120_000,
    output: { schema: outputOneOf(QUOTA_SCHEMA), render: (_args, value) => textBlock(renderQuota(value)) },
    execute: quotaExecute(world),
  })
}

/** list 工具定义。The list tool definition. */
function listTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__list',
    description: 'List one directory inside the Baidu Netdisk authorized root ("My App Data"). Returns entries with ids, names, sizes and dir flags. Relative dir arguments resolve against the root; anything outside it is refused locally with BDPAN_PATH_OUT_OF_SCOPE.',
    parameters: {
      dir: { type: 'string', required: true, description: 'Directory path inside the authorized root; the root itself is allowed' },
      order: { type: 'string', enum: ['name', 'time', 'size'], description: 'Sort key' },
      desc: { type: 'boolean', description: 'Sort descending' },
      folder_only: { type: 'boolean', description: 'Keep directories only' },
      start: { type: 'integer', description: 'Pagination offset (0-based); pass it together with limit — the server ignores a lone limit' },
      limit: { type: 'integer', description: 'Page size, capped at 1000' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(LIST_SCHEMA), render: (_args, value) => textBlock(renderList(value)) },
    execute: listExecute(world),
  })
}

/** search 工具定义。The search tool definition. */
function searchTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__search',
    description: 'Keyword-search file names inside the Baidu Netdisk authorized root, optionally scoped to one directory. Returns the total plus one page of entries. Zero hits does not prove absence — try another keyword or scope before concluding.',
    parameters: {
      keyword: { type: 'string', required: true, description: 'The keyword matched against file names' },
      dir: { type: 'string', description: 'Optional directory scope inside the root' },
      page: { type: 'integer', description: '1-based page number' },
      num: { type: 'integer', description: 'Page size, 1-100' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(SEARCH_SCHEMA), render: (_args, value) => textBlock(renderSearch(value)) },
    execute: searchExecute(world),
  })
}

/** meta 工具定义。The meta tool definition. */
function metaTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__meta',
    description: 'Fetch metadata for 1-100 file ids (fsid values taken from baidu_pan__list or baidu_pan__search outputs), including the time-limited download dlink. baidu_pan__download remains the tool for landing files locally.',
    parameters: {
      fsids: { type: 'array', required: true, items: { type: 'string' }, description: 'File ids (strings), 1-100 entries' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(META_SCHEMA), render: (_args, value) => textBlock(renderMetas(value)) },
    execute: metaExecute(world),
  })
}

/**
 * 在当前作用域注册五个只读工具；逆序清理，随作用域卸载不泄漏。
 * Registers the five read-only tools on the calling scope; reverse-order
 * disposal, no leak when the scope unloads.
 */
export function registerReadonlyTools(ctx: Context, world: BaiduPanWorld): () => void {
  const tools = [whoamiTool(world), quotaTool(world), listTool(world), searchTool(world), metaTool(world)]
  const disposers = tools.map(tool => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
