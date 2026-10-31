/**
 * `select_model` 工具的注册：校验参数后直通宿主的
 * `ctx.sessionController.selectModel`，不重复造任何切换逻辑；宿主的
 * provider/model 合法性错误原样透传给模型。
 * Registration of the `select_model` tool: validate, then hand straight to the
 * host's `ctx.sessionController.selectModel` with no switching logic of our
 * own; host errors about provider/model validity pass through verbatim.
 *
 * @module select-tool
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only：拉取 sessionController 的声明合并。
// Type-only: pull the sessionController declaration merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { TOOL_NAME, normalizeSelectArguments, resolveTargetSessionId } from './select-request.js'
import type { SelectModelArgs, SelectModelResult } from './types.js'

/** 工具描述：路由切换的语义、成对必填与宿主裁决边界。The tool description: switch semantics, the paired requirement and the host's verdict boundary. */
const TOOL_DESCRIPTION =
  'Switch the provider/model route and optional reasoning effort of one session mid-conversation. '
  + 'provider and model are required together; reasoningEffort is optional. Omit sessionId to switch '
  + 'the calling session\'s own model. Provider/model validity is enforced by the host: an unknown '
  + 'route fails with the host\'s error, so ids must come from the deployment catalog. '
  + 'Session ids appear in the working-memory snapshot.'

/** 工具参数 schema：provider/model 成对必填，reasoningEffort 与 sessionId 可选。The tool's parameter schema: provider/model paired-required, reasoningEffort and sessionId optional. */
const SELECT_MODEL_PARAMETERS = {
  provider: { type: 'string', required: true, description: 'Provider id; required together with model.' },
  model: { type: 'string', required: true, description: 'Model id; required together with provider.' },
  reasoningEffort: {
    type: 'string',
    description: 'Optional reasoning effort for that provider/model route (adapter-interpreted, e.g. low/medium/high).',
  },
  sessionId: {
    type: 'string',
    description: 'Target session id from the working-memory snapshot. Omit it to switch the calling session\'s own model; pass it explicitly to switch another session.',
  },
} as const

/**
 * 注册 `select_model`：在对话过程中切换一个会话的 provider/model 与
 * 推理强度。缺省 sessionId 时切换调用方自己的会话。
 * Register `select_model`: switch one session's provider/model and reasoning
 * effort mid-conversation. With sessionId omitted, the calling session's own
 * model is switched.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 * @returns `tools.register` 给出的卸载函数。The disposer given by `tools.register`.
 */
export function registerSelectModel(ctx: Context): () => void {
  return ctx.tools.register(defineSelectModelTool(ctx))
}

/** 组装 select_model 工具定义（描述/参数为常量，执行与呈现各一职责）。Assemble the select_model tool definition (description/parameters are constants; execute and presentation are separate concerns). */
function defineSelectModelTool(ctx: Context) {
  return defineTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: SELECT_MODEL_PARAMETERS,
    output: {
      // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
      // Lossless JSON output: results are small and stable; the model reads
      // the raw value directly.
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: (args: unknown, exec: ToolRunContext) => executeSelectModel(ctx, args, exec),
    presentCall: (args) => ({
      card: 'generic',
      title: 'Select model',
      kind: 'other',
      rawInput: args,
    }),
  })
}

/** 执行切换：归一参数、解析目标会话、直通宿主并投影 JsonValue 可承载的结果。Run the switch: normalize arguments, resolve the target session, hand to the host and project the JsonValue-bearable result. */
async function executeSelectModel(
  ctx: Context,
  args: unknown,
  exec: ToolRunContext,
): Promise<SelectModelResult> {
  const request: SelectModelArgs = normalizeSelectArguments(args)
  const sessionId = resolveTargetSessionId(request.sessionId, exec.agent?.id)
  // 直通宿主：provider/model 合法性与会话存在性都由宿主裁决，错误透传。
  // Straight to the host: route validity and session existence are the
  // host's verdicts, and its errors pass through.
  const value = await ctx.sessionController.selectModel({
    sessionId: sessionId as Parameters<Context['sessionController']['selectModel']>[0]['sessionId'],
    provider: request.provider,
    model: request.model,
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
  })
  return projectSelection(sessionId, value)
}

/** 只投影 JsonValue 能承载的字段：宿主的 selected.reasoningEffort 可选，而 JsonValue 不收 undefined，显式缺键优于隐式 undefined。Project only JsonValue-bearable fields: the host's selected.reasoningEffort is optional and JsonValue rejects undefined, so an absent key beats an implicit undefined. */
function projectSelection(
  sessionId: string,
  value: Awaited<ReturnType<Context['sessionController']['selectModel']>>,
): SelectModelResult {
  const selected = value.selected
  return {
    sessionId,
    provider: selected.provider,
    model: selected.model,
    ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: String(selected.reasoningEffort) }),
  }
}
