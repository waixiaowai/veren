/**
 * 应用暂存（选择应用 ≠ 立刻开会话）。
 *
 * 客户端在应用下拉里选中应用时做两件事：把该页面的**工具面预挂**到当前会话
 * （`pageRegistry.mountPreview`：渲染一次收集 catalog + 动态工具，不建实例、不写
 * 索引、不追加块），并登记意图（{@link AppStaging.stage}）。这样模型第一步的
 * 请求头里就是最终的工具面——宿主在 `agent/pre-step` 里挂工具已晚于该步的工具
 * 收集，只能从下一步生效（真机观测：第一步旧工具面、第二步"工具已更新"）。
 * 该会话的首条用户消息触发 `agent/pre-step`，才把它提升为真正的页面会话：
 * - 页面实例落进索引（`openUrl` 的复用路径，不新建会话、不 focus）；
 * - PAGE 块作为**本轮决策消息**进入上下文（只落日志的话这一轮看不到页面）；
 * - 页面工具用同一套定义重挂（预挂的旧对象随整组挂载被替换），侧栏标题换成
 *   实例标题。
 *
 * Staged apps (picking an app does not start a session). Selecting an app in the
 * dropdown does two things: it **pre-mounts that page's tool face** on the
 * current session (`pageRegistry.mountPreview` — one render to collect the
 * catalog + dynamic tools; no instance, no index row, no block) and records the
 * intent ({@link AppStaging.stage}). This way the model's step-1 request header
 * already carries the final tool face — mounting tools inside `agent/pre-step`
 * happens after that step's tool collection and can only take effect on the
 * next step (live evidence: step 1 ran the old face, step 2 got "tools
 * updated"). The session's first user message drives `agent/pre-step`, which
 * promotes it into a real page session: the instance lands in the index
 * (openUrl's reuse path — no session creation, no focus), the PAGE block enters
 * the *current step's decision* (landing it in the log alone would hide the
 * page from this round), the page tools are re-mounted with the same
 * definitions (the whole preview set is replaced), and the sidebar title
 * becomes the instance title.
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

/** 暂存面：预挂、登记、查询、卸载 / the staging face: pre-mount, record, read, dispose */
export interface AppStaging {
  /**
   * 预挂该页面的工具面并登记意图（幂等：同一 URL 再选不重复渲染；换应用则
   * 重挂新面）。渲染/首屏 load 失败时不登记，错误原样抛给调用方。
   * Pre-mount the page's tool face and record the intent (idempotent: the same
   * url is not re-rendered; a different app replaces the face). A render or
   * first-screen failure records nothing and rethrows to the caller.
   */
  stage(sessionId: string, app: StagedApp): Promise<void>
  /** 取该会话暂存的应用（未暂存 → undefined）/ the staged app of one session, if any */
  appOf(sessionId: string): StagedApp | undefined
  /**
   * 取消暂存（用户改主意）：摘掉预挂的工具面，之后的首条消息按普通会话走。
   * 只有确实暂存过才释放——真实页面会话不走这里。
   * Drop the staged app: release the pre-mounted face; the next message then
   * runs as an ordinary session. Releases only when something was staged —
   * real page sessions never go through here.
   */
  unstage(sessionId: string): Promise<void>
  /** 装配卸载：摘掉全部 pre-step 监听与登记，并释放预挂面 / assembly unload: drop listeners and records, release previews */
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
      // 提升失败：预挂的工具面不能留在一条不再是页面会话的会话上（openUrl 的
      // 回滚已摘过一次，这里兜底解析/索引阶段的早期失败；releaseTools 幂等）。
      // A failed promotion must not leave the pre-mounted face on a session that
      // is not a page session (openUrl's rollback already released once; this
      // covers early resolve/index failures; releaseTools is idempotent).
      await ctx.pageRegistry.releasePreview(sessionId).catch(() => undefined)
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
        await ctx.pageRegistry.releasePreview(sessionId).catch(() => undefined)
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
    if (typeof sessionId !== 'string') return
    attached.delete(sessionId)
    // agent 销毁会带走预挂的工具面（作用域随 fiber 注销）。暂存意图也一起丢掉：
    // 留着它，重建后的 agent 没有任何页面工具，首条消息会用旧工具面跑完第一步
    // （正是本轮要消灭的形态）；用户重开会话后重新选择即可。
    // Agent disposal takes the pre-mounted face with it (the scope dies with the
    // fiber). Drop the staged intent too: keeping it would let a recreated agent
    // run step 1 without the page tools (exactly the shape this round removes);
    // the user re-picks after reopening.
    staged.delete(sessionId)
  }
  disposers.push(ctx.on('agent/created', onCreated), ctx.on('agent/disposed', onDisposed))

  return {
    async stage(sessionId, app) {
      // 同一 URL 重选：面已经在，幂等返回；换应用：新面整组替换旧面后再登记。
      // Same url again: the face is already mounted, idempotent; a different
      // app replaces the whole face before the record moves.
      if (staged.get(sessionId)?.url === app.url) return
      try {
        // 预挂发生在用户发送之前：渲染一次收集工具，不建实例、不写索引。
        // / the pre-mount happens before the user sends: one render to collect
        // the tools, no instance, no index row.
        await ctx.pageRegistry.mountPreview(sessionId, app.url)
      } catch (error: unknown) {
        // 预挂失败：端口已把旧面整组替换/释放，登记必须一起清掉——否则首条消息
        // 会提升一个不存在的工具面。错误原样抛给 GUI 显示原因。
        // A failed pre-mount: the port already replaced/released the old face,
        // so the record must go too — otherwise the first message would promote
        // a face that is not there. The error rethrows for the GUI to show.
        staged.delete(sessionId)
        throw error
      }
      staged.set(sessionId, app)
      attach(sessionId)
    },
    appOf: (sessionId) => staged.get(sessionId),
    async unstage(sessionId) {
      // 只有真的暂存过才释放：真实页面会话的释放走废弃路径，不能被这里误摘。
      // Release only when something was staged: real page sessions release
      // through deprecation and must never be stripped here.
      if (!staged.delete(sessionId)) return
      await ctx.pageRegistry.releasePreview(sessionId).catch((error: unknown) => {
        ctx.logger.warn(`app-host: releasing the preview of ${sessionId} failed: ${String(error)}`)
      })
    },
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      for (const sessionId of staged.keys()) {
        void ctx.pageRegistry.releasePreview(sessionId).catch((error: unknown) => {
          ctx.logger.warn(`app-host: releasing the preview of ${sessionId} on unload failed: ${String(error)}`)
        })
      }
      staged.clear()
      attached.clear()
    },
  }
}
