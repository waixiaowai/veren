/**
 * 页面身份系统提示 + agent/created 重挂接缝：新建与重启后再激活的页面会话
 * 都经 agent/created 这一条缝拿回"页面身份 + 页面工具面"。
 * The page-identity system prompt and the agent/created remount seam: fresh
 * sessions and old sessions re-activated after a restart both regain "the page
 * identity + the page tool face" through this one seam.
 * @module @veren/app-host/page-identity
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 类型-only import：拉取 ctx.systemPrompt 的 declaration merging（身份提示的落点）。
// 不靠间接 merge：间接带上后上游一调整就静默失效。
// type-only import: declares ctx.systemPrompt — where the identity lands. Never
// rely on a transitive merge: it silently breaks when upstream reshuffles.
import type {} from '@deepseek-ai/dsh-system-prompt'
// 类型-only import：拉取三个服务的 declaration merging（ctx.apps / ctx.pageRegistry）。
// type-only import: pulls the declaration merges of ctx.apps / ctx.pageRegistry.
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'

/** 身份注册名：真机探针按它断言身份块在场 / the registration name; the live probe asserts on it */
const PAGE_IDENTITY_PROMPT_NAME = 'APP_HOST_PAGE_IDENTITY'

/**
 * 身份提示正文：页面工具是业务数据的唯一正道——真机反例里模型曾无视页面工具
 * 去文件系统扫用户 home 找业务数据，一回合烧约 40 万 token。
 * The identity prompt body: page tools are the only sanctioned path to business
 * data — the live counter-example had the model filesystem-dive the user's home
 * for business data, burning ~400K tokens in one turn.
 */
function identityText(appId: string, url: string): string {
  return [
    `页面会话身份:你当前在应用页面 ${url}(应用 ${appId})上工作。`,
    '- 本页挂载的工具是你操作业务数据的唯一正道:业务数据不在工作区文件里。禁止用文件系统、终端、命令行或阅读源码的方式寻找业务数据、存储位置或工具实现。',
    '- 工作目录只是宿主开发工作区,与本页任务无关。',
    '- 任务与业务 id 属于各自模块的命名空间(如任务工作台的 t-N 与任务中心的 task-*),不可混用。',
    '- 行动前先用页面工具读取事实;页面说明(PAGE 块)与本说明冲突时,以页面工具的返回为准。',
  ].join('\n')
}

/**
 * 页面身份系统提示（组装期动态解析）：agent 创建时查页面实例行——新会话与重启后
 * 再激活的老会话走同一条 agent/created 接缝,同等获得身份;非页面会话不注册。
 * 真机反例:页面会话模型曾无视页面工具,去文件系统寻找业务数据(先扫了用户 home
 * 的错误 home!),一回合烧约 40 万 token——根因是页面身份只以一条消息存在,权重
 * 压不过宿主编码人设的 system prompt。这里把身份与自治协议提升到 system prompt
 * 层,按 agent 作用域注册(随 fiber 生灭,不泄漏到别的会话)。
 * live 之外也认 reserved:新建路径的 agent/created 触发在两阶段创建的 reserve
 * 与 commit 之间,此刻行还是 reserved——只认 live 会让新会话永远拿不到身份
 * (真机 2.0.8:三个新建页面会话日志零身份块)。reserved 行若最终创建失败,agent
 * 随 fiber 消亡,身份注册随之拆除,不会泄漏。
 * The page-identity system prompt (resolved dynamically at assembly): on agent
 * creation we look up the page instance row — fresh sessions and old sessions
 * re-activated after a restart share the same agent/created seam, so both get
 * the identity; non-page sessions register nothing. Reserved rows match too:
 * agent/created fires between the two-phase reserve and commit on the
 * fresh-create path, so a live-only match left fresh sessions permanently
 * unbadged (live 2.0.8). If the create fails, the agent dies with its fiber and
 * the registration unwinds — no leak.
 * @param ctx - 宿主上下文 / the host context
 * @param agent - 刚创建（或重挂）的 agent / the freshly created (or remounted) agent
 */
export async function attachPageIdentity(ctx: Context, agent: Agent): Promise<void> {
  const sessionId = agent.session?.id
  if (sessionId === undefined) return
  try {
    for (const app of ctx.apps.catalog()) {
      const rows = await ctx.pageRegistry.instances.listByApp(app.definition.id)
      const row = rows.find((candidate) => candidate.sessionId === sessionId && (candidate.state === 'live' || candidate.state === 'reserved'))
      if (row === undefined) continue
      agent.ctx.systemPrompt.context({
        name: PAGE_IDENTITY_PROMPT_NAME,
        // WORKING_DIRECTORY(100) 之后:页面会话的工作目录只是宿主开发工作区,与本页任务无关。
        // After WORKING_DIRECTORY(100): a page session's cwd is the host dev workspace, unrelated to the page task.
        order: 105,
        interpolate: false,
        text: identityText(app.definition.id, row.url),
      })
      return
    }
  } catch (error: unknown) {
    // 身份注入失败不阻断 agent 创建:PAGE 块仍在,只少 system 层加固。
    // A failed identity injection must not block creation: the PAGE block still rides.
    ctx.logger.warn(`app-host: page identity for ${sessionId} failed: ${String(error)}`)
  }
}

/**
 * agent/created 的重挂 + 身份：一次性渲染绑定原始 fiber，重启后重建的 agent
 * 没有页面工具面，模型只能靠通用工具 improvising——重挂在每次 agent 创建时把
 * 页面渲染重放一遍（rerender 幂等：reserved 行在两阶段创建中会被跳过，新会话
 * 的正常渲染不会双重执行），身份随后挂上。
 * The agent/created remount + identity: the one-shot render is bound to the
 * original fiber, so a recreated agent carries no page tool face and the model
 * improvises with generic tools — the remount replays the page render on every
 * agent creation (rerender is idempotent: reserved rows mid two-phase create
 * are skipped, so a fresh session's normal render never double-runs), then the
 * identity lands.
 * @param ctx - 宿主上下文 / the host context
 * @param agent - 刚创建的 agent / the freshly created agent
 */
export async function remountPageAgent(ctx: Context, agent: Agent): Promise<void> {
  const sessionId = agent.session?.id
  if (sessionId === undefined) return
  try {
    await ctx.pageRegistry.rerender(sessionId, agent)
  } catch (error: unknown) {
    ctx.logger.warn(`app-host: page rerender for ${sessionId} failed: ${String(error)}`)
  }
  await attachPageIdentity(ctx, agent)
}
