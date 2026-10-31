/**
 * The `im_send` tool: one explicit target, one content block, no fallbacks.
 *
 * Every failure mode that would risk a wrong recipient fails closed with a
 * stable `IM_*` code; the tool result carries the recipient evidence so the
 * model can show the user exactly who was matched and by what.
 *
 * `im_send` 工具：目标显式、内容单块、绝不回退。
 *
 * 一切可能发错人的失败都以稳定 `IM_*` 码关闭；工具结果携带收件人证据，模型据此向用户
 * 展示到底匹配了谁、依据是什么。
 *
 * @module @veren/im-tool/send-tool
 */

import { defineTool, type InferArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError } from '@veren/im'
import type { ImRouter } from '@veren/im'
import { OUTPUT, fileContentOf, ok, requireString, run } from './values.ts'

/** `im_send` description: one explicit target, fail-closed on ambiguity. */
/** `im_send` 描述：目标显式，歧义即拒绝。 */
const IM_SEND_DESCRIPTION = 'Send one content block. Name exactly one target: person (id, exact nickname, real '
  + 'name, remark, contact, address, or a self-reported claimedName), bindingId, or accountId + '
  + 'conversationId. There is no implicit current conversation. With person, accountId/provider '
  + 'only narrow the address. The router sends only an exact, unique match; on IM_AMBIGUOUS or '
  + 'IM_NOT_FOUND it does NOT send. In that case show the candidates/suggestions and ask the user '
  + 'instead of guessing. A successful send returns recipient evidence (matchedBy/matchedValue '
  + 'plus identityStatus) to show the user: claimedName means the person called themselves that, '
  + 'not that the name was verified. Text is segmented by the provider limit; unsupported media '
  + 'fails with IM_UNSUPPORTED.'

/** `im_send` parameters. */
/** `im_send` 参数。 */
const IM_SEND_PARAMETERS = {
  person: {
    type: 'string',
    description: 'Recipient person: id, exact nickname, real name, alias/remark, contact, address, '
      + 'or an unverified claimedName. When matchedBy is claimedName, tell the user it is self-reported.',
  },
  provider: { type: 'string', description: 'With person: only this provider, for example wechat.' },
  bindingId: { type: 'string', description: 'Target binding.' },
  accountId: { type: 'string', description: 'Explicit target account, or a person address filter.' },
  conversationId: { type: 'string', description: 'Explicit target conversation.' },
  text: { type: 'string', description: 'Text to send.' },
  files: {
    type: 'array',
    items: { type: 'string' },
    description: 'One local file path; V1 WeChat rejects files.',
  },
  replyTo: { type: 'string', description: 'Message id to reply to.' },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shape of the send tool, derived from the schema. */
/** send 工具的参数形状，由 schema 推导而来。 */
type SendArgs = InferArgs<typeof IM_SEND_PARAMETERS>

/** Resolve exactly one of text or files into a content block. */
/** 从 text 与 files 中解析出恰好一个内容块。 */
async function contentOf(args: { text?: string; files?: string[] }) {
  const files = args.files ?? []
  if ((args.text === undefined) === (files.length === 0)) {
    throw new ImError('IM_INVALID_REQUEST', 'specify exactly one of text or files')
  }
  if (files.length > 1) {
    throw new ImError('IM_UNSUPPORTED', 'only one file per send is supported')
  }
  return args.text !== undefined
    ? { type: 'text' as const, text: args.text }
    : await fileContentOf(requireString(files[0], 'files[0]'))
}

/** Send to a person; the person target admits no explicit conversation. */
/** 按人发送；person 目标不得与显式会话同时给出。 */
async function sendToPerson(
  router: ImRouter,
  args: {
    person?: string
    provider?: string
    accountId?: string
    bindingId?: string
    conversationId?: string
  },
  content: { type: 'text'; text: string } | Awaited<ReturnType<typeof fileContentOf>>,
  reply: { replyToMessageId?: string },
) {
  if (args.bindingId !== undefined || args.conversationId !== undefined) {
    throw new ImError(
      'IM_INVALID_REQUEST',
      'person cannot be combined with bindingId or conversationId; use accountId/provider to narrow it',
    )
  }
  const sent = await router.sendToPerson({
    person: requireString(args.person, 'person'),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
    content,
    ...reply,
  })
  return {
    delivered: true,
    messageId: sent.result.id,
    sentAt: sent.result.sentAt,
    ...(sent.result.uncertain === undefined ? {} : { uncertain: sent.result.uncertain }),
    recipient: sent.recipient,
  }
}

/** Send to the explicit account + conversation pair. */
/** 发送到显式的 account + conversation 对。 */
async function sendExplicit(router: ImRouter, args: SendArgs, content: Awaited<ReturnType<typeof contentOf>>, reply: { replyToMessageId?: string }): Promise<JsonValue> {
  const result = await router.send({
    ...(args.bindingId === undefined ? {} : { bindingId: args.bindingId }),
    ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
    ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
    content,
    ...reply,
  })
  return ok({
    messageId: result.id,
    sentAt: result.sentAt,
    ...(result.uncertain === undefined ? {} : { uncertain: result.uncertain }),
  })
}

/** The `im_send` execution: person targets resolve first, everything else explicit. */
/** `im_send` 执行：person 目标先解析，其余走显式目标。 */
function sendExecute(router: ImRouter): (args: SendArgs) => Promise<JsonValue> {
  return async args => run(async () => {
    const content = await contentOf(args)
    const reply = args.replyTo === undefined ? {} : { replyToMessageId: args.replyTo }
    if (args.person !== undefined) {
      return ok(await sendToPerson(router, args, content, reply))
    }
    if (args.provider !== undefined) {
      throw new ImError('IM_INVALID_REQUEST', 'provider is only valid together with person')
    }
    return sendExplicit(router, args, content, reply)
  })
}

/**
 * Build the `im_send` tool over the router.
 * @param router - the active-binding router.
 */
export function imSendTool(router: ImRouter) {
  return defineTool({
    name: 'im_send',
    description: IM_SEND_DESCRIPTION,
    parameters: IM_SEND_PARAMETERS,
    output: OUTPUT,
    execute: sendExecute(router),
  })
}
