/**
 * Live activity of running turns: what the agent is doing right now, for the
 * chat panel's non-interactive working row.
 *
 * Nothing here is durable. The run row is the record; this board is only the
 * view's live edge, fed by session events and assistant stream frames, and an
 * entry disappears the moment its run settles. The panel polls the board, so it
 * also drops entries that stopped updating — a crashed run must never leave a
 * permanent "thinking" row.
 *
 * 正在运行的回合的实时活动：智能体此刻在做什么，供聊天面板那条不可交互的工作行使用。
 *
 * 这里没有持久化。运行行才是记录；本板只是视图的实时边缘，由会话事件与助手流帧喂养，运行
 * 落定的瞬间条目消失。面板轮询本板，因此它也会丢弃停止更新的条目——崩溃的运行绝不能留下
 * 一条永久的「思考中」。
 *
 * @module @veren/im-turn/activity
 */

import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** What the agent is doing in one live turn. */
/** 一个实时回合里智能体正在做的事。 */
export type ActivityPhase = 'thinking' | 'tool' | 'composing'

/** One running turn as the panel's working row renders it. */
/** 面板工作行渲染的一次运行中回合。 */
export interface ActivityView {
  readonly runId: string
  readonly roomId: string
  readonly agentParticipantId: string
  readonly phase: ActivityPhase
  /** The running tool's name, present exactly in the `tool` phase. */
  /** 正在运行的工具名，恰在 `tool` 阶段出现。 */
  readonly toolName?: string
  /** The tail of the streamed reasoning, whitespace-collapsed. */
  /** 流式推理的末尾，空白已折叠。 */
  readonly reasoning?: string
  readonly startedAt: number
  readonly updatedAt: number
}

/** How much streamed reasoning one entry keeps for the view. */
/** 一个条目为视图保留多少流式推理。 */
const REASONING_TAIL_CHARS = 600

/**
 * How long an entry may go without an update before the board treats it as
 * dead. The reply timeout (120s by default) settles a live run long before
 * this; the bound only catches a run whose settlement never ran.
 * 条目多久不更新就被本板视为已死。回复超时（默认 120 秒）远早于此落定一个实时运行；这个
 * 上界只兜住「结算从未执行」的运行。
 */
const STALE_AFTER_MS = 10 * 60_000

/** Mutable bookkeeping for one live run. */
/** 一次实时运行的可变记录。 */
interface Entry {
  readonly runId: string
  readonly roomId: string
  readonly agentParticipantId: string
  readonly startedAt: number
  sessionId: string | undefined
  phase: ActivityPhase
  toolName: string | undefined
  reasoning: string
  updatedAt: number
}

/** The in-memory board of live turns. */
/** 实时回合的内存板。 */
export class ActivityBoard {
  private readonly entries = new Map<string, Entry>()
  private readonly bySession = new Map<string, string>()

  /**
   * @param now - injectable clock (tests drive staleness through it).
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Register one run as live. The session attaches a moment later, once the
   * turn has resolved (or created) the agent's session.
   * 把一个运行登记为实时。会话稍后挂上——回合解析（或新建）智能体会话之后。
   * @param input - the run's identity and where it runs.
   */
  begin(input: { readonly runId: string; readonly roomId: string; readonly agentParticipantId: string }): void {
    const at = this.now()
    this.entries.set(input.runId, {
      ...input,
      startedAt: at,
      updatedAt: at,
      phase: 'thinking',
      sessionId: undefined,
      toolName: undefined,
      reasoning: '',
    })
  }

  /**
   * Point one run at the session whose events describe it.
   * 让一个运行指向描述它的那个会话。
   * @param runId - the live run.
   * @param sessionId - the agent session driving it.
   */
  attachSession(runId: string, sessionId: string): void {
    const entry = this.entries.get(runId)
    if (entry === undefined) return
    entry.sessionId = sessionId
    this.bySession.set(sessionId, runId)
  }

  /**
   * Forget one run; called when the run lands in any terminal state.
   * 忘掉一个运行；运行落入任何终态时调用。
   * @param runId - the run that settled.
   */
  finish(runId: string): void {
    const entry = this.entries.get(runId)
    if (entry === undefined) return
    if (entry.sessionId !== undefined) this.bySession.delete(entry.sessionId)
    this.entries.delete(runId)
  }

  /**
   * Fold one session event of a live run into its phase.
   * 把一个实时运行的会话事件折叠进它的阶段。
   * @param sessionId - the session the event belongs to.
   * @param event - the appended session event.
   */
  observeEvent(sessionId: string, event: SessionEvent): void {
    const entry = this.entryOf(sessionId)
    if (entry === undefined) return
    switch (event.type) {
      case 'step/start':
        this.moveTo(entry, 'thinking')
        return
      case 'tool/call':
        this.moveTo(entry, 'tool', event.data.name)
        return
      case 'tool/result':
        this.moveTo(entry, 'thinking')
        return
      case 'assistant/message':
        this.moveTo(entry, hasVisibleText(event.data.message) ? 'composing' : 'thinking')
        return
      default:
        return
    }
  }

  /**
   * Fold one live assistant stream frame of a live run into its phase and
   * reasoning tail. Text deltas mean the reply is being written; reasoning
   * deltas are the thinking process the panel shows.
   * 把一个实时运行的助手流帧折叠进它的阶段与推理末尾。文本增量表示正在撰写回复；推理增量
   * 就是面板展示的思考过程。
   * @param sessionId - the session the frame belongs to.
   * @param frame - one live stream publication.
   */
  observeStream(sessionId: string, frame: AssistantStreamFrame): void {
    const entry = this.entryOf(sessionId)
    if (entry === undefined || frame.type !== 'chunk') return
    if (frame.chunk.type === 'reasoning-delta') {
      this.moveTo(entry, 'thinking')
      this.appendReasoning(entry, frame.chunk.text)
      return
    }
    if (frame.chunk.type === 'text-delta') this.moveTo(entry, 'composing')
  }

  /** Every live run, oldest first. */
  /** 全部实时运行，从旧到新。 */
  all(): ActivityView[] {
    const at = this.now()
    const live: Entry[] = []
    for (const entry of this.entries.values()) {
      if (at - entry.updatedAt > STALE_AFTER_MS) {
        this.finish(entry.runId)
        continue
      }
      live.push(entry)
    }
    return live.sort((left, right) => left.startedAt - right.startedAt).map(entry => viewOf(entry))
  }

  /** The live runs of one room, oldest first. */
  /** 一个房间的实时运行，从旧到新。 */
  ofRoom(roomId: string): ActivityView[] {
    return this.all().filter(view => view.roomId === roomId)
  }

  /** The live entry behind one session, if that session is mid-run. */
  /** 一个会话背后的实时条目（该会话正在跑才有）。 */
  private entryOf(sessionId: string): Entry | undefined {
    const runId = this.bySession.get(sessionId)
    return runId === undefined ? undefined : this.entries.get(runId)
  }

  /** Move one entry to a phase; an unchanged phase is not an update. */
  /** 把一个条目移到某阶段；阶段未变不算更新。 */
  private moveTo(entry: Entry, phase: ActivityPhase, toolName?: string): void {
    if (entry.phase === phase && entry.toolName === toolName) return
    entry.phase = phase
    entry.toolName = toolName
    entry.updatedAt = this.now()
  }

  /** Append one reasoning delta, keeping only the tail the panel can show. */
  /** 追加一条推理增量，只保留面板能展示的末尾。 */
  private appendReasoning(entry: Entry, text: string): void {
    entry.reasoning = `${entry.reasoning}${text}`.slice(-REASONING_TAIL_CHARS)
    entry.updatedAt = this.now()
  }
}

/** Project one entry into its public view. */
/** 把一个条目投影成公开视图。 */
function viewOf(entry: Entry): ActivityView {
  const reasoning = entry.reasoning.replace(/\s+/gu, ' ').trim()
  return {
    runId: entry.runId,
    roomId: entry.roomId,
    agentParticipantId: entry.agentParticipantId,
    phase: entry.phase,
    ...(entry.toolName === undefined ? {} : { toolName: entry.toolName }),
    ...(reasoning === '' ? {} : { reasoning }),
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
  }
}

/** Whether one assembled assistant message carries visible text. */
/** 一条组装好的助手消息是否带可见文本。 */
function hasVisibleText(message: { readonly content: readonly { readonly type: string }[] }): boolean {
  return message.content.some(block => block.type === 'text')
}
