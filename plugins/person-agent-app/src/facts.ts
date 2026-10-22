// 页面正文的部署事实读取：预设名单与模型目录。工作区由页面正文直接读
// `ctx.workspaceRegistry`，不在这里重复。本模块只读数、只出**结构化事实**——
// 标点与行排版是渲染，归页面 tsx 正文（pages.tsx）。这里不注册任何服务、
// 不监听 pre-step、不写会话日志；变化由 app-host 的 PAGE-PATCH 通道带走。
// Deployment-fact reads for the page body: the preset roster and model
// catalog. The workspace list is read straight from `ctx.workspaceRegistry`
// in the page body and is not duplicated here. This module only reads and
// returns **structured facts** — punctuation and line layout are rendering,
// which belongs to the page's tsx body (pages.tsx). It registers no service,
// listens to no pre-step, and writes no session log; changes ride app-host's
// PAGE-PATCH.
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { BuiltInPresetCopyKey } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'

/** 内置预设的英文文案，与官方 en 字典一致。English copy for the shipped presets, mirroring the official en dictionary. */
const BUILT_IN_COPY: Record<BuiltInPresetCopyKey, string> = {
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Work with code, files, and information. Suitable for most tasks, with search, editing, terminal commands, and other tools available as needed.',
  presetPtcName: 'PTC mode',
  presetPtcDescription:
    'Includes all Standard mode capabilities. Better suited to tasks that call tools in batches and then filter, organize, deduplicate, count, or summarize the results.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'The agent uses a terminal and image reading, with context compaction. Useful for testing and comparing its basic performance.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Customize DSH through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.',
}

/** 预设名单一行的结构化事实：展示名已就地解析，排版（id 加括号、说明接冒号）
 * 由页面决定。
 * / one roster row as structured facts: the display copy resolved in place; the
 * layout (id in parens, colon-prefixed purpose) is the page's call. */
export interface AgentPresetView {
  /** 稳定 id，工具取参用 / the stable id, what tools take as their argument */
  readonly id: string
  /** 展示名（内置预设经字典解析）/ display name (built-ins resolved through the dictionary) */
  readonly name: string
  /** 用途说明 / the preset's stated purpose */
  readonly description?: string
  /** 不可用原因 / why the preset is unusable */
  readonly broken?: string
}

/** 读取预设名单（展示名就地解析）；读取失败原样抛给页面，由页面如实渲染原因。
 * / Read the preset roster (display copy resolved in place); failures propagate
 * so the page renders the reason honestly. */
export async function readAgentPresets(ctx: Context): Promise<AgentPresetView[]> {
  return (await ctx.agentPresets.list()).map((preset: AgentPreset) => {
    const text = presetDisplayText(preset, key => BUILT_IN_COPY[key])
    return { id: preset.id, name: text.name, description: text.description, broken: preset.broken }
  })
}

/** 一个模型行的结构化事实：原始模态 + 解析出的上下文窗口 + 政策提示。
 * / one model row as structured facts: raw modalities, the resolved context
 * window, and the policy hint. */
export interface ModelView {
  /** 稳定 id，工具取参用 / the stable id, what tools take as their argument */
  readonly id: string
  /** 展示名 / display name */
  readonly name: string
  /** 声明的输入模态（原样透传，含 image 才能读图）/ declared input modalities (as declared; only `image` can read images) */
  readonly inputModalities: readonly string[]
  /** 精确路由解析的上下文窗口；读取失败为 undefined，页面如实标 unknown
   * / the context window resolved via the exact route; undefined on failure and the page marks it unknown honestly */
  readonly contextWindow?: number
  /** 使用建议：已知 id 用部署政策，否则宿主描述；'' = 无 / usage hint: the deployment policy for known ids, else the host description; '' = none */
  readonly hint: string
}

/**
 * 部署选型政策，价格优先：flash 是所有常规工作的默认，pro 是需说明理由的例外。
 * 对已知模型 id 生效，无论宿主元数据如何。
 * Deployment model-selection policy, price-first: flash is the default for all
 * ordinary work, pro an exception needing a stated reason. Applied to known
 * model ids regardless of host metadata.
 */
const MODEL_USAGE_HINTS: Readonly<Record<string, string>> = {
  'deepseek-flash': 'PREFERRED DEFAULT: pick this for essentially all work - coding, fast iteration, grunt work, batch tasks, RAG, everyday questions. Cheapest (about 1/5 of pro). Escalate to pro only with an explicit reason.',
  'deepseek-v4-pro': 'EXCEPTION ONLY - never the default; costs about 5x flash. Select only for major decisions or genuinely hard reasoning, and say why in your reply.',
}

/** Policy hint for known ids; otherwise the host description. 已知 id 用政策提示，否则用宿主描述。 */
function usageHint(model: LlmModelInfo): string {
  return MODEL_USAGE_HINTS[model.id] ?? model.description ?? ''
}

/** 模型目录的一个 provider 组：结构化的 provider 字段 + 它下面的模型行事实。
 * / one provider group in the model catalog: structured provider fields plus
 * its model-row facts. */
export interface ModelCatalogGroupView {
  /** 稳定 id / the stable provider id */
  readonly id: string
  /** 展示名 / display name */
  readonly name: string
  /** 该组读取失败的原因（页面如实渲染）/ why this group's read failed (the page renders it honestly) */
  readonly error?: string
  /** 该 provider 下的模型行 / model rows under this provider */
  readonly models: readonly ModelView[]
}

/** 经精确路由查询解析上下文窗口；失败写 undefined，不剔除模型。
 * / resolve the context window through the exact-route lookup; a failure means
 * undefined, never a dropped model. */
async function resolveContextWindow(ctx: Context, provider: LlmProviderInfo, model: LlmModelInfo): Promise<number | undefined> {
  try {
    return (await ctx.llm.resolveModelInfo(provider.id, model.id)).context?.contextWindow
  } catch (error: unknown) {
    ctx.logger.warn(`person-agent-app: model context read failed for ${provider.id}/${model.id}: ${errorMessage(error)}`)
    return undefined
  }
}

/** 读一个 provider 的模型组；该组读取失败时带原因、模型留空，不拖垮其他组。
 * / read one provider group; a failed group carries its reason with no models
 * and never breaks the others. */
async function readProviderGroup(ctx: Context, provider: LlmProviderInfo): Promise<ModelCatalogGroupView> {
  try {
    const models = await ctx.llm.listModels(provider.id)
    const windows = new Map<string, number | undefined>(
      await Promise.all(models.map(async model => [model.id, await resolveContextWindow(ctx, provider, model)] as const)),
    )
    return {
      id: provider.id,
      name: provider.name,
      models: models.map((model) => ({
        id: model.id,
        name: model.name,
        inputModalities: model.inputModalities ?? [],
        contextWindow: windows.get(model.id),
        hint: usageHint(model),
      })),
    }
  } catch (error: unknown) {
    return { id: provider.id, name: provider.name, error: errorMessage(error), models: [] }
  }
}

/** 读取模型目录；单个 provider 失败只影响该组，整表读取失败由页面如实渲染。
 * / read the model catalog; a single provider's failure stays local, a total
 * failure reaches the page. */
export async function readModelCatalogGroups(ctx: Context): Promise<ModelCatalogGroupView[]> {
  return await Promise.all(ctx.llm.listProviders().map(provider => readProviderGroup(ctx, provider)))
}

/** 错误转成事实可携带的一行消息 / turn an error into one message a fact can carry */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
