/**
 * 分叉的组合层：边界解析、计划组装、预设解析、模型路由校验、
 * 子代理创建与工作区归属查找。
 * The fork composition layer: boundary resolution, plan assembly, preset
 * resolution, model-route validation, child-agent creation, and
 * source-session workspace ownership lookup.
 *
 * @module fork-compose
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentSetup } from '@deepseek-ai/dsh-agent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, SessionSeq, buildForkSeed } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import { TOOL_NAME, effectiveSelection } from './fork-request.js'
import { latestCompletedPrefixBoundary, sameSelection } from './fork-request.js'
import type { ForkRequest, ForkValue, ModelSelectionView } from './types.js'

/** 组合结果：解析出的预设 id 与发布前挂载它的 setup 回调。
 * The composition result: the resolved preset id and the setup that mounts it. */
export interface PresetComposition {
  /** 记录到新会话 header 的预设 id（可能缺席）。The preset id recorded on the child header, when any. */
  readonly agentPreset?: string
  /** 创建时挂载预设的 setup 回调（可能缺席）。The setup mounting the preset at creation, when any. */
  readonly setup?: AgentSetup
}

/** 分叉计划：选择、组合、工作区与种子的一次性解析结果。
 * The fork plan: the one-shot resolution of selections, composition,
 * workspace, and seed. */
export interface ForkPlan {
  /** 生效的模型选择。The effective model selection. */
  readonly selection: ModelSelectionView
  /** 显式请求的选择（可能缺席）。The explicitly requested selection, when any. */
  readonly explicit: ModelSelectionView | undefined
  /** 按官方规则继承的选择。The selection inherited under the shipped rules. */
  readonly inherited: ModelSelectionView
  /** 预设组合结果。The preset composition result. */
  readonly composition: PresetComposition
  /** 源会话的工作区（可能缺席）。The source workspace, when any. */
  readonly workspace: unknown
  /** 子分支的种子事件。The child's seed events. */
  readonly seed: readonly SessionEvent[]
}

/**
 * 从投影快照读取源会话预设。投影键表由宿主注册方维护，这里只做防御式
 * 字符串读取，缺键或缺类型都视为继承缺席。
 * Read the source session preset from a projection snapshot. The projection
 * key map is owned by host registrars, so this reads defensively as a string;
 * a missing key or wrong type counts as no inherited preset.
 * @param snapshot - 观察附带的投影基线（可能缺席）。
 *   The projection baseline carried by the observation, when any.
 */
function sourcePresetOf(snapshot: ProjectionSnapshot | undefined): string | undefined {
  const value: unknown = snapshot === undefined
    ? undefined
    : (snapshot.values as Record<string, unknown>)['agentPreset']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 解析子分支必须运行的预设，以及发布前挂载它的 setup 回调。
 * 与官方 `composeAgent` 一致，但不安装模型选择监听器（见入口模块说明）。
 * Resolve the preset the child must run and the setup that mounts it before
 * publication, mirroring the shipped `composeAgent` without its model-selection
 * listener (see the entry module note).
 * @param ctx - 宿主上下文。The host context.
 * @param presetId - 请求的预设；省略时使用源/默认预设。
 *   The requested preset, or the source/default preset when omitted.
 */
export async function composePreset(ctx: Context, presetId: string | undefined): Promise<PresetComposition> {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) {
    if (presetId !== undefined) {
      throw new Error(`${TOOL_NAME}: this deployment composes no agent preset roster, so presetId cannot be applied`)
    }
    return {}
  }
  let resolved
  try {
    resolved = await presets.resolve(presetId)
  } catch (error) {
    throw new Error(`${TOOL_NAME}: agent preset ${JSON.stringify(presetId)} could not be resolved: ${String(error)}`)
  }
  return {
    agentPreset: resolved.id,
    setup: async agentCtx => { await presets.mount(agentCtx, resolved.id) },
  }
}

/**
 * 针对活跃适配器目录解析显式 provider/model 路由（若有），
 * 让不可用的路由在会话创建之前就失败。
 * Resolve the explicit provider/model route, if any, against the live adapter
 * catalog so an unavailable route fails before a session is created.
 * @param ctx - 宿主上下文。The host context.
 * @param request - 归一化后的工具请求。The normalized tool request.
 */
export async function requestedRoute(ctx: Context, request: ForkRequest): Promise<ModelSelectionView | undefined> {
  if (request.provider === undefined) return undefined
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.resolveCallConfig !== 'function') {
    // 无适配器目录可校验：原样透传显式路由与 effort，保留用户意图。
    // No adapter catalog to validate against: pass the explicit route and
    // effort through verbatim, preserving the caller's intent.
    return {
      provider: request.provider,
      model: request.model as string,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    }
  }
  let resolved
  try {
    resolved = await llm.resolveCallConfig({
      provider: request.provider,
      model: request.model as string,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort as ReasoningEffortId }),
    })
  } catch (error) {
    throw new Error(`${TOOL_NAME}: provider/model route ${request.provider}/${String(request.model)} could not be resolved: ${String(error)}`)
  }
  const { reasoningEffort } = resolved
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort: String(reasoningEffort) }),
  }
}

/**
 * 校验并解析分叉边界：显式 atSeq 优先，否则取最近已完成轮次前缀。
 * Validate and resolve the fork boundary: an explicit atSeq wins, else the
 * latest completed-turn prefix.
 * @param request - 归一化后的请求。The normalized request.
 * @param events - 源事件日志。The source event log.
 * @throws {Error} 边界不是已存在的事件序号时抛出面向模型的诊断。
 *   Throws a model-facing diagnostic when the boundary is not an existing seq.
 */
export function resolveBoundary(request: ForkRequest, events: readonly SessionEvent[]): number {
  const boundary = request.atSeq ?? latestCompletedPrefixBoundary(events)
  if (boundary === undefined || events[boundary]?.seq !== boundary) {
    throw new Error(
      request.atSeq === undefined
        ? `${TOOL_NAME}: session ${JSON.stringify(request.sessionId)} has no completed turn to fork from`
        : `${TOOL_NAME}: event ${String(request.atSeq)} does not exist in session ${JSON.stringify(request.sessionId)} (last seq: ${String(events.at(-1)?.seq ?? 'none')})`,
    )
  }
  return boundary
}

/**
 * 一次性解析分叉计划。显式路由经适配器目录校验后优先于继承路由。
 * Resolve the fork plan in one shot. An explicit route wins over the
 * inherited one after adapter-catalog validation.
 * @param ctx - 宿主上下文。The host context.
 * @param request - 归一化后的请求。The normalized request.
 * @param header - 源 Session 头。The source Session header.
 * @param events - 源事件日志。The source event log.
 * @param projections - 观察的投影基线（可能缺席）。
 *   The observation's projection baseline, when any.
 * @param boundary - 已校验的含边界序号。The validated inclusive boundary seq.
 */
export async function composeForkPlan(
  ctx: Context,
  request: ForkRequest,
  header: SessionHeader,
  events: readonly SessionEvent[],
  projections: ProjectionSnapshot | undefined,
  boundary: number,
): Promise<ForkPlan> {
  const inherited = effectiveSelection(ctx, events)
  const explicit = await requestedRoute(ctx, request)
  const sourcePreset = sourcePresetOf(projections)
  const composition = await composePreset(ctx, request.presetId ?? sourcePreset)
  const workspace = await forkWorkspace(ctx, header)
  return {
    inherited,
    explicit,
    selection: explicit ?? inherited,
    composition,
    workspace,
    seed: buildForkSeed(events, SessionSeq(boundary)),
  }
}

/**
 * 查找拥有源会话的工作区；当源会话本身从未附着时，沿子代理谱系上溯。
 * Find the workspace that owns the source session, following subagent lineage
 * when the source itself was never attached.
 * @param ctx - 宿主上下文。The host context.
 * @param header - 源 Session 头。The source Session header.
 */
export async function forkWorkspace(ctx: Context, header: SessionHeader): Promise<unknown> {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  const workspaces = registry.list() as ReadonlyArray<{ id: string; sessionIds: readonly string[] }>
  const direct = workspaces.find(workspace => workspace.sessionIds.includes(header.id))
  if (direct !== undefined || header.origin !== 'subagent') return direct
  if (typeof ctx.sessionQuery.traceSession !== 'function') return undefined
  const lineage = await ctx.sessionQuery.traceSession(header.id)
  for (const ancestor of lineage.ancestors) {
    const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
    if (workspace !== undefined) return workspace
  }
  return undefined
}

/**
 * 组装 `agents.create` 的完整请求负载。
 * Assemble the full `agents.create` request payload.
 */
function createPayload(
  childId: SessionId,
  header: SessionHeader,
  boundary: number,
  plan: ForkPlan,
): Parameters<Context['agents']['create']>[0] {
  const composition = plan.composition
  return {
    sessionId: childId,
    seed: plan.seed,
    inheritedEventCount: SessionLogOffset(boundary + 1),
    meta: {
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      parentSession: header.id,
      isSeeded: true,
      ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
    },
    agentOptions: {
      provider: plan.selection.provider,
      model: plan.selection.model,
      ...(plan.selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: plan.selection.reasoningEffort as ReasoningEffortId }),
    },
    ...(composition.setup === undefined ? {} : { setup: composition.setup }),
  }
}

/**
 * 创建子代理，持久化显式模型意图，并附着到源工作区。
 * Create the child agent, persist the explicit model intent, and attach the
 * source workspace.
 * @returns 新会话 id。The new session id.
 */
export async function createForkAgent(
  ctx: Context,
  childId: SessionId,
  header: SessionHeader,
  boundary: number,
  plan: ForkPlan,
): Promise<string> {
  const handle = await ctx.agents.create(createPayload(childId, header, boundary, plan))
  if (plan.explicit !== undefined && !sameSelection(plan.explicit, plan.inherited)) {
    // 持久化意图：后续冷恢复会先选 `pending` 再看继承的 `request/header`，
    // 不追加这条事件的话旧模型会赢。
    // Durable intent: a later cold resume selects `pending` before the
    // inherited `request/header`, so without this the old model would win.
    handle.agent.session.append('model/selection', plan.explicit)
  }
  if (plan.workspace !== undefined) {
    try {
      await (plan.workspace as { attachSession(id: string): Promise<void> }).attachSession(childId)
    } catch (error) {
      throw new Error(`${TOOL_NAME}: session ${JSON.stringify(childId)} was forked but could not attach to its workspace: ${String(error)}`)
    }
  }
  return childId
}

/** 组装分叉工具的返回值。Assemble the fork tool's return value. */
export function forkValue(
  request: ForkRequest,
  childId: string,
  boundary: number,
  plan: ForkPlan,
): ForkValue {
  const { agentPreset } = plan.composition
  const selection = plan.selection
  return {
    sessionId: childId,
    sourceSessionId: request.sessionId,
    atSeq: boundary,
    inheritedEventCount: boundary + 1,
    ...(agentPreset === undefined ? {} : { agentPreset }),
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }
}
