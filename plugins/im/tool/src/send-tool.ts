/**
 * The `im_send` tool: post one reply into the caller's own room.
 *
 * The room is never a model argument — it comes from caller attribution (the
 * turn service's session map), so a wrong recipient is impossible. Coordination's
 * write gates run inside the post: a HELD refusal is a value result, not an
 * error, because the right move is to rewrite (or stay quiet), not to retry.
 *
 * `im_send` 工具：向调用方自己的房间写入一条回复。
 *
 * 房间绝不是模型参数——它来自调用方归属（回合服务的会话映射），发错对象因此不可能。
 * 协调的写入闸门在写入内部运行：HELD 拒绝是值结果而不是错误，因为正确动作是改写（或保持
 * 安静），而不是原样重试。
 *
 * @module @veren/im-tool/send-tool
 */

import { defineTool, type InferArgs, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError } from '@veren/im'
import type { ConversationService } from '@veren/im-conversation'
import type { CoordinationService, HoldKind, HoldLine } from '@veren/im-coordination'
import type { TurnService } from '@veren/im-turn'
import { placeOf } from './attribution.ts'
import { excerptOf, jsonOf, ok, OUTPUT, outsideRoom, requireString, run } from './values.ts'

/** The tool-level body cap; the conversation domain's own cap is higher. */
/** 工具层的正文上限；会话域自身上限更高。 */
const MAX_BODY_CHARS = 20_000

/**
 * The gate attempt count this tool reports. A tool call carries no turn
 * memory, so every tool-driven post counts as the first attempt (attempts+1
 * over a zero baseline).
 * 本工具上报的闸门尝试次数。工具调用不携带回合记忆，因此每次工具写入都按第一次尝试计
 * （零基线上的 attempts+1）。
 */
const TOOL_GATE_ATTEMPTS = 1

/** `im_send` description: own-room reply, held is a value, never an error. */
/** `im_send` 描述：自己房间内的回复，held 是值而非错误。 */
const SEND_DESCRIPTION = 'Post one reply into YOUR current IM room (the room of this session; there are '
  + 'no room arguments). Your normal turn text already reaches the room — use im_send only for '
  + 'an extra or targeted message. On ok:true the message is committed. On held:true the room '
  + 'moved while you were deciding: read `newer` (the lines you have not seen), then either '
  + 'rewrite your reply to account for them or stay quiet; never resend the same content '
  + '(a verbatim hold means the room\'s latest line is exactly your draft). held is guidance, '
  + 'not an error.'

/** `im_send` parameters. */
/** `im_send` 参数。 */
const SEND_PARAMETERS = {
  body: {
    type: 'string',
    required: true,
    description: `The message text, 1-${MAX_BODY_CHARS} characters.`,
  },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shape of the send tool, derived from the schema. */
/** send 工具的参数形状，由 schema 推导而来。 */
type SendArgs = InferArgs<typeof SEND_PARAMETERS>

/** One held-refusal value result: guidance for the next decision, not an error. */
/** 一次 HELD 拒绝的值结果：给下一次决策的指引，不是错误。 */
function heldResult(kind: HoldKind, newer: readonly HoldLine[], attempts: number, message: string): JsonValue {
  return jsonOf({
    ok: false,
    held: true,
    kind,
    newer: newer.map(line => ({ sequence: line.sequence, authorId: line.authorId, excerpt: excerptOf(line.excerpt, 200) })),
    attempts,
    message,
  })
}

/**
 * Narrow a HELD_* error's structured details into the held result. The details
 * are written by coordination's gate; the narrowing only re-checks their shape.
 * 把 HELD_* 错误的结构化 details 收窄成 held 结果。details 由协调的闸门写入；收窄只复核
 * 形状。
 */
function heldOf(error: ImError): JsonValue {
  const details = error.details ?? {}
  const kind = details['kind'] === 'verbatim' ? 'verbatim' : 'freshness'
  const attempts = typeof details['attempts'] === 'number' ? details['attempts'] : TOOL_GATE_ATTEMPTS
  const rawNewer = Array.isArray(details['newer']) ? details['newer'] : []
  const newer: HoldLine[] = []
  for (const line of rawNewer) {
    if (typeof line !== 'object' || line === null) continue
    const record = line as Record<string, unknown>
    if (typeof record['sequence'] !== 'number' || typeof record['authorId'] !== 'string') continue
    if (typeof record['excerpt'] !== 'string') continue
    newer.push({ sequence: record['sequence'], authorId: record['authorId'], excerpt: record['excerpt'] })
  }
  return heldResult(kind, newer, attempts, error.message)
}

/** Post one gated reply; HELD refusals come back as held values, the rest as envelopes. */
/** 写入一道闸门后的回复；HELD 拒绝以 held 值返回，其余以信封返回。 */
async function postReply(
  conversation: ConversationService,
  coordination: CoordinationService,
  place: { agentParticipantId: string; roomId: string },
  args: SendArgs,
): Promise<JsonValue> {
  const body = requireString(args.body, 'body')
  if (body.length > MAX_BODY_CHARS) {
    throw new ImError('IM_INVALID_REQUEST', `body exceeds ${MAX_BODY_CHARS} characters`)
  }
  const posted = await conversation.post(
    { roomId: place.roomId, actorId: place.agentParticipantId, kind: 'text', body },
    coordination.gatePost(place.agentParticipantId, body, TOOL_GATE_ATTEMPTS),
  )
  return ok({
    messageId: posted.message.id,
    sequence: posted.message.sequence,
    replayed: posted.replayed,
  })
}

/** The `im_send` execution: attribute the caller, then post behind the gates. */
/** `im_send` 执行：归属调用方，随后在闸门之后写入。 */
function sendExecute(
  conversation: ConversationService,
  coordination: CoordinationService,
  turn: TurnService,
): (args: SendArgs, exec: ToolRunContext) => Promise<JsonValue> {
  return async (args, exec) => run(async () => {
    const place = placeOf(turn, exec)
    if (place === undefined) return outsideRoom()
    try {
      return await postReply(conversation, coordination, place, args)
    } catch (error: unknown) {
      if (error instanceof ImError && (error.code === 'HELD_FRESHNESS' || error.code === 'HELD_VERBATIM')) {
        return heldOf(error)
      }
      throw error
    }
  })
}

/**
 * Build the `im_send` tool definition over the conversation + coordination faces.
 * @param conversation - the conversation facade (rooms and writes).
 * @param coordination - the write gates.
 * @param turn - the session→place reverse lookup.
 */
export function imSendTool(
  conversation: ConversationService,
  coordination: CoordinationService,
  turn: TurnService,
) {
  return defineTool({
    name: 'im_send',
    description: SEND_DESCRIPTION,
    parameters: SEND_PARAMETERS,
    output: OUTPUT,
    execute: sendExecute(conversation, coordination, turn),
  })
}
