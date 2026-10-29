/**
 * 干跑用的内存会话端口：PageSessionPort 的完整内存实现——会话日志带 source
 * kind（pump 的 task-center/notice、宿主的 app/task、人类打字的 user），agent 的
 * `session.deriveMessages()` 从日志投影（真实 DSH Session 的被认可读面同款语义）。
 * The in-memory session port for the dry run: a full PageSessionPort whose log
 * carries source kinds (the pump's task-center/notice, the host's app/task, a
 * human's user) and whose agent's `session.deriveMessages()` projects the log —
 * the same semantics as the real DSH Session's sanctioned read face.
 * @module dryrun/session-port
 */
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PageSessionPort, PageToolEntry } from '@veren/page-registry'

/** 一条会话日志事件 / one session-log entry */
export interface LogEntry {
  readonly source: string
  readonly text: string
}

/** 一个会话的内存态 / one session's in-memory state */
interface SessionState {
  alive: boolean
  title: string
  log: LogEntry[]
  tools: Map<string, ToolDefinition>
  /** 登记顺序（toolFace 快照用）/ registration order (for toolFace snapshots) */
  order: string[]
}

/**
 * 内存会话端口：状态全部在内存（干跑不需要持久化）；retire/destroy 摘工具的
 * 语义与真实会话机制一致。
 * The in-memory session port: all state lives in memory (the dry run needs no
 * persistence); retire/destroy strip tools exactly like the real session
 * mechanism.
 */
export class MemorySessionPort implements PageSessionPort {
  readonly #sessions = new Map<string, SessionState>()

  /** 会话日志只读视图（断言用）/ a read-only view of one session's log (for assertions) */
  logOf(sessionId: string): readonly LogEntry[] {
    return this.#sessions.get(sessionId)?.log ?? []
  }

  /** 会话标题（instanceTitle 断言用）/ the session title (for instanceTitle assertions) */
  titleOf(sessionId: string): string | undefined {
    return this.#sessions.get(sessionId)?.title
  }

  /** 调试面：取该会话挂着的某个工具（干跑的驱动器用）/ the debug face: one mounted tool of a session (the dry run's driver uses it) */
  toolOf(sessionId: string, name: string): ToolDefinition | undefined {
    return this.#sessions.get(sessionId)?.tools.get(name)
  }

  exists(sessionId: string): boolean {
    return this.#sessions.get(sessionId)?.alive === true
  }

  mintId(): string {
    return `s-${randomUUID()}`
  }

  async create(sessionId: string, title: string): Promise<void> {
    this.#sessions.set(sessionId, { alive: true, title, log: [], tools: new Map(), order: [] })
  }

  /** 活 agent：作用域工具表 + 会话投影（deriveMessages）/ the live agent: the scope tool table + the session projection */
  agentOf(sessionId: string): Agent | undefined {
    const state = this.#sessions.get(sessionId)
    if (state === undefined || !state.alive) return undefined
    return {
      ctx: {
        tools: {
          register: (definition: ToolDefinition) => {
            state.tools.set(definition.name, definition)
            state.order.push(definition.name)
            return () => {
              state.tools.delete(definition.name)
              state.order = state.order.filter((name) => name !== definition.name)
            }
          },
        },
        effect: () => async () => undefined,
        on: () => () => undefined,
      },
      session: {
        id: sessionId,
        deriveMessages: () => state.log.map((entry) => ({
          role: 'user' as const,
          source: { kind: entry.source },
          content: [{ type: 'text' as const, text: entry.text }],
        })),
      },
      followup: (message: { content: ReadonlyArray<{ text?: string }> }) => {
        state.log.push({ source: 'app/page', text: message.content.map((block) => block.text ?? '').join('') })
      },
    } as never
  }

  /** 挂载前后各取快照；差集即页面工具 / snapshots around the mount; the delta is the page's tools */
  toolFace(sessionId: string): readonly PageToolEntry[] {
    const state = this.#sessions.get(sessionId)
    if (state === undefined) return []
    return state.order.map((name) => ({ name, description: state.tools.get(name)?.description ?? '' }))
  }

  async retire(sessionId: string): Promise<void> {
    const state = this.#sessions.get(sessionId)
    if (state !== undefined) {
      state.tools.clear()
      state.order = []
    }
  }

  async appendUserMessage(sessionId: string, text: string, source: string): Promise<void> {
    this.#sessions.get(sessionId)?.log.push({ source, text })
  }

  async focus(): Promise<void> {
    // 干跑无 GUI / no GUI in the dry run
  }

  async destroy(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId)
  }
}
