/**
 * Inbound prompt rendering and outbound content degradation for the router.
 *
 * One direction turns a normalized inbound message into the model-facing turn
 * text (source section first, message body second); the other downgrades or
 * rejects content the target provider cannot carry, before any provider call.
 *
 * 路由的入站 Prompt 渲染与出站内容降级。
 *
 * 一个方向把归一化的入站消息变成面向模型的 turn 文本（来源区块在前，正文在后）；另一个方向在
 * 调用 provider 之前，把对方带不动的内容降级或拒绝。
 *
 * @module @veren/im/router-prompt
 */

import { ImError } from './contract.ts'
import type { ImMessage, ImMessageContent, ImProvider } from './contract.ts'

/** The reply contract every rendered turn must carry: the model's own text
 *  output IS the channel reply — narration or send-tool calls are never needed.
 *  每个渲染回合都必须携带的回复契约：模型自己的文本输出就是渠道回复——
 *  无需复述投递状态，也无需调用发送工具。 */
const REPLY_CONTRACT = [
  '[Reply contract]',
  '你本轮输出的全部文本会被原样作为渠道消息自动回发给对方，此外没有别的回信机制。',
  '直接输出给对方看的回答内容；不要复述投递状态，不要调用发送工具。',
  'All text you output this turn is delivered verbatim to the sender as the channel',
  'reply — there is no other send mechanism. Answer directly; do not narrate',
  'delivery status and do not call send tools.',
].join('\n')

/** Turn renderer: source section first, message body second. */
export function renderPrompt(providerId: string, message: ImMessage, knownName?: string): string {
  const sender = knownName === undefined || knownName === message.sender.id
    ? message.sender.name ?? message.sender.id
    : `${knownName} (${message.sender.id})`
  return [
    '[Source]',
    `provider: ${providerId}`,
    `account: ${message.accountId}`,
    `conversation: ${message.conversationId}`,
    `sender: ${sender}`,
    `time: ${new Date(message.sentAt).toISOString()}`,
    '',
    '[Message]',
    contentToPrompt(message.content),
    '',
    REPLY_CONTRACT,
  ].join('\n')
}

/** Render one content block for the model without mixing in source metadata. */
function contentToPrompt(content: ImMessageContent): string {
  switch (content.type) {
    case 'text':
    case 'markdown':
      return content.text
    case 'image':
      return `[image: ${content.name ?? content.mime}]`
    case 'file':
      return `[file: ${content.name}]`
  }
}

/** Downgrade or reject content the provider cannot carry. */
export function degradeContent(features: ImProvider['features'], content: ImMessageContent): ImMessageContent {
  switch (content.type) {
    case 'markdown':
      return features.markdown ? content : { type: 'text', text: content.text }
    case 'image':
      if (!features.media.image) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send images')
      return content
    case 'file':
      if (!features.media.file) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send files')
      if (features.limits.fileBytes !== undefined
        && content.size !== undefined
        && content.size > features.limits.fileBytes) {
        throw new ImError('IM_INVALID_REQUEST', 'the file exceeds the provider limit')
      }
      return content
    case 'text':
      return content
  }
}
