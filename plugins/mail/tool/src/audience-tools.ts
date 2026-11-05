/**
 * The audience tools: the recipients, the groups, and the preferences that
 * decide who actually hears.
 *
 * A recipient here is whoever the deployment wants to reach — a customer, a
 * teammate, a device — identified by a caller-chosen string and reachable at
 * whatever channels the deployment configured. The group is the fan-out unit:
 * naming one reaches everyone subscribed to it.
 *
 * 收件人工具：收件人、分组，以及决定谁能真正收到消息的偏好。
 *
 * 这里的收件人是部署想要触达的人——客户、同事、设备——由调用方自选的字符串标识，并可在部署
 * 配置的各个渠道上被触达。分组是扇出单位：指名一个分组即触达其全部订阅者。
 *
 * @module @veren/mail-tool/audience-tools
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MailService } from '@veren/mail'
import type { SubscriberId, TopicKey } from '@veren/mail'
import { failureOf, mailTool } from './face.ts'

/**
 * The tool that lists the recipients.
 *
 * 列出收件人的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function subscribersTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_subscribers',
    'List the people this host can notify: each one\'s identifier, the channels they are reachable '
    + 'at, and the groups they belong to. Use it to find the right identifier before calling '
    + 'mail_send, since an unknown recipient is refused rather than silently dropped.',
    {},
    async () => {
      const subscribers = mail.store.subscribers().map((subscriber) => ({
        subscriberId: subscriber.subscriberId,
        email: subscriber.email,
        phone: subscriber.phone,
        name: subscriber.name,
        deleted: subscriber.deleted,
      }))
      return { ok: true, data: { subscribers } }
    },
  )
}

/** `mail_set_subscriber`'s parameter schema. / `mail_set_subscriber` 的参数 schema。 */
const UPSERT_SUBSCRIBER_PARAMETERS = {
  subscriberId: { type: 'string', required: true, description: 'The recipient\'s identifier.' },
  email: { type: 'string', description: 'Their email address.' },
  phone: { type: 'string', description: 'Their phone number.' },
  name: { type: 'string', description: 'Their display name.' },
  locale: { type: 'string', description: 'Their locale, e.g. zh-CN.' },
  timezone: { type: 'string', description: 'Their IANA timezone, e.g. Asia/Shanghai.' },
} as const

/** The recipient write the upsert performs. / upsert 执行的收件人写入。 */
interface SubscriberArg {
  readonly subscriberId?: string
  readonly email?: string
  readonly phone?: string
  readonly name?: string
  readonly locale?: string
  readonly timezone?: string
}

/**
 * The tool that creates or updates one recipient.
 *
 * 创建或更新一个收件人的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function upsertSubscriberTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_set_subscriber',
    'Create or update one recipient by their identifier. Only the fields you name are written; the '
    + 'rest keep their previous values, so this doubles as a way to add an email address to someone '
    + 'who already exists. A deleted recipient is not reachable, whatever this writes.',
    UPSERT_SUBSCRIBER_PARAMETERS,
    async (args) => writeSubscriber(mail, args as SubscriberArg),
  )
}

/**
 * Merge the named fields into one recipient record and store it.
 *
 * 把指名的字段并进一条收件人记录并存储。
 *
 * @param mail - the mail service / 邮件服务
 * @param input - the validated arguments / 已校验的参数
 * @returns the tool's answer / 工具的答案
 */
async function writeSubscriber(
  mail: MailService,
  input: SubscriberArg,
): Promise<{ readonly ok: true; readonly data: { readonly subscriberId: string } }> {
  const rawId = input.subscriberId
  if (rawId === undefined) throw new Error('mail_set_subscriber requires a subscriberId')
  const existing = mail.store.getSubscriber(rawId)
  const record = {
    subscriberId: brandString<SubscriberId>(rawId),
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    deleted: existing?.deleted ?? false,
    updatedAt: Date.now(),
  }
  await mail.store.putSubscriber(record)
  return { ok: true, data: { subscriberId: rawId } }
}

/**
 * The tool that lists the groups and their members.
 *
 * 列出分组及其成员的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function groupsTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_groups',
    'List the notification groups and who belongs to each: the group key to pass to mail_send, and '
    + 'its subscribers. Naming a group in mail_send reaches everyone subscribed to it.',
    {},
    async () => {
      const groups = mail.store.topics().map((topic) => ({
        topicKey: topic.topicKey,
        name: topic.name,
        subscribers: mail.store.subscriptions()
          .filter((subscription) => subscription.topicKey === topic.topicKey)
          .map((subscription) => subscription.subscriberId),
      }))
      return { ok: true, data: { groups } }
    },
  )
}

/**
 * The tool that creates a group.
 *
 * 创建分组的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function upsertGroupTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_set_group',
    'Create or rename one notification group by its key. The key is what mail_send names, and it '
    + 'does not change when the group is renamed.',
    {
      topicKey: { type: 'string', required: true, description: 'The group\'s key.' },
      name: { type: 'string', description: 'The group\'s display name.' },
    },
    async (args) => {
      const input = args as { topicKey?: string; name?: string }
      try {
        const rawKey = input.topicKey
        if (rawKey === undefined) throw new Error('mail_set_group requires a topicKey')
        const existing = mail.store.getTopic(rawKey)
        await mail.store.putTopic({
          topicKey: brandString<TopicKey>(rawKey),
          name: input.name ?? existing?.name ?? rawKey,
          updatedAt: Date.now(),
        })
        return { ok: true, data: { topicKey: input.topicKey } }
      } catch (error: unknown) {
        return { ok: false, error: failureOf(error) }
      }
    },
  )
}

/**
 * The tool that adds or removes one group's member.
 *
 * 增删一个分组成员的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function subscribeTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_subscribe',
    'Add or remove one recipient\'s membership in a notification group. A recipient reached by '
    + 'naming a group in mail_send is exactly the set of its members.',
    {
      topicKey: { type: 'string', required: true, description: 'The group\'s key.' },
      subscriberId: { type: 'string', required: true, description: 'The recipient\'s identifier.' },
      subscribed: { type: 'boolean', required: true, description: 'true adds the member, false removes them.' },
    },
    async (args) => {
      const input = args as { topicKey?: string; subscriberId?: string; subscribed?: boolean }
      try {
        const rawKey = input.topicKey
        const rawId = input.subscriberId
        if (rawKey === undefined || rawId === undefined) {
          throw new Error('mail_subscribe requires a topicKey and a subscriberId')
        }
        const topicKey = brandString<TopicKey>(rawKey)
        const subscriberId = brandString<SubscriberId>(rawId)
        if (input.subscribed === true) {
          await mail.store.putSubscription({ topicKey, subscriberId, contextKeys: [] })
        } else {
          await mail.store.deleteSubscription(rawKey, rawId)
        }
        return { ok: true, data: { topicKey: rawKey, subscriberId: rawId } }
      } catch (error: unknown) {
        return { ok: false, error: failureOf(error) }
      }
    },
  )
}
