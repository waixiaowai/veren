/**
 * The memory tools: `im_remember` (keep one durable fact) and `im_recall`
 * (read the agent's own memory back).
 *
 * Memory is per agent participant: the caller attribution decides whose memory
 * the tool touches, and the model can never write into another agent's store.
 * The recall scope filter (project = DSH workspace) is the memory service's;
 * the tool only narrows by `about`.
 *
 * 记忆工具：`im_remember`（保留一条持久事实）与 `im_recall`（把智能体自己的记忆读回来）。
 *
 * 记忆按智能体参与者隔离：调用方归属决定工具触碰谁的记忆，模型绝写不进别人的存储。召回的
 * 作用域过滤（项目 = DSH 工作区）是记忆服务的职责；工具只按 `about` 收窄。
 *
 * @module @veren/im-tool/memory-tools
 */

import { defineTool, type InferArgs, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ImMemory } from '@veren/im'
import type { TurnService } from '@veren/im-turn'
import { placeOf } from './attribution.ts'
import { ok, OUTPUT, outsideRoom, requireString, run } from './values.ts'

/** `im_remember` description: durable facts, one entry per save. */
/** `im_remember` 描述：持久事实，每次保存一条。 */
const REMEMBER_DESCRIPTION = 'Keep one durable fact for future conversations: a person\'s preference, a decision, '
  + 'an observation worth remembering. The memory belongs to you (this agent) and survives restarts; '
  + 'recall happens through im_recall. Write only facts worth keeping — not chatter. `about` should be '
  + 'the participant id of the person or agent the fact concerns, when there is one. `pinned: true` '
  + 'keeps it at the top of every recall. Saving again updates in place; memory entries are never '
  + 'shown to the human automatically.'

/** `im_remember` parameters. */
/** `im_remember` 参数。 */
const REMEMBER_PARAMETERS = {
  kind: {
    type: 'string',
    enum: ['observation', 'preference', 'fact', 'decision', 'note'],
    required: true,
    description: 'What kind of fact this is.',
  },
  body: { type: 'string', required: true, description: 'The fact itself, one self-contained sentence or two.' },
  about: { type: 'string', description: 'Participant id (or free-form subject) the fact concerns.' },
  pinned: { type: 'boolean', description: 'Keep it at the top of every recall.' },
} as const satisfies ParameterSchemaSpec

/** `im_recall` description: your own memory, scoped and capped. */
/** `im_recall` 描述：自己的记忆，带作用域与上限。 */
const RECALL_DESCRIPTION = 'Read your own long-term memory: pinned entries first, then the most recently updated. '
  + 'Project-scoped memories only surface for their project; `about` narrows to one person or subject. '
  + 'Use it before answering questions about people or past decisions — memory is the durable record, '
  + 'the room transcript is not.'

/** `im_recall` parameters. */
/** `im_recall` 参数。 */
const RECALL_PARAMETERS = {
  about: { type: 'string', description: 'Narrow to memories about this participant id or subject.' },
  limit: { type: 'number', description: 'Maximum entries (default 40, the service cap).' },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shapes. */
/** 推导出的参数形状。 */
type RememberArgs = InferArgs<typeof REMEMBER_PARAMETERS>
type RecallArgs = InferArgs<typeof RECALL_PARAMETERS>

/** The `im_remember` execution: attribute the caller, then persist one fact. */
/** `im_remember` 执行：归属调用方，然后持久化一条事实。 */
function rememberExecute(memory: ImMemory, turn: TurnService): (args: RememberArgs, exec: ToolRunContext) => Promise<JsonValue> {
  return async (args, exec) => run(async () => {
    const place = placeOf(turn, exec)
    if (place === undefined) return outsideRoom()
    const row = await memory.remember({
      agentParticipantId: place.agentParticipantId,
      kind: args.kind,
      body: requireString(args.body, 'body'),
      ...(args.about === undefined ? {} : { about: args.about }),
      ...(args.pinned === undefined ? {} : { pinned: args.pinned }),
      roomId: place.roomId,
    })
    return ok({ id: row.id, kind: row.kind, updatedAt: row.updated_at })
  })
}

/** The `im_recall` execution: read the caller's own memory. */
/** `im_recall` 执行：读取调用方自己的记忆。 */
function recallExecute(memory: ImMemory, turn: TurnService): (args: RecallArgs, exec: ToolRunContext) => Promise<JsonValue> {
  return async (args, exec) => run(async () => {
    const place = placeOf(turn, exec)
    if (place === undefined) return outsideRoom()
    const entries = memory.recall({
      agentParticipantId: place.agentParticipantId,
      ...(args.about === undefined ? {} : { about: args.about }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    })
    return ok({ memories: entries.map(row => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      pinned: row.pinned,
      updatedAt: row.updated_at,
    })) })
  })
}

/** Build the `im_remember` tool definition over the memory face. */
/** 在记忆面之上构建 `im_remember` 工具定义。 */
export function imRememberTool(memory: ImMemory, turn: TurnService) {
  return defineTool({
    name: 'im_remember',
    description: REMEMBER_DESCRIPTION,
    parameters: REMEMBER_PARAMETERS,
    output: OUTPUT,
    execute: rememberExecute(memory, turn),
  })
}

/** Build the `im_recall` tool definition over the memory face. */
/** 在记忆面之上构建 `im_recall` 工具定义。 */
export function imRecallTool(memory: ImMemory, turn: TurnService) {
  return defineTool({
    name: 'im_recall',
    description: RECALL_DESCRIPTION,
    parameters: RECALL_PARAMETERS,
    output: OUTPUT,
    execute: recallExecute(memory, turn),
  })
}
