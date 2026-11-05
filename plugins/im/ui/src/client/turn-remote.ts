/**
 * The browser-side Remote definition for the `imTurn` namespace.
 *
 * The panel polls the turn domain's live activity here while an agent works:
 * the phase (thinking / running a tool / writing the reply), the running
 * tool's name, and the tail of the streamed reasoning. It is a read-only
 * observation of a turn in flight — the reply itself still arrives as one
 * message on the timeline when the run posts it.
 *
 * `imTurn` 命名空间的浏览器侧远端定义。
 *
 * 智能体工作期间，面板在这里轮询回合域的实时活动：阶段（思考 / 调用工具 / 撰写回复）、正在
 * 运行的工具名，以及流式推理的末尾。它是对飞行中回合的只读观测——回复本身仍在运行写入时
 * 作为一条消息落到时间线上。
 *
 * @module @veren/im-ui/client/turn-remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { ActivityView } from '../../../turn/src/index.ts'
import type { ImRemoteResult } from './remote.ts'
import { codec, parameter } from './remote.ts'

/** One running turn, re-exported under the panel's vocabulary. */
/** 一次运行中的回合，以面板的词汇重新导出。 */
export type RoomActivity = ActivityView

/** The mounted `ctx.remote['imTurn']` surface. */
/** 挂载后的 `ctx.remote['imTurn']` 面。 */
export interface ImTurnApi {
  /**
   * Live turns, oldest first; empty when nothing is running.
   * 实时回合，从旧到新；没有在跑的东西时为空。
   */
  readonly activity: (request: {
    readonly roomId?: string
  }) => Promise<ImRemoteResult<{ readonly runs: readonly RoomActivity[] }>>
}

const ACTIVITY_REQUEST = z.looseObject({ roomId: z.string().optional() })
const ACTIVITY_SCHEMA = z.looseObject({
  runId: z.string(),
  roomId: z.string(),
  agentParticipantId: z.string(),
  phase: z.enum(['thinking', 'tool', 'composing']),
  toolName: z.string().optional(),
  reasoning: z.string().optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
})
const ACTIVITY_RESULT = z.looseObject({ runs: z.array(ACTIVITY_SCHEMA) })

export const turnRemote = createTypertRemoteInfo({
  package: '@veren/im-turn',
  methods: {
    'imTurn/activity': {
      service: 'imTurnGateway',
      description: 'Live activity of running turns: phase, tool, reasoning tail.',
      invocation: { kind: 'direct' },
      parameters: [parameter('request', 'imTurn:activity:request', () => ACTIVITY_REQUEST)],
      result: codec('imTurn:activity:result', () => ACTIVITY_RESULT),
    },
  } as Record<string, never>,
}, z)
