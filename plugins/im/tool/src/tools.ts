/**
 * Model-facing `im_*` tools over the @veren/im router: the registration face.
 *
 * Account authorization (`im_bind`) is its own tool on purpose: an
 * authorization attempt must never guess a DSH Session. `im_send` always names
 * its target explicitly. Conversation bindings are gone (2.1.8) — sessions are
 * private to the queue consumer, so there is no link/settings tool anymore.
 * Each tool lives in its own file; this module only assembles and unregisters.
 *
 * 面向模型的 `im_*` 工具，作用于 @veren/im 路由：注册面。
 *
 * 账号授权（`im_bind`）独立成工具：授权尝试绝不能猜 DSH Session。`im_send` 永远显式指定
 * target。会话绑定已删除（2.1.8）——会话对队列消费者私有，不再有 link/settings 工具。
 * 每个工具独立成文件；本模块只负责装配与逆序注销。
 *
 * @module @veren/im-tool/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImRouter } from '@veren/im'
import { imBindTool } from './bind-tool.ts'
import { imSendTool } from './send-tool.ts'
import { imListTool, imUnbindTool } from './session-tools.ts'

/**
 * Register every IM tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param router - the IM router.
 */
export function registerImTools(ctx: Context, router: ImRouter): void {
  ctx.effect(() => {
    const tools = [
      imBindTool(router),
      imUnbindTool(router),
      imSendTool(router),
      imListTool(router),
    ]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'im:tools()')
}
