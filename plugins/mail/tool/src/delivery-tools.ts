/**
 * The delivery tools: firing a workflow and reading what came of it.
 *
 * `mail_send` is the tool the design's trigger interface becomes in a host
 * where the caller is an agent rather than a backend. Its contract keeps the
 * design's distinction intact: the answer says whether the trigger was
 * *accepted*, and the chain's own facts say what happened afterwards. A
 * caller that reads "accepted" as "delivered" is misreading the tool, so the
 * wording is deliberate.
 *
 * 投递工具：触发一次工作流，以及读取其结果。
 *
 * 在调用方是智能体而非后端的宿主里，`mail_send` 就是设计中的触发接口。它的契约保留着设计的
 * 区分：答案说明触发是否被*受理*，而链路自身的事实说明其后发生了什么。把「已受理」读成
 * 「已投递」是用错了工具，因此措辞是刻意的。
 *
 * @module @veren/mail-tool/delivery-tools
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MailService } from '@veren/mail'
import { failureOf, mailTool } from './face.ts'

/** The recipient entry the tool's schema accepts. / 工具 schema 接受的收件人条目。 */
interface RecipientArg {
  readonly subscriberId?: string
  readonly topicKey?: string
}

/** `mail_send`'s parameter schema, declared once beside the tool. / `mail_send` 的参数 schema，与工具并排声明一次。 */
const SEND_PARAMETERS = {
  workflow: { type: 'string', required: true, description: 'The workflow\'s trigger identifier, e.g. order-paid.' },
  payload: { type: 'object', additionalProperties: true, description: 'The business payload the workflow expects.' },
  to: {
    type: 'array',
    required: true,
    description: 'Who should receive it: subscriber ids, or group keys to fan out to.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subscriberId: { type: 'string', description: 'One recipient\'s identifier.' },
        topicKey: { type: 'string', description: 'A group to fan out to.' },
      },
    },
  },
  transactionId: { type: 'string', description: 'The caller\'s idempotency identifier; a repeat is refused.' },
  actor: { type: 'string', description: 'The recipient who triggered it; excluded from the fan-out.' },
} as const

/**
 * Map the schema's recipient entries onto the service's union.
 *
 * 把 schema 的收件人条目映射成服务的联合类型。
 *
 * @param args - the validated arguments / 已校验的参数
 * @returns the recipient list / 收件人列表
 */
function recipientsOf(args: Record<string, unknown>): ReturnType<typeof toRecipients> {
  return toRecipients((args['to'] ?? []) as RecipientArg[])
}

/**
 * Project one page of recipient entries onto the service's union.
 *
 * 把一批收件人条目投影成服务的联合类型。
 *
 * @param recipients - the schema's entries / schema 的条目
 * @returns the service's recipients / 服务的收件人
 */
function toRecipients(recipients: readonly RecipientArg[]): (
  { readonly kind: 'subscriber'; readonly subscriberId: string } |
  { readonly kind: 'topic'; readonly topicKey: string }
)[] {
  return recipients.map((recipient) => recipient.subscriberId !== undefined
    ? { kind: 'subscriber' as const, subscriberId: recipient.subscriberId }
    : { kind: 'topic' as const, topicKey: recipient.topicKey ?? '' })
}

/**
 * The tool that fires a workflow.
 *
 * 触发一次工作流的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function sendTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_send',
    'Send a notification workflow to people. Names the workflow by its trigger identifier, passes the '
    + 'business payload the workflow expects, and names the recipients either directly or as a group. '
    + 'The answer says whether the trigger was ACCEPTED, not whether the messages were delivered: '
    + 'read mail_activity afterwards to learn what actually went out, and why a step was skipped. '
    + 'Pass a transactionId when the caller may retry, so a repeated attempt is refused instead of '
    + 'delivering twice. Prefer one workflow per kind of notice over one workflow with many payloads.',
    SEND_PARAMETERS,
    async (args) => {
      const transactionId = args['transactionId']
      const actor = args['actor']
      try {
        const result = await mail.trigger({
          name: args['workflow'] as string,
          payload: (args['payload'] ?? {}) as Record<string, unknown>,
          to: recipientsOf(args),
          ...(transactionId === undefined ? {} : { transactionId: transactionId as string }),
          ...(actor === undefined ? {} : { actor: actor as string }),
        })
        return { ok: true, data: result }
      } catch (error: unknown) {
        return { ok: false, error: failureOf(error) }
      }
    },
  )
}

/**
 * The tool that lists the workflows a trigger may name.
 *
 * 列出触发可指名的工作流的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function workflowsTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_workflows',
    'List the notification workflows this host can send, with the trigger identifier to pass to '
    + 'mail_send, the channels each step uses, and whether the workflow is active. Read this before '
    + 'sending: a workflow that is not ACTIVE is refused, and a draft never fires.',
    {},
    async () => {
      const workflows = mail.store.workflows().map((workflow) => ({
        workflowId: workflow.workflowId,
        triggerIdentifier: workflow.triggerIdentifier,
        name: workflow.name,
        status: workflow.status,
        draft: workflow.draft,
        severity: workflow.severity,
        steps: workflow.steps.map((step) => ({ stepId: step.stepId, type: step.type })),
      }))
      return { ok: true, data: { workflows } }
    },
  )
}

/**
 * The tool that reads the execution chains.
 *
 * 读取执行链的工具。
 *
 * @param mail - the mail service / 邮件服务
 * @returns the tool definition / 工具定义
 */
export function activityTool(mail: MailService): ToolDefinition {
  return mailTool(
    'mail_activity',
    'Read what the sent notifications actually did: one row per execution chain, with each step\'s '
    + 'state and, for a skipped step, the reason it was skipped (step_condition, preference, '
    + 'missing_email, missing_phone, missing_push_token, missing_webhook_url). Use this after '
    + 'mail_send to find out what was delivered and what was not.',
    {},
    async () => {
      return { ok: true, data: { runs: mail.listRuns() } }
    },
  )
}
