/**
 * 应用暂存（选择应用 ≠ 立刻开会话）。
 *
 * 客户端在应用下拉里选中应用只登记意图（{@link AppStaging.stage}）；该会话的
 * 首条用户消息触发的 `agent/pre-step` 才把它提升为真正的页面会话：
 * - 页面实例落进索引（`openUrl` 的复用路径，不新建会话、不 focus）；
 * - PAGE 块作为**本轮决策消息**进入上下文（只落日志的话这一轮看不到页面）；
 * - 页面工具同步挂到该 agent 作用域，侧栏标题换成实例标题。
 *
 * Staged apps (picking an app does not start a session). Selecting an app in the
 * dropdown only records the intent ({@link AppStaging.stage}); the session's
 * first user message drives `agent/pre-step`, which promotes it into a real page
 * session: the instance lands in the index (openUrl's reuse path — no session
 * creation, no focus), the PAGE block enters the *current step's decision*
 * (landing it in the log alone would hide the page from this round), page tools
 * mount on that agent scope, and the sidebar title becomes the instance title.
 * @module @veren/app-host/staging
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type { PageInstanceKey } from '@veren/prompt-page'
import { PAGE_MESSAGE_SOURCE } from './session-port.ts'

/** 一条暂存的应用（打开目标已解析好）/ one staged app (its open target is resolved) */
export interface StagedApp {
  readonly appId: string
  readonly name: string
  readonly url: string
}

/** 暂存面：登记、查询、卸载 / the staging face: record, read, dispose */
export interface AppStaging {
  /** 登记意图（幂等；同会话再选只保留最后一次）/ record the intent (idempotent; the last pick wins) */
  stage(sessionId: string, app: StagedApp): void
  /** 取该会话暂存的应用（未暂存 → undefined）/ the staged app of one session, if any */
  appOf(sessionId: string): StagedApp | undefined
  /** 取消暂存（用户改主意；之后的首条消息按普通会话走）/ drop the staged app (the first message then runs as an ordinary session) */
  unstage(sessionId: string): void
  /** 装配卸载：摘掉全部 pre-step 监听与登记 / assembly unload: drop listeners and records */
  dispose(): void
}

/**
 * 建暂存面。监听挂在**该会话 agent 的作用域**上（与 PAGE-DATA 注入同一接缝），
 * 先 `next()` 再提升——用户已认领的消息保持在前，PAGE 块殿后；提升失败只告警，
 * 绝不打断这一轮。
 * Create the staging face. The listener lives on **that session's agent scope** (the
 * same seam the PAGE-DATA injector uses); it calls `next()` first so the user's
 * claimed message stays ahead and the PAGE block follows; a failed promotion only
 * warns and never breaks the round.
 * @param ctx - 网关上下文（`pageRegistry` / `sessions` / `agents` 都是声明过的 inject）
 * @returns the staging face
 */
export function createAppStaging(ctx: Context): AppStaging {
  const staged = new Map<string, StagedApp>()
  const attached = new Set<string>()
  const disposers: Array<() => void> = []

  /** 把暂存提升成页面会话；返回进入本轮决策的 PAGE 块（失败返回 undefined） */
  const promote = async (sessionId: string): Promise<string | undefined> => {
    const entry = staged.get(sessionId)
    if (entry === undefined) return undefined
    staged.delete(sessionId)
    try {
      // 复用会话：不新建、不 focus、不唤醒——用户这条消息就是那一轮。
      // Reuse the session: no creation, no focus, no wake — the user's message IS that round.
      const opened = await ctx.pageRegistry.openUrl(entry.url as PageInstanceKey, {
        reuseSessionId: sessionId,
        focus: false,
      })
      // 实例标题与会话端口创建路径同一写法（user source；标题 LLM 不再改写）
      // / the instance title uses the session port's spelling (user source; the title LLM never rewrites it)
      ctx.sessions.get(sessionId as never)?.append('session/title', {
        title: opened.title,
        messageSeqs: [],
        source: { kind: 'user' },
      })
      return opened.block
    } catch (error: unknown) {
      ctx.logger.warn(`app-host: promoting session ${sessionId} to ${entry.url} failed: ${String(error)}`)
      return undefined
    }
  }

  /** 在该会话的 agent 作用域挂提升监听（agent 可能尚未创建，等 agent/created） */
  const attach = (sessionId: string): void => {
    if (attached.has(sessionId)) return
    const agent = ctx.agents.get(sessionId as never)
    if (agent === undefined) return
    attached.add(sessionId)
    const dispose = agent.ctx.on('agent/pre-step', async (_payload, next) => {
      // waterfall 契约：先 next()；用户消息在前，PAGE 块殿后
      // / waterfall contract: next() first — the user message stays ahead, the PAGE block follows
      const decision = await next()
      if (decision.kind !== 'enter') {
        staged.delete(sessionId)
        return decision
      }
      const block = await promote(sessionId)
      if (block === undefined) return decision
      return {
        kind: 'enter',
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: block }],
          source: { kind: PAGE_MESSAGE_SOURCE },
        })],
      }
    }, { prepend: true })
    disposers.push(() => dispose())
  }

  const onCreated = ({ agent }: { agent: Agent | undefined }): undefined => {
    const sessionId = agent?.session?.id
    if (typeof sessionId === 'string' && staged.has(sessionId)) attach(sessionId)
    return undefined
  }
  const onDisposed = ({ agent }: { agent: Agent | undefined }): void => {
    const sessionId = agent?.session?.id
    if (typeof sessionId === 'string') attached.delete(sessionId)
  }
  disposers.push(ctx.on('agent/created', onCreated), ctx.on('agent/disposed', onDisposed))

  return {
    stage(sessionId, app) {
      staged.set(sessionId, app)
      attach(sessionId)
    },
    appOf: (sessionId) => staged.get(sessionId),
    unstage(sessionId) { staged.delete(sessionId) },
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      staged.clear()
      attached.clear()
    },
  }
}
