/**
 * Model-facing `im_*` tools over the @veren/im router: the registration face.
 *
 * Account authorization (`im_bind`) and conversation binding (`im_link`) are
 * separate tools on purpose: an authorization attempt must never guess a DSH
 * Session, and a binding must never start a QR flow. `im_send` always names its
 * target explicitly; it never falls back to the current active binding.
 * Each tool lives in its own file; this module only assembles and unregisters.
 *
 * 面向模型的 `im_*` 工具，作用于 @veren/im 路由：注册面。
 *
 * 账号授权（`im_bind`）与会话绑定（`im_link`）刻意分开：授权尝试绝不能猜 DSH Session，绑定也绝不
 * 发起扫码流程。`im_send` 永远显式指定 target，绝不回退到当前 active binding。每个工具独立成文件；
 * 本模块只负责装配与逆序注销。
 *
 * @module @veren/im-tool/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImRouter } from '@veren/im'
import { imBindTool } from './bind-tool.ts'
import { imSendTool } from './send-tool.ts'
import { imLinkTool, imListTool, imSettingsTool, imUnbindTool } from './session-tools.ts'

/**
 * Register every IM tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param router - the active-binding router.
 */
export function registerImTools(ctx: Context, router: ImRouter): void {
  ctx.effect(() => {
    const tools = [
      imBindTool(router),
      imLinkTool(router),
      imUnbindTool(router),
      imSendTool(router),
      imSettingsTool(router),
      imListTool(router),
    ]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'im:tools()')
}
