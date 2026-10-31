/**
 * 把一个 Session 的已完成轮次前缀分叉成新 Session，并可在指定的
 * 代理预设与模型下继续该分支。
 * Fork one completed-turn prefix of a Session into a new Session, optionally
 * continuing that branch under a different agent preset and/or model.
 *
 * 分叉本身复刻官方 `@deepseek-ai/dsh-api-session-controller` 的四个步骤
 * （`commands.ts` 的 `fork()`）：种子构造 -> 解析预设 -> 选择模型 ->
 * `ctx.agents.create`。只有预设与模型的来源不同，而这两者都是本工具的参数。
 * The fork itself copies the four steps of the shipped
 * `@deepseek-ai/dsh-api-session-controller` (`fork()` in `commands.ts`):
 * seed construction -> resolve preset -> choose model -> `ctx.agents.create`.
 * Only the preset and model sources differ, and both are this tool's arguments.
 *
 * 模型路由说明：本插件刻意不安装 `agent/request` 选择监听器。新建 Agent 的
 * `agentOptions` 因此拥有其第一轮请求的路由——这正是本工具被要求使用的
 * 路由。请求的路由还会作为持久的 `model/selection` 事件追加，这样后续冷
 * 恢复（会安装 Session 控制器自己的选择）仍解析到请求的模型，而不是继承
 * 日志中最后一条 `request/header`。
 * Model routing note: this plugin deliberately does not install an
 * `agent/request` selection listener. The created Agent's `agentOptions`
 * therefore own the route for its first request, which is exactly the route
 * this tool was asked to use. The requested route is also appended as a
 * durable `model/selection` event, so a later cold resume (which installs the
 * Session controller's own selection) still resolves to the requested model
 * instead of the inherited log's last `request/header`.
 *
 * @module @imeep/dsh-session-fork-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
// 服务级注入：拉取各 Service 的 Context 声明合并（类型-only）。
// Service-level injection: pull each Service's Context declaration merging (type-only).
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-llm'
// 类型-only：`model/selection` 事件类型由本包 augment 进 SessionEventMap。
// Type-only: this package augments `model/selection` into SessionEventMap.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { composeForkPlan, createForkAgent, forkValue, resolveBoundary } from './fork-compose.js'
import { TOOL_NAME, normalizeArguments } from './fork-request.js'
import type { ForkValue } from './types.js'

/** Cordis 插件名。The Cordis plugin name. */
export const name = 'session-fork-enhanced'

/**
 * 插件配置形状。当前没有可调项，保留空对象 schema 以满足宿主统一配置
 * 契约；未来新增开关无需迁移既有配置行。
 * The plugin config shape. No tunables yet; the empty object schema satisfies
 * the host's uniform config contract, and future toggles will not require
 * migrating existing config rows.
 */
export interface Config {}

/** 插件配置 schema（宿主要求用 schemastery 定义）。
 * The plugin config schema (the host requires a schemastery definition). */
export const Config: z<Config> = z.object({})
  .description('Session fork enhanced plugin options. 会话分叉增强插件的配置项（暂无可调项）。')

/** 激活时需要的 Service 能力。The service capabilities needed at activation. */
export const inject = ['tools', 'sessionQuery', 'agents', 'agentDefaultModel']

/** 本插件不对外提供服务。This plugin provides no services. */
export const provide = []

/**
 * 观察源会话，把“会话不存在”翻译成面向模型的诊断。
 * Observe the source session, translating "session not found" into a
 * model-facing diagnostic.
 */
async function observeSource(ctx: Context, request: { sessionId: string }) {
  try {
    return await ctx.sessionQuery.observeSession(request.sessionId as SessionId)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw new Error(`${TOOL_NAME}: session ${JSON.stringify(request.sessionId)} not found`)
    }
    throw error
  }
}

/**
 * 执行一次带可选预设与模型覆盖的分叉。
 * Execute one fork with the optional preset and model overrides.
 * @param ctx - 宿主上下文。The host context.
 * @param rawArgs - 模型给出的参数。The model arguments.
 * @returns 新会话标识及其创建时使用的路由/预设。
 *   The new session identity and the route/preset it was created with.
 */
export async function forkWithOptions(ctx: Context, rawArgs: unknown): Promise<ForkValue> {
  const request = normalizeArguments(rawArgs)
  // 观察句柄是宿主资源（`SessionObservation extends Disposable`），用 `using`
  // 无条件释放；`observeSource` 抛错发生在绑定之前，不会误释放。
  // The observation handle is a host resource (`SessionObservation extends
  // Disposable`); `using` releases it unconditionally. A throw from
  // `observeSource` happens before the binding, so nothing is disposed twice.
  using observation = await observeSource(ctx, request)
  const boundary = resolveBoundary(request, observation.events)
  const plan = await composeForkPlan(ctx, request, observation.header, observation.events, observation.projections, boundary)
  // 子代理 id：宿主规定的 `session-` 前缀 + 随机 UUID。
  // The child id: the host-mandated `session-` prefix plus a random UUID.
  const childId = `session-${randomUUID()}` as SessionId
  await createForkAgent(ctx, childId, observation.header, boundary, plan)
  return forkValue(request, childId, boundary, plan)
}

/**
 * output 契约：与 `ForkValue` 的真实返回形态一致——扁平对象（非 `{note}`
 * 类包装值），必填六键 + 两个可选项；`execute` 直接返回该值。返回类型按
 * 逐键字面量拼写，保持 `defineTool` 的 `InferValue` 精确推断（工具注册表
 * 不会为手工构造的工具定义做这件事）。
 * Output contract: mirrors the real `ForkValue` return — a flat object (not a
 * `{note}`-style wrapper) with six required keys plus two options. The return
 * type is spelled per-key so `defineTool`'s `InferValue` stays exact (the
 * tool registry does not do this for hand-built definitions).
 */
function forkOutputSchema(): {
  type: 'object'
  properties: {
    sessionId: { type: 'string', required: true }
    sourceSessionId: { type: 'string', required: true }
    atSeq: { type: 'integer', required: true }
    inheritedEventCount: { type: 'integer', required: true }
    agentPreset: { type: 'string' }
    provider: { type: 'string', required: true }
    model: { type: 'string', required: true }
    reasoningEffort: { type: 'string' }
  }
  additionalProperties: false
} {
  return {
    type: 'object',
    properties: {
      sessionId: { type: 'string', required: true },
      sourceSessionId: { type: 'string', required: true },
      atSeq: { type: 'integer', required: true },
      inheritedEventCount: { type: 'integer', required: true },
      agentPreset: { type: 'string' },
      provider: { type: 'string', required: true },
      model: { type: 'string', required: true },
      reasoningEffort: { type: 'string' },
    },
    additionalProperties: false,
  }
}

/**
 * 构造分叉工具定义：参数、output 契约与执行体都绑定到宿主 ctx。
 * Builds the fork tool definition: parameters, the output contract and the
 * execution body all bind to the host ctx.
 * @param ctx - 携带 `tools` 的宿主上下文。The host context carrying `tools`.
 */
function defineForkTool(ctx: Context) {
  return defineTool({
    name: TOOL_NAME,
    description: 'Fork one existing session: copy an exact completed-turn prefix (its full context) into a new '
      + 'session and optionally continue that branch under a different agent preset and/or provider model. '
      + 'Omitting every option behaves like session_fork. Session ids appear in the working-memory snapshot.',
    parameters: {
      sessionId: { type: 'string', required: true, description: 'The source session id.' },
      atSeq: { type: 'integer', description: 'Exact inclusive source event seq; omit for the latest completed turn.' },
      presetId: { type: 'string', description: 'Agent preset id for the new branch; omitted inherits the source preset.' },
      provider: { type: 'string', description: 'Provider id for the new branch; required together with model.' },
      model: { type: 'string', description: 'Model id for the new branch; required together with provider.' },
      reasoningEffort: { type: 'string', description: 'Optional adapter-owned reasoning effort for that route.' },
    },
    output: {
      schema: forkOutputSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return await forkWithOptions(ctx, args)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Fork session with options',
      kind: 'other',
      rawInput: args,
    }),
  })
}

/**
 * 在宿主工具注册表上注册分叉工具。effect 函数体返回 `tools.register`
 * 给出的精确卸载函数，卸载/HMR 时逆序调用，不泄漏注册项。
 * Register the fork tool on the host tool registry. The effect body returns
 * the exact disposer given by `tools.register`, invoked on unload/HMR, so no
 * registration leaks.
 * @param ctx - 携带 `tools` 的宿主上下文。The host context carrying `tools`.
 * @param _config - 已解析的插件配置（当前无可调项）。
 *   The resolved plugin config (no tunables yet).
 */
export const apply = (ctx: Context, _config: Config): void => {
  ctx.effect(() => ctx.tools.register(defineForkTool(ctx)), 'session-fork-enhanced.tool')
}
