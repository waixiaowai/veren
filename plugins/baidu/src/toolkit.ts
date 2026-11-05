/**
 * 工具公共面：路径裁决理由 → 统一错误码、本地路径解析（工作区相对或
 * 绝对）、远端路径 → 文件条目解析（供分享/下载取 fsid）、输出渲染。
 * 错误走值不走异常是所有工具的统一约定。
 * The tool commons: verdict-reason → unified-code mapping, local-path
 * resolution (workspace-relative or absolute), remote-path → entry
 * resolution (fsids for share/download), and output rendering. Errors
 * travel as values, never exceptions — uniform across all tools.
 *
 * @module @veren/baidu-pan
 */
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { BaiduPanCode } from './errors.js'
import { baiduPanError, type ToolErrorValue, toErrorValue } from './errors.js'

/** 闭集收尾：穷尽性检查失败即编译错误。The closed-set closer: exhaustiveness failures are compile errors. */
function assertNever(value: never): never {
  throw new Error(`unhandled closed-set member: ${String(value)}`)
}

/** 文件条目的 schema 面（工具数据脸复用）。The file-entry schema face (reused across tool data faces). */
export const FILE_ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    fsid: { type: 'string', required: true },
    path: { type: 'string', required: true },
    name: { type: 'string', required: true },
    isDir: { type: 'boolean', required: true },
    size: { type: 'integer', required: true },
    md5: { type: 'string', required: true },
    category: { type: 'integer', required: true },
    serverMtime: { type: 'integer', required: true },
    serverCtime: { type: 'integer', required: true },
  },
} as const

/** 错误规范值的 schema 面（全部工具共用信封）。The error value's schema face (one envelope for all tools). */
export const ERROR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'error' },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    retryable: { type: 'boolean', required: true },
  },
} as const

/** 组装 oneOf[ok, error] 输出 schema（保 const 推断，execute 返回值才有类型面）。Assembles the oneOf[ok, error] output schema (const inference preserved so execute keeps its type face). */
export function outputOneOf<const Ok extends ValueSchemaSpec>(ok: Ok): { oneOf: readonly [Ok, typeof ERROR_SCHEMA] } {
  return { oneOf: [ok, ERROR_SCHEMA] }
}

/** 单文本块的模型面投影。The single-text-block model-face projection. */
export function textBlock(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}
import { checkPath, type PathReason } from './guard.js'
import { listDir } from './files-client.js'
import type { BaiduPanWorld } from './world.js'
import type { FileEntry } from './types.js'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 路径裁决理由 → 统一错误码（闭集 union 用 assertNever 收尾）。The verdict-reason → unified-code map (closed unions close with assertNever). */
export function reasonToCode(reason: PathReason): BaiduPanCode {
  switch (reason) {
    case 'invalid-name':
      return 'BDPAN_INVALID_NAME'
    case 'empty':
      return 'BDPAN_INVALID_ARG'
    case 'ok':
    case 'traversal':
    case 'outside-root':
    case 'encoded-traversal':
    case 'tilde':
    case 'platform-trap':
      return 'BDPAN_PATH_OUT_OF_SCOPE'
    default:
      return assertNever(reason)
  }
}

/** 守门路径：非法即抛统一失败，合法返回归一化服务端路径。The guarded path: illegal throws the unified failure, legal returns the normalized server path. */
export function requirePath(world: BaiduPanWorld, input: string, options: { singleName?: boolean } = {}): string {
  const verdict = checkPath(input, world.config.root, options)
  if (!verdict.allowed) throw baiduPanError(reasonToCode(verdict.reason), { detail: `reason=${verdict.reason}` })
  return verdict.normalized
}

/**
 * 本地路径解析：绝对路径原样采用；相对路径落在调用会话的工作区里。
 * 未知会话且相对路径 → 响亮的参数失败。
 * Local-path resolution: absolute paths pass through; relative paths land
 * in the calling session's workspace. An unknown session with a relative
 * path is a loud argument failure.
 */
export function requireLocalPath(world: BaiduPanWorld, sessionId: SessionId | undefined, input: string): string {
  if (isAbsolute(input)) return input
  const workspace = world.workspaceOf(sessionId)
  if (workspace === undefined) {
    throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'relative local paths need the calling session to own a workspace; pass an absolute path' })
  }
  return join(workspace, input)
}

/** 远端路径 → 文件条目：列出父目录并按名称匹配（每唯一父目录一次调用）。Remote path → entry: lists the parent and matches by name (one call per unique parent). */
export async function resolveEntries(world: BaiduPanWorld, paths: readonly string[]): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  for (const path of paths) {
    const normalized = requirePath(world, path)
    const parent = dirname(normalized)
    const name = basename(normalized)
    const siblings = await listDir(world.client, { dir: parent, limit: 1000, start: 0 })
    const found = siblings.find(entry => entry.name === name)
    if (found === undefined) throw baiduPanError('BDPAN_NOT_FOUND', { detail: name })
    entries.push(found)
  }
  return entries
}

/** 工具执行面：signal + 调用会话。The tool execution face: signal plus the calling session. */
export interface ExecFace {
  readonly signal: AbortSignal
  readonly agent?: { readonly id: SessionId }
}

/** execute 包装：抛出折成规范错误值。The execute wrapper: throws fold into canonical error values. */
export function foldErrors<A, R>(run: (args: A, exec: ExecFace) => Promise<R>): (args: A, exec: ExecFace) => Promise<R | ToolErrorValue> {
  return async (args, exec) => {
    try {
      return await run(args, exec)
    } catch (error) {
      return toErrorValue(error)
    }
  }
}

/** 渲染单条目的可读行：目录标记、名称、大小、显示路径。Renders one readable entry line: dir marker, name, size, display path. */
export function renderEntry(entry: FileEntry): string {
  const kind = entry.isDir ? 'dir' : 'file'
  const size = entry.isDir ? '' : ` ${formatBytes(entry.size)}`
  return `- [${kind}] ${entry.name}${size} — ${displayPath(entry.path)}`
}

/** 显示路径：/apps 前缀映射为"我的应用数据"。Display path: the /apps prefix maps to "我的应用数据". */
export function displayPath(path: string): string {
  return path.replace(/^\/apps\//u, '我的应用数据/')
}

/** 字节数的短格式。The short byte format. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}
