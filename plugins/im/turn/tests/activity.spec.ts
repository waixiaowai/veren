/**
 * The live-activity board: the panel's working row is fed by session events
 * (phase) and assistant stream frames (reasoning tail, reply in progress). The
 * board must never outlive a run, never grow without bound, and never keep a
 * dead entry alive.
 *
 * 实时活动板：面板的工作行由会话事件（阶段）与助手流帧（推理末尾、回复进行中）喂养。
 * 本板绝不能比运行活得更久、绝不能无界增长，也绝不能让死条目一直留着。
 */

import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, LlmAttemptId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { ActivityBoard } from '../src/activity.ts'

/** One reasoning or text delta frame of a live assistant stream. */
function deltaFrame(kind: 'reasoning-delta' | 'text-delta', text: string): AssistantStreamFrame {
  return {
    type: 'chunk',
    attemptId: LlmAttemptId('attempt-1'),
    revision: 1,
    index: 0,
    time: 1,
    chunk: { type: kind, index: 0, text },
  }
}

/** One tool/call event, as the loop appends it before executing the tool. */
function toolCallEvent(name: string): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq: SessionSeq(1),
    time: 1,
    data: { turn: 1, step: 1, callId: ToolCallId('call-1'), name, arguments: '{}' },
  }
}

/** One tool/result event closing the call above. */
function toolResultEvent(): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: SessionSeq(2),
    time: 2,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    },
  }
}

/** One assistant message, with or without visible text. */
function assistantEvent(withText: boolean): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(3),
    time: 3,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: withText ? [{ type: 'text', text: '答复' }] : [{ type: 'reasoning', text: '想想' }],
        source: { provider: 'test', model: 'test' },
      }),
      stream: [],
    },
  }
}

/** A board with one live run already attached to its session. */
function liveBoard(now: () => number = () => 1_000): ActivityBoard {
  const board = new ActivityBoard(now)
  board.begin({ runId: 'run-1', roomId: 'room-1', agentParticipantId: 'agent:alice' })
  board.attachSession('run-1', 'session-1')
  return board
}

describe('activity board', () => {
  it('reports a begun run as thinking and forgets it once the run settles', () => {
    const board = liveBoard()
    expect(board.all()).toEqual([{
      runId: 'run-1',
      roomId: 'room-1',
      agentParticipantId: 'agent:alice',
      phase: 'thinking',
      startedAt: 1_000,
      updatedAt: 1_000,
    }])
    board.finish('run-1')
    expect(board.all()).toEqual([])
  })

  it('keeps only the tail of the streamed reasoning, whitespace-collapsed', () => {
    const board = liveBoard()
    board.observeStream('session-1', deltaFrame('reasoning-delta', '先看\n\n 目录，'))
    board.observeStream('session-1', deltaFrame('reasoning-delta', '再读文件。'))
    expect(board.all()[0]?.reasoning).toBe('先看 目录，再读文件。')
    board.observeStream('session-1', deltaFrame('reasoning-delta', 'x'.repeat(1_000)))
    expect(board.all()[0]?.reasoning?.length).toBe(600)
  })

  it('names the running tool and returns to thinking after its result', () => {
    const board = liveBoard()
    board.observeEvent('session-1', toolCallEvent('bash'))
    expect(board.all()[0]?.phase).toBe('tool')
    expect(board.all()[0]?.toolName).toBe('bash')
    board.observeEvent('session-1', toolResultEvent())
    expect(board.all()[0]?.phase).toBe('thinking')
    expect(board.all()[0]?.toolName).toBeUndefined()
  })

  it('treats a streamed text delta as the reply being written', () => {
    const board = liveBoard()
    board.observeStream('session-1', deltaFrame('text-delta', '好的'))
    expect(board.all()[0]?.phase).toBe('composing')
    // An assistant message with text keeps composing; a tool-only one thinks.
    // 带文本的助手消息仍是撰写；只有工具调用的消息回到思考。
    board.observeEvent('session-1', assistantEvent(true))
    expect(board.all()[0]?.phase).toBe('composing')
    board.observeEvent('session-1', assistantEvent(false))
    expect(board.all()[0]?.phase).toBe('thinking')
  })

  it('ignores events of sessions it does not own', () => {
    const board = liveBoard()
    board.observeEvent('session-other', toolCallEvent('bash'))
    board.observeStream('session-other', deltaFrame('text-delta', '别人的回复'))
    expect(board.all()[0]).toMatchObject({ phase: 'thinking', runId: 'run-1' })
  })

  it('drops an entry that stopped updating, so a crashed run cannot linger', () => {
    let clock = 1_000
    const board = liveBoard(() => clock)
    clock += 10 * 60_000 + 1
    expect(board.all()).toEqual([])
    // The dropped entry is gone for good, not merely hidden.
    // 被丢弃的条目是彻底移除，不是藏起来。
    clock = 1_000
    expect(board.all()).toEqual([])
  })

  it('narrows to one room and orders runs oldest first', () => {
    let clock = 1_000
    const board = new ActivityBoard(() => clock)
    board.begin({ runId: 'run-b', roomId: 'room-2', agentParticipantId: 'agent:bob' })
    clock += 10
    board.begin({ runId: 'run-a', roomId: 'room-1', agentParticipantId: 'agent:alice' })
    expect(board.all().map(view => view.runId)).toEqual(['run-b', 'run-a'])
    expect(board.ofRoom('room-1').map(view => view.runId)).toEqual(['run-a'])
  })
})
