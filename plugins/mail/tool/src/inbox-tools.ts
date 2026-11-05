/**
 * The reading tools: the station inbox and the conversations.
 *
 * The inbox is the recipient's own view of what reached them — the `in_app`
 * channel's messages, with the seen/read/archived state the design keeps
 * independent of each other. A conversation is a thread; replying to one is
 * the outbound half of the design's conversation model.
 *
 * 读取工具：站内收件箱与会话。
 *
 * 收件箱是收件人自己看到的「抵达了什么」——`in_app` 渠道的消息，以及设计刻意彼此独立的
 * 已看到／已读／已归档状态。会话是一条线程；对它回复是设计会话模型的出站那一半。
 *
 * @module @veren/mail-tool/inbox-tools
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MailService } from '@veren/mail'
import { failureOf, mailTool } from './face.ts'

/**
 * The tool that reads the station inbox.
 *
 * 读取站内收件箱的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function inboxTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_inbox',
    'Read the messages that reached the station inbox: the in-app notifications, newest first, with '
    + 'their content and whether they were seen, read, or archived. Use it to check what a recipient '
    + 'has actually been shown.',
    {
      subscriberId: { type: 'string', description: 'Only this recipient\'s messages; every recipient when omitted.' },
    },
    async (args) => {
      const input = args as { subscriberId?: string }
      const messages = mail.listMessages()
        .filter((message) => input.subscriberId === undefined || message.subscriberId === input.subscriberId)
      return { ok: true, data: { messages } }
    },
  )
}

/**
 * The tool that marks one inbox message.
 *
 * 标记一条收件箱消息的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function markMessageTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_mark_message',
    'Mark one inbox message as read, unread, archived, or unarchived. The states are independent: '
    + 'marking a message read also marks it seen, but marking it archived leaves its read state '
    + 'alone.',
    {
      messageId: { type: 'string', required: true, description: 'The message\'s identifier.' },
      action: {
        type: 'string',
        required: true,
        description: 'What to change: read, unread, archive, or unarchive.',
      },
    },
    async (args) => {
      const input = args as { messageId?: string; action?: 'read' | 'unread' | 'archive' | 'unarchive' }
      try {
        const { messageId, action } = input
        if (messageId === undefined || action === undefined) {
          throw new Error('mail_mark_message requires a messageId and an action')
        }
        const message = await mail.markMessage(messageId, action)
        return message === undefined
          ? { ok: false, error: { code: 'MAIL_INTERNAL', message: `no message '${messageId}'` } }
          : { ok: true, data: { message } }
      } catch (error: unknown) {
        return { ok: false, error: failureOf(error) }
      }
    },
  )
}

/**
 * The tool that lists the conversations.
 *
 * 列出会话的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function conversationsTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_conversations',
    'List the notification conversations: each thread\'s channel, the recipient, whether it is still '
    + 'active, and its latest message. A resolved conversation refuses replies until it is reopened '
    + 'explicitly.',
    {},
    async () => {
      const conversations = mail.store.conversations().map((conversation) => ({
        conversationId: conversation.conversationId,
        channel: conversation.channel,
        subscriberId: conversation.subscriberId,
        status: conversation.status,
        messageCount: conversation.messageCount,
        lastMessagePreview: conversation.lastMessagePreview,
        lastActivityAt: conversation.lastActivityAt,
      }))
      return { ok: true, data: { conversations } }
    },
  )
}

/**
 * The tool that reads one conversation's messages.
 *
 * 读取一条会话消息的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function conversationMessagesTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_conversation_messages',
    'Read one conversation\'s messages in the order they happened, each marked inbound or outbound.',
    {
      conversationId: { type: 'string', required: true, description: 'The conversation\'s identifier.' },
    },
    async (args) => {
      const input = args as { conversationId?: string }
      const conversationId = input.conversationId ?? ''
      const events = mail.store.conversationEvents(conversationId)
      return { ok: true, data: { messages: events } }
    },
  )
}
