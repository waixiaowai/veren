/**
 * 真实会话端口：把 page-registry 对 DSH 会话机制的假设接到真实宿主面上。
 * The real session port: binds page-registry's session assumptions to the
 * real host services (`ctx.sessions` / `ctx.agents`).
 *
 * 与第 1 阶段的 `createHostSessionPort`（宿主全局工具表 + 事后显式释放）不同：
 * - 页面工具优先挂**该会话 agent 作用域**（`agent.ctx.tools.register`）——只有
 *   这个 agent 可见，agent 销毁随其 fiber 自动释放，跨会话互不可见；
 * - agent 尚未激活时工具进入等待队列，`agent/created` 到达即挂上（新建的
 *   页面会话在用户真正进入时才有 agent）；
 * - 消息经 `agent.followup` + `ctx.sessions.flush` 确认（forum 的投递纪律）；
 * - focus 是显式接缝（{@link FocusPort}）：本文件只给日志实现，GUI 切换归 H。
 *
 * 会话作用域的解析收在 {@link resolveAgentScope} 一个函数里：测试可以注入
 * 每会话独立的真实 cordis 子上下文（与 AgentRegistry 的
 * `resolve: sessionId => this.get(sessionId)?.ctx` 同机制），生产路径解析
 * `ctx.agents.get(sessionId)?.ctx`。
 * @module @veren/app-host/session-port
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 dsh-agent 的 Agent 类型与 agent/created|disposed 事件 declaration merging
// type-only import: pulls the Agent type and the agent/created|disposed event merges
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MountedTool, PageSessionPort } from '@veren/page-registry'

/** focus 接缝：把界面切到某会话（GUI 实现归 H；此处为日志实现） */
export interface FocusPort {
  focus(sessionId: string): Promise<void>
}

/** 日志 focus 实现（H 接入前的占位，接口已定） */
export function loggingFocus(logger: { info(message: string): void }): FocusPort {
  return {
    focus: async (sessionId) => { logger.info(`app-host: focus session ${sessionId} (GUI focus lands with the toolbar app dropdown)`) },
  }
}

/** 消息源 kind 常量（MessageSourceMap 的扩充点在文件尾 declaration merging） */
export const PAGE_MESSAGE_SOURCE = 'app/page' as const
export const TASK_MESSAGE_SOURCE = 'app/task' as const
export const NOTICE_MESSAGE_SOURCE = 'task-center/notice' as const

/** 宿主 sessions 服务的最小面（结构探测；权威类型在 @deepseek-ai/dsh-session，
 *  本插件不为一个探测点引入该依赖）/ minimal sessions face (probed; authoritative
 *  types live in dsh-session, not worth a dependency for one probe) */
interface SessionsFace {
  get(id: string): { id?: string } | undefined
  create(id?: string): unknown
  flush?(session: unknown): Promise<boolean> | boolean
}

/** 宿主 agents 服务的最小面 / minimal agents face */
interface AgentsFace {
  get(id: string): Agent | undefined
}

/** 消息源 → MessageSourceMap kind 的白名单（declaration merging 见文件尾） */
type PageSourceKind = typeof PAGE_MESSAGE_SOURCE | typeof TASK_MESSAGE_SOURCE | typeof NOTICE_MESSAGE_SOURCE

function sourceKind(source: string): PageSourceKind {
  switch (source) {
    case TASK_MESSAGE_SOURCE: return TASK_MESSAGE_SOURCE
    case NOTICE_MESSAGE_SOURCE: return NOTICE_MESSAGE_SOURCE
    default: return PAGE_MESSAGE_SOURCE
  }
}

/**
 * 构造真实会话端口。
 * @param ctx - 宿主上下文（读 `sessions` / `agents` 服务）
 * @param focus - focus 接缝（GUI 实现归 H）
 */
export function createRealSessionPort(ctx: Context, focus: FocusPort = loggingFocus(ctx.logger)): PageSessionPort {
  const sessions = (): SessionsFace | undefined => ctx.get('sessions') as SessionsFace | undefined
  const agents = (): AgentsFace | undefined => ctx.get('agents') as AgentsFace | undefined
  const agentOf = (sessionId: string): Agent | undefined => agents()?.get(sessionId)
  // 会话 → 该会话当前挂载的注销器（agent 作用域注销器，重挂/清理用）
  const mounted = new Map<string, Array<() => void>>()
  // 会话 → 等待 agent 激活的开场内容（PAGE/TASK/通知块）与工具；
  // agent/created 到达即按序落地——页面会话的内容随它的第一个 agent 开始存在
  const queued = new Map<string, { tools: readonly MountedTool[]; blocks: Array<{ source: string; text: string }> }>()

  const releaseMounted = (sessionId: string): void => {
    const disposers = mounted.get(sessionId)
    mounted.delete(sessionId)
    // 逆序释放；单个失败只影响该会话，不中断其余（§5.6 语义）
    for (const dispose of (disposers ?? []).reverse()) {
      try {
        dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`app-host: releaseTools(${sessionId}) entry failed: ${String(error)}`)
      }
    }
  }

  const followup = (agent: Agent, text: string, source: string): void => {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: sourceKind(source) },
    }))
  }

  /** 把一组工具与排队块挂进某个 agent 作用域（每次挂载即一次整组登记） */
  const mountOnAgent = (sessionId: string, agent: Agent, pending: { tools: readonly MountedTool[]; blocks: Array<{ source: string; text: string }> }): void => {
    releaseMounted(sessionId)
    const disposers: Array<() => void> = []
    for (const tool of pending.tools) disposers.push(agent.ctx.tools.register(tool))
    mounted.set(sessionId, disposers)
    for (const block of pending.blocks) followup(agent, block.text, block.source)
  }

  // agent 激活：等待队列里的页面工具此刻才真正挂上（只对该 agent 可见），
  // 排队的 PAGE/TASK/通知块按序 followup 进会话。
  // 事件与载荷走 dsh-agent 的 declaration merging 真实类型，无断言。
  ctx.on('agent/created', ({ agent }): undefined => {
    const sessionId = agent?.session?.id
    if (sessionId === undefined) return undefined
    const pending = queued.get(sessionId)
    if (pending === undefined) return undefined
    queued.delete(sessionId)
    mountOnAgent(sessionId, agent, pending)
    return undefined
  })
  // agent 销毁：作用域注册随 fiber 自动消失，这里只清登记
  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id
    if (sessionId !== undefined) mounted.delete(sessionId)
  })

  return {
    exists: (sessionId) => sessions()?.get(sessionId) !== undefined,
    mintId: () => crypto.randomUUID(),
    async create(sessionId) {
      const store = sessions()
      if (store?.create === undefined) {
        ctx.logger.warn('app-host: no "sessions" service; page session cannot be created')
        throw new Error('app-host: host "sessions" service is unavailable')
      }
      store.create(sessionId as never)
      // 会话标题归 session-title 投影/用户重命名（H 接 GUI 时按 instanceTitle 落）
    },
    async appendUserMessage(sessionId, text, source) {
      const agent = agentOf(sessionId)
      if (agent !== undefined) {
        followup(agent, text, source)
        const flushed = await sessions()?.flush?.(agent.session)
        if (flushed === false) {
          ctx.logger.warn(`app-host: session ${sessionId} did not flush the "${source}" block`)
        }
        return
      }
      // agent 未激活：入队，随 agent/created 与工具一起落地（页面会话的内容
      // 随它的第一个 agent 开始存在）
      const pending = queued.get(sessionId) ?? { tools: [], blocks: [] }
      pending.blocks.push({ source, text })
      queued.set(sessionId, pending)
    },
    async mountTools(sessionId, tools) {
      const agent = agentOf(sessionId)
      if (agent !== undefined) {
        // 活 agent：直接挂 agent 作用域——只有该 agent 可见，销毁随 fiber 释放
        mountOnAgent(sessionId, agent, { tools, blocks: [] })
        return
      }
      // agent 未激活（打开时用户尚未进入会话）：入队，agent/created 到达即挂上
      const pending = queued.get(sessionId) ?? { tools: [], blocks: [] }
      queued.set(sessionId, { tools, blocks: pending.blocks })
    },
    async releaseTools(sessionId) {
      const pending = queued.get(sessionId)
      queued.set(sessionId, { tools: [], blocks: pending?.blocks ?? [] })
      releaseMounted(sessionId)
    },
    focus: (sessionId) => focus.focus(sessionId),
    async destroy(sessionId) {
      queued.delete(sessionId)
      releaseMounted(sessionId)
    },
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page-session PAGE block (or TASK / task-center notice) appended by app-host. @persistenceSource user */
    'app/page': { kind: 'app/page' }
    /** A TASK block appended after a task take. @persistenceSource user */
    'app/task': { kind: 'app/task' }
    /** A task-center inbox notice pumped into a page session. @persistenceSource user */
    'task-center/notice': { kind: 'task-center/notice' }
  }
}
