/**
 * 文件管理工具：建目录（写入）、复制/移动/重命名（写入）与删除（危险）。
 * 删除的确认凭证必须恰好覆盖目标集合——多、少、错任何一项都以
 * BDPAN_CONFIRM_REQUIRED 打回，不沿用旧确认；重命名新名不得含分隔符。
 * The file-management tools: mkdir (write), copy/move/rename (write), and
 * delete (dangerous). The delete voucher must cover exactly the target set
 * — any extra, missing, or wrong entry bounces with BDPAN_CONFIRM_REQUIRED;
 * old confirmations never carry over. Rename names never contain separators.
 *
 * @module @veren/baidu-pan
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { fileManage, makeDir } from './files-client.js'
import { removeGuarded } from './manage-core.js'
import { displayPath, foldErrors, outputOneOf, requirePath, textBlock } from './toolkit.js'
import type { BaiduPanWorld } from './world.js'

/** ok 规范值的 schema 面（文件管理）。The ok value's schema faces (file management). */
const DONE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    op: { type: 'string', required: true },
    paths: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const MKDIR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    fsid: { type: 'string', required: true },
    path: { type: 'string', required: true },
  },
} as const

/** copy/move/rename 的公共参数 wire 形态。The shared copy/move/rename arguments' wire shape. */
interface TransferArgs {
  readonly source_path: string
  readonly dest_dir: string
  readonly new_name?: string
}

/** 渲染：op + 显示路径清单。Renders: the op plus display-path lines. */
function renderDone(value: unknown): string {
  const data = value as { kind?: string; op?: string; paths?: string[] }
  if (data.kind !== 'ok') return JSON.stringify(value)
  return `${data.op ?? ''} 完成 / done：\n${(data.paths ?? []).map(path => `- ${displayPath(path)}`).join('\n')}`
}

/** 渲染：新建目录落点。Renders: the new directory landing. */
function renderMkdir(value: unknown): string {
  const data = value as { kind?: string; path?: string }
  if (data.kind !== 'ok') return JSON.stringify(value)
  return `目录已创建 / directory created：${displayPath(data.path ?? '')}`
}

/** mkdir 的执行闭包。The mkdir execute closure. */
function mkdirExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: { path: string }) => {
    const path = requirePath(world, args.path)
    const created = await makeDir(world.client, path)
    return { kind: 'ok' as const, fsid: created.fsid, path: created.path }
  })
}

/** copy/move 的公共执行闭包。The shared copy/move execute closure. */
function transferExecute(world: BaiduPanWorld, op: 'copy' | 'move') {
  return foldErrors(async (args: TransferArgs) => {
    const source = requirePath(world, args.source_path)
    const destDir = requirePath(world, args.dest_dir)
    const newName = args.new_name === undefined ? undefined : requirePath(world, args.new_name, { singleName: true })
    const entry: { path: string; dest?: string; newname?: string } = { path: source, dest: destDir }
    if (newName !== undefined) entry.newname = newName
    await fileManage(world.client, op, [entry])
    return { kind: 'ok' as const, op, paths: [source] }
  })
}

/** rename 的执行闭包。The rename execute closure. */
function renameExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: { path: string; new_name: string }) => {
    const source = requirePath(world, args.path)
    const newName = requirePath(world, args.new_name, { singleName: true })
    await fileManage(world.client, 'rename', [{ path: source, newname: newName }])
    return { kind: 'ok' as const, op: 'rename' as const, paths: [source] }
  })
}

/** delete 的执行闭包：守门删除走共享核心，与网页网关同一份编排。The delete execute closure: guarded delete rides the shared core — one orchestration with the web gateway. */
function deleteExecute(world: BaiduPanWorld) {
  return foldErrors(async (args: { paths?: readonly string[]; confirm_paths?: readonly string[] }) => {
    const normalized = await removeGuarded(world, args.paths ?? [], args.confirm_paths ?? [])
    return { kind: 'ok' as const, op: 'delete' as const, paths: [...normalized] }
  })
}

/** mkdir 工具定义。The mkdir tool definition. */
function mkdirTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__mkdir',
    description: 'Create a directory inside the authorized root (multi-level paths allowed). A same-named conflict fails with BDPAN_ALREADY_EXISTS instead of silently renaming — pick another name or report the conflict to the user.',
    parameters: { path: { type: 'string', required: true, description: 'The directory path to create, inside the authorized root' } },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(MKDIR_SCHEMA), render: (_args, value) => textBlock(renderMkdir(value)) },
    execute: mkdirExecute(world),
  })
}

/** copy 工具定义。The copy tool definition. */
function copyTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__copy',
    description: 'Copy one file or directory into a destination directory inside the authorized root. Same-named targets fail with BDPAN_ALREADY_EXISTS — never overwritten.',
    parameters: {
      source_path: { type: 'string', required: true, description: 'The source path inside the root' },
      dest_dir: { type: 'string', required: true, description: 'The destination directory inside the root' },
      new_name: { type: 'string', description: 'Optional new name at the destination (no path separators)' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(DONE_SCHEMA), render: (_args, value) => textBlock(renderDone(value)) },
    execute: transferExecute(world, 'copy'),
  })
}

/** move 工具定义。The move tool definition. */
function moveTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__move',
    description: 'Move one file or directory into a destination directory inside the authorized root. Same-named targets fail with BDPAN_ALREADY_EXISTS — never overwritten.',
    parameters: {
      source_path: { type: 'string', required: true, description: 'The source path inside the root' },
      dest_dir: { type: 'string', required: true, description: 'The destination directory inside the root' },
      new_name: { type: 'string', description: 'Optional new name at the destination (no path separators)' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(DONE_SCHEMA), render: (_args, value) => textBlock(renderDone(value)) },
    execute: transferExecute(world, 'move'),
  })
}

/** rename 工具定义。The rename tool definition. */
function renameTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__rename',
    description: 'Rename one file or directory in place. The new name must be a bare name without path separators (BDPAN_INVALID_NAME otherwise); same-named conflicts fail with BDPAN_ALREADY_EXISTS.',
    parameters: {
      path: { type: 'string', required: true, description: 'The path to rename, inside the root' },
      new_name: { type: 'string', required: true, description: 'The new bare name, no separators' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(DONE_SCHEMA), render: (_args, value) => textBlock(renderDone(value)) },
    execute: renameExecute(world),
  })
}

/** delete 工具定义。The delete tool definition. */
function deleteTool(world: BaiduPanWorld): ToolDefinition {
  return defineTool({
    name: 'baidu_pan__delete',
    description: 'DANGEROUS: permanently delete files or directories inside the authorized root. Requires confirm_paths — the exact list of paths being deleted, matching paths one-for-one (order-insensitive). Any mismatch bounces with BDPAN_CONFIRM_REQUIRED: restate the full target list only after the user explicitly confirmed deleting exactly those items. Deletion is irreversible.',
    parameters: {
      paths: { type: 'array', required: true, items: { type: 'string' }, description: 'The paths to delete, inside the root' },
      confirm_paths: { type: 'array', required: true, items: { type: 'string' }, description: 'The confirmed deletion list; must equal paths exactly' },
    },
    timeoutMs: 120_000,
    output: { schema: outputOneOf(DONE_SCHEMA), render: (_args, value) => textBlock(renderDone(value)) },
    execute: deleteExecute(world),
  })
}

/**
 * 在当前作用域注册五个文件管理工具；逆序清理，随作用域卸载不泄漏。
 * Registers the five file-management tools on the calling scope;
 * reverse-order disposal, no leak when the scope unloads.
 */
export function registerManageTools(ctx: Context, world: BaiduPanWorld): () => void {
  const tools = [mkdirTool(world), copyTool(world), moveTool(world), renameTool(world), deleteTool(world)]
  const disposers = tools.map(tool => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
