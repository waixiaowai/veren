// 模型目录职责：读取活跃 LLM 注册表，把「provider → 模型」连同多模态输入支持
// 与上下文窗口渲染成快照行。类型完全复用宿主的 LlmProviderInfo / LlmModelInfo
// （不另造类型）；上下文窗口来自 resolveModelInfo 的精确路由查询。读取路径与
// 宿主 modelCatalog 远端（session-controller 的 buildModelCatalog）一致。单个
// provider 失败只告警并跳过该组——名单读失败永不炸快照。
// Model catalog responsibility: read the live LLM registry and render the
// "provider → models" roster with multimodal input support and context window
// as snapshot lines. The types are the host's own LlmProviderInfo /
// LlmModelInfo (no re-declared shapes); the context window comes from the
// exact-route resolveModelInfo lookup. The read path matches the host
// modelCatalog remote (session-controller's buildModelCatalog). One failing
// provider only warns and is skipped — a failed catalog read never breaks the
// snapshot.
import type { Context } from '@deepseek-ai/cordis'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
// 类型-only import：拉取 llm 服务（LlmRuntime）的 Context 声明合并。
// Type-only import: pulls the llm service (LlmRuntime) Context declaration merging.
import type {} from '@deepseek-ai/dsh-llm'
import { withHeading } from './render.js'

/** Facts of one routable provider after per-provider read failures were dropped. 剔除读取失败的 provider 后，单个可路由 provider 的事实。 */
export interface ModelCatalogGroup {
  /** The host provider's own display metadata. 宿主 provider 自带的展示元数据。 */
  provider: LlmProviderInfo
  /** The host's advertised models in adapter-preferred order. 宿主提供的模型列表（适配器偏好顺序）。 */
  models: readonly LlmModelInfo[]
}

/** Context window per model id, resolved through the exact-route lookup. 逐模型的上下文窗口，来自精确路由查询。 */
export type ModelContextWindows = ReadonlyMap<string, number | undefined>

/** Render one model line: display name, id, modality, and context window. 把一个模型渲染成一行：名称、id、模态与上下文窗口。 */
export const renderModelCatalogModel = (model: LlmModelInfo, contextWindow: number | undefined): string => {
  const modality = (model.inputModalities ?? []).includes('image') ? 'text+image' : 'text'
  const context = contextWindow === undefined ? 'context unknown' : `context ${contextWindow} tokens`
  return `  - ${model.name}(${model.id}): input ${modality} · ${context}`
}

/** Render one provider block: the provider line, then its models. 把一个 provider 渲染成块：provider 行加其模型列表。 */
export const renderModelCatalogGroup = (group: ModelCatalogGroup, contextWindows: ModelContextWindows): string[] => [
  `- ${group.provider.name}(${group.provider.id})`,
  ...group.models.map(model => renderModelCatalogModel(model, contextWindows.get(model.id))),
]

/**
 * Resolve one model's context capacity through the exact-route lookup, so the
 * number comes from the same source requests use; a failed lookup leaves the
 * column "unknown" instead of dropping the model.
 * 经精确路由查询解析单个模型的上下文容量，数值与请求同源；查询失败该列显示
 * unknown，不剔除模型。
 */
async function resolveContextWindow(ctx: Context, provider: LlmProviderInfo, model: LlmModelInfo): Promise<number | undefined> {
  try {
    return (await ctx.llm.resolveModelInfo(provider.id, model.id)).context?.contextWindow
  } catch (error) {
    ctx.logger.warn(`person-agent dynamic context: model context read failed for ${provider.id}/${model.id}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Read one provider's models; a failed read warns and yields nothing, so the
 * provider group is dropped from this snapshot without breaking the rest.
 * 读取单个 provider 的模型；失败只告警并返回空，该 provider 组从本次快照中剔除，
 * 不影响其他组。
 */
async function readGroup(ctx: Context, provider: LlmProviderInfo): Promise<string[]> {
  try {
    const models = await ctx.llm.listModels(provider.id)
    if (models.length === 0) return []
    const contextWindows = new Map<string, number | undefined>(
      await Promise.all(models.map(async model => [model.id, await resolveContextWindow(ctx, provider, model)] as const)),
    )
    return renderModelCatalogGroup({ provider, models }, contextWindows)
  } catch (error) {
    ctx.logger.warn(`person-agent dynamic context: model catalog read failed for ${provider.id}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/**
 * Read the live LLM registry and return the `## Model Catalog` section lines:
 * one provider group per routable provider, empty when no provider advertises
 * models (the caller then emits no heading).
 * 读取活跃 LLM 注册表并返回 `## Model Catalog` 区块行：每个可路由 provider 一组；
 * 没有任何 provider 提供模型时为空（调用方据此不加标题）。
 */
export async function readModelCatalogSection(ctx: Context): Promise<string[]> {
  const groups = await Promise.all(ctx.llm.listProviders().map(provider => readGroup(ctx, provider)))
  return withHeading('## Model Catalog', groups.flat())
}
