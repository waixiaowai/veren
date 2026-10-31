/**
 * One item's action performed against the Session layer: creating the Session a
 * `new_session` item owns, resuming or waking an existing one, or leaving a
 * message in its inbox. Every delivered message carries the startup framing and
 * is attributed to no initiator, so a Session woken here cannot re-enter the
 * trigger.
 *
 * 对会话层执行一条启动项的动作：为 `new_session` 创建会话，恢复或唤醒既有会话，或把
 * 消息放进其收件箱。每条投递消息都带启动框架文本，且不归属任何发起者，因此本模块唤醒
 * 的会话无法重新进入触发逻辑。
 * @module @veren/startup-autostart/deliver
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A startup item registered by the user delivered this user-role message. */
    'startup-autostart': { kind: 'startup-autostart' } & ContextFormed
  }
}
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { startupMessageText } from './view.ts'
import { createAgent, resolveAgent } from './agent-driver.ts'
import type { StartupItemRecord } from './item.ts'

/**
 * Perform one item's action and describe what happened.
 * @param ctx - Host services used to create, resume, and enqueue.
 * @param item - the item to deliver.
 * @param startedAt - instant the run started, stamped into the message framing.
 * @returns a bounded one-line account for the retained outcome.
 */
export async function deliverItem(ctx: Context, item: StartupItemRecord, startedAt: string): Promise<string> {
  return item.action === 'new_session'
    ? deliverNewSession(ctx, item, startedAt)
    : deliverExistingSession(ctx, item, startedAt)
}

/** Create the Session an item owns, then optionally wake it with the message. */
async function deliverNewSession(ctx: Context, item: StartupItemRecord, startedAt: string): Promise<string> {
  const controller = ctx.get('sessionController')
  let agent: Agent
  if (controller === undefined) {
    refuseProfileOnlyTargets(item)
    agent = await createAgent(ctx, item)
  } else {
    const created = await controller.create({
      ...item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId as never },
      ...item.cwd === undefined ? {} : { cwd: item.cwd },
      ...item.preset === undefined ? {} : { agentPreset: item.preset },
    })
    agent = await resolveAgent(ctx, created.sessionId, item)
  }
  if (item.message === undefined) return `created session ${agent.session.id}`
  agent.followup(messageFor(item, startedAt))
  await requireFlush(ctx, agent, item)
  return `created session ${agent.session.id} and delivered the message`
}

/** Resume the item's Session and act on it according to the item's action. */
async function deliverExistingSession(ctx: Context, item: StartupItemRecord, startedAt: string): Promise<string> {
  const agent = await resolveAgent(ctx, item.sessionId as SessionId, item)
  if (item.action === 'resume_session') return `resumed session ${agent.session.id}`
  if (item.action === 'queue_message') {
    // inject only fills the inbox: the Session stays idle until something else wakes it.
    agent.inject(messageFor(item, startedAt))
    await requireFlush(ctx, agent, item)
    return `left a message in the inbox of session ${agent.session.id} without waking it`
  }
  agent.followup(messageFor(item, startedAt))
  await requireFlush(ctx, agent, item)
  return `woke session ${agent.session.id} with the message`
}

/**
 * Refuse the targets only the Web session controller can resolve.
 *
 * A profile without that controller composes no preset roster and no
 * workspace registry, so silently creating a plain Session would answer a
 * request the item never made.
 * @param item - the item whose targets are checked.
 * @throws Error naming the unresolvable target.
 */
function refuseProfileOnlyTargets(item: StartupItemRecord): void {
  if (item.workspaceId === undefined && item.preset === undefined) return
  const target = item.workspaceId === undefined ? 'an agent preset' : 'a workspace'
  throw new Error(
    `item "${item.name}" targets ${target}, which this profile cannot resolve: `
    + 'only the Web application mounts the session controller',
  )
}

/** Build the framed user message one item delivers. */
function messageFor(item: StartupItemRecord, startedAt: string) {
  return createUserMessage({
    content: [{ type: 'text', text: startupMessageText(item, startedAt, item.message ?? '') }],
    source: { kind: 'startup-autostart' },
  })
}

/**
 * Wait for the Session log to acknowledge the enqueued message.
 *
 * The message is already in the Agent's inbox; a refusing persistence layer
 * means the delivery is not durable, which the item's retained outcome must
 * report rather than silently claim success.
 * @param ctx - Host services owning the Session log flush.
 * @param agent - the Agent whose Session must acknowledge the message.
 * @param item - the item whose delivery is being confirmed.
 */
async function requireFlush(ctx: Context, agent: Agent, item: StartupItemRecord): Promise<void> {
  const flushed = await ctx.sessions.flush(agent.session)
  if (!flushed) throw new Error(`session persistence did not acknowledge the message of item "${item.name}"`)
}
