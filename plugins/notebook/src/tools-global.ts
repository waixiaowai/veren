/**
 * The preset-wide card-box face: the four consult/write tools registered in
 * the plugin scope, so every session of every preset can consult and feed the
 * box — the always-available second memory (Luhmann 1981: "communication with
 * the slip-box"). The page sessions mount the same four full names at agent
 * scope, which shadow these globals by the registry's documented semantics
 * ("scoped tools shadow globals"), so every capability keeps exactly one name
 * everywhere. rewrite_note and delete_note stay page-only: deletion is the L2
 * contract, and an edit without the note's first screen open is an edit against
 * a stale read.
 *
 * 预设全域的卡片盒面：四件咨询/写入工具注册进插件作用域，让每个预设的任意会话
 * 都能咨询与喂养盒子——随时在场的第二记忆（卢曼 1981「与卡片盒交流」）。页面
 * 会话在 agent 作用域挂载同一批全名，按注册表文档语义（「scoped tools shadow
 * globals」）遮蔽这些全局件，每个能力在任何地方都只有一个名字。rewrite_note 与
 * delete_note 仍只在页面：删除是 L2 契约；没有详情首屏兜底的改写就是对过期
 * 读取的改写。
 *
 * @module @veren/notebook/tools-global
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildNotebookListDefinition } from './tools.ts'
import { buildNotebookFindDefinition } from './tools-graph.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildNotebookReadDefinition, buildNotebookWriteDefinition } from './tools.ts'
import type { NotebookToolsPort } from './types.ts'

/** The app-catalog tool prefix (@veren/notebook-app APP_DEFINITION.toolPrefix); the global face shares the page face's full names so shadowing pairs them. 应用目录工具前缀（@veren/notebook-app 的 APP_DEFINITION.toolPrefix）；全局面与页面同名，遮蔽才配得成对。 */
const APP_TOOL_PREFIX = 'notebook__'

/** The four global full names, in registration order. 四个全局全名，按注册顺序。 */
export const GLOBAL_TOOL_NAMES = ['notebook__list_notes', 'notebook__find_cards', 'notebook__read_note', 'notebook__write_note'] as const

/**
 * Register the global consult/write face into the plugin scope. Reverse-order
 * dispose; re-registering after dispose is the HMR path and must not collide.
 * @param ctx - the plugin's own context (an unscoped registration = global).
 * @param port - resolves the notebook surface the tools act through.
 */
export function registerNotebookGlobalTools(ctx: Context, port: () => NotebookToolsPort): void {
  ctx.effect(() => {
    const builders: Array<(ctx: Context, port: () => NotebookToolsPort) => ToolDefinition> = [
      buildNotebookListDefinition,
      buildNotebookFindDefinition,
      buildNotebookReadDefinition,
      buildNotebookWriteDefinition,
    ]
    const disposers = builders.map(build => {
      const definition = build(ctx, port)
      return ctx.tools.register({ ...definition, name: globalName(definition.name) })
    })
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'notebook:global-tools()')
}

/** Compose one global full name from the builder's local name. 由构建器本地名拼全局全名。 */
function globalName(local: string): string {
  return `${APP_TOOL_PREFIX}${local}`
}
