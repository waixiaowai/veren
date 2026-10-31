/**
 * Session resolution for the delivery engine: turning a startup item's target
 * into a live Agent, whether the profile resolves targets through the Web
 * application's session controller or through the core agent registry, and
 * installing the item's model selection on the Agent it returns.
 *
 * 投递引擎的会话解析：把启动项的目标变成活的 Agent——profile 可能通过 Web 应用的
 * session controller 解析目标，也可能走核心 agent 注册表——并把启动项的模型选择装到
 * 返回的 Agent 上。
 * @module @veren/startup-autostart/agent-driver
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentOptions, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { withDefined } from './item.ts'
import type { StartupItemRecord } from './item.ts'

/** The per-Agent options and scoped setup a core-registry create or resume needs. */
export interface AgentPlan {
  readonly agentOptions?: AgentOptions
  readonly setup?: (agentCtx: Context) => void
}

/**
 * Build the per-Agent options a core-registry create or resume needs.
 *
 * The item's model wins; otherwise the deployment default applies. A profile
 * with neither passes no options at all and lets the Agent fall back to its
 * own configured behaviour.
 * @param ctx - Host services read for the deployment's default model.
 * @param item - the item whose model target applies.
 * @returns the options, empty when nothing names a model.
 */
export function agentPlanOf(ctx: Context, item: StartupItemRecord): AgentPlan {
  const fallback = ctx.get('agentDefaultModel')?.currentSelection()
  // The item's effort is model-supplied text and the core selection brands it;
  // a provider rejects an effort it does not know at request time.
  const selected: ModelSelection | undefined = item.model === undefined
    ? fallback
    : withDefined<ModelSelection>(
      { provider: item.model.provider, model: item.model.model },
      { reasoningEffort: item.model.reasoningEffort as ModelSelection['reasoningEffort'] },
    )
  if (selected === undefined) return {}
  const reference: ModelSelectionRef = { current: selected, assembled: undefined }
  return {
    agentOptions: { provider: selected.provider, model: selected.model },
    setup: (agentCtx: Context) => { installModelSelection(agentCtx, reference) },
  }
}

/**
 * Resolve one Session to its live Agent, through the Web controller when the
 * profile has one and through the core registry otherwise.
 * @param ctx - Host services owning the controller and the core registry.
 * @param sessionId - the Session to drive.
 * @param item - the item whose model target applies to the resolved Agent.
 * @returns the live Agent.
 */
export async function resolveAgent(ctx: Context, sessionId: SessionId, item: StartupItemRecord): Promise<Agent> {
  const controller = ctx.get('sessionController')
  if (controller !== undefined) {
    const found = await controller.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    await applyControllerModel(controller, found.agent, item)
    return found.agent
  }
  const live = ctx.agents.get(sessionId)
  if (live !== undefined) return live
  const handle = await ctx.agents.resume({ resumeSessionId: sessionId, ...agentPlanOf(ctx, item) })
  return handle.agent
}

/**
 * Create one new Session through the core registry, under a freshly minted id.
 * @param ctx - Host services owning the core registry.
 * @param item - the item whose cwd and model target the new Agent receives.
 * @returns the Agent of the created Session.
 */
export async function createAgent(ctx: Context, item: StartupItemRecord): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
    ...item.cwd === undefined ? {} : { meta: { cwd: item.cwd } },
    ...agentPlanOf(ctx, item),
  })
  return handle.agent
}

/**
 * Install the item's model selection on a live Agent through the Web controller.
 * @param controller - the profile's session controller.
 * @param agent - the live Agent the selection applies to.
 * @param item - the item naming the model, when it names one.
 */
async function applyControllerModel(
  controller: NonNullable<Context['sessionController']>,
  agent: Agent,
  item: StartupItemRecord,
): Promise<void> {
  if (item.model === undefined) return
  await controller.selectModel({
    sessionId: agent.session.id,
    provider: item.model.provider,
    model: item.model.model,
    ...item.model.reasoningEffort === undefined ? {} : { reasoningEffort: item.model.reasoningEffort as never },
  })
}
