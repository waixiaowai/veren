/**
 * 目录解析：把 `/v3/config`（或控制台）文档解析成可用模型行，并按时钟重估
 * 促销。成员资格 = `cli` agent 花名册 ∩ 可用行——花名册是本插件呈现的身份
 * 被允许 chat 的集合；"列表里有一个 id"与"能被服务"是两回事，不裁减就会把
 * 发布了但服务不了的 id 送到选择器里。
 * Catalog parsing: turn a `/v3/config` (or console) document into usable model
 * rows, re-evaluating promotions against the clock. Membership = the `cli`
 * agent roster ∩ usable rows — the roster is what the identity this plugin
 * presents may chat with; a published-but-unservable id must never reach the
 * picker.
 *
 * 证据：docs/workbuddy-protocol.cn.md §4；卷宗 upstream.ts:1406-1589。
 * Evidence: docs/workbuddy-protocol.md §4; dossier upstream.ts:1406-1589.
 *
 * @module @veren/workbuddy-protocol/catalog-parse
 */

import {
  EFFORT_VALUES,
  type WorkBuddyEffort,
  type WorkBuddyModelBilling,
  type WorkBuddyModelReasoning,
  type WorkBuddyPromotion,
  type WorkBuddyUpstreamModel,
} from './catalog-types.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isEffort(value: unknown): value is WorkBuddyEffort {
  return typeof value === 'string' && (EFFORT_VALUES as readonly string[]).includes(value)
}

/**
 * 把上游 `credits` 字符串折算成语言中立显示形：去掉尾部单位词（`credits`，
 * 大小写不敏感单复数）。宿主缝没有 locale 服务，这里的字符串会原样出现在
 * 每种 UI 语言里；`x0.79 credits` 会把显示钉死在英文。
 * Reduce an upstream credits string to its language-neutral display form by
 * trimming a trailing unit word. Whatever string is produced here is shown
 * verbatim in every UI language.
 */
export function normalizeCredits(credits: string | undefined): string | undefined {
  if (credits === undefined) return undefined
  const trimmed = credits.trim()
  if (trimmed === '') return undefined
  if (/^credits?$/iu.test(trimmed)) return undefined
  const bare = trimmed.replace(/\s+credits?$/iu, '').trim()
  return bare === '' ? undefined : bare
}

/** 解析一行目录的推理元数据（保守默认：不能关思考）。 */
/** Parse one row's reasoning metadata (conservative default: thinking cannot be disabled). */
function resolveReasoning(row: Record<string, unknown>): WorkBuddyModelReasoning {
  const supportedEfforts = Array.isArray(row['reasoning'] && (row['reasoning'] as Record<string, unknown>)['supportedEfforts'])
    ? ((row['reasoning'] as Record<string, unknown>)['supportedEfforts'] as unknown[]).filter(isEffort)
    : undefined
  const rawReasoning = isObject(row['reasoning']) ? row['reasoning'] : undefined
  let defaultEffort: WorkBuddyEffort | undefined
  if (rawReasoning !== undefined) {
    const candidate = rawReasoning['defaultEffort'] ?? rawReasoning['effort']
    if (isEffort(candidate)) defaultEffort = candidate
  }
  return {
    supports: row['supportsReasoning'] === true,
    onlyReasoning: row['onlyReasoning'] === true,
    ...(supportedEfforts !== undefined && supportedEfforts.length > 0 ? { supportedEfforts } : {}),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
    canDisableThinking: rawReasoning?.['canDisableThinking'] === true,
  }
}

/** 解析一行目录的计费元数据（`x0.00` ⇒ 免费，按规范化倍率判断）。 */
/** Parse one row's billing metadata (`x0.00` ⇒ free, judged from the normalized multiplier). */
function resolveBilling(row: Record<string, unknown>, extraTags: readonly string[] | undefined): WorkBuddyModelBilling {
  const rawCredits = row['credits']
  const credits = typeof rawCredits === 'string' && rawCredits.trim() !== '' ? rawCredits.trim() : undefined
  const badges: string[] = []
  const rawTags: readonly unknown[] = [...Array.isArray(row['tags']) ? row['tags'] : [], ...extraTags ?? []]
  for (const tag of rawTags) {
    if (typeof tag !== 'string') continue
    if (!tag.toLowerCase().startsWith('badge:')) continue
    const label = tag.slice(6).split(':')[0] ?? tag.slice(6)
    if (label !== '' && !badges.includes(label)) badges.push(label)
  }
  const multiplier = normalizeCredits(credits)
  const free = multiplier !== undefined && /^x?0\.0+$/u.test(multiplier)
  return {
    ...(credits === undefined ? {} : { credits }),
    ...(badges.length === 0 ? {} : { badges }),
    free,
  }
}

/** 从 `modelPromotions` 抽出覆盖 `model` 的已核实促销（其余形态一律丢弃而非猜测）。 */
/** Extract the verified promotions covering `model`; anything else is dropped, not guessed at. */
function parsePromotions(value: unknown, model: string): WorkBuddyPromotion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!isObject(item) || item['enabled'] !== true) return []
    if (!Array.isArray(item['modelIds']) || !item['modelIds'].includes(model)) return []
    const schedule = item['schedule']
    const discount = item['discount']
    const badge = item['badge']
    if (!isObject(schedule) || !isObject(discount) || !isObject(badge)) return []
    // 只有替换式折扣有无歧义的显示规则；其余 displayMode 留给上游自己的客户端。
    // Only a replacement discount has an unambiguous display rule.
    if (discount['displayMode'] !== 'replace') return []
    const start = typeof schedule['validFrom'] === 'string' ? Date.parse(schedule['validFrom']) : Number.NaN
    const end = typeof schedule['validUntil'] === 'string' ? Date.parse(schedule['validUntil']) : Number.NaN
    const factor = discount['factor']
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0) return []
    return [{
      start, end, factor,
      label: typeof badge['label'] === 'string' ? badge['label'] : '',
      priority: typeof item['priority'] === 'number' && Number.isFinite(item['priority']) ? item['priority'] : 0,
    }]
  })
}

/**
 * 解析信封解开后的目录文档。两形状共用：`data` 或裸产品文档。
 * 花名册缺失或交集为空是硬错误——空目录应是"没登录"或"上游翻脸"的显式信号，
 * 不该伪装成正常的空清单。
 * Parse a catalog document after its envelope is unwrapped. A missing roster or
 * empty intersection is a hard error — an empty catalog must be an explicit
 * "signed out" or "upstream turned" signal, never a quiet empty list.
 */
export function parseModelCatalog(
  data: Record<string, unknown>,
  international = false,
  promoBadges?: ReadonlyMap<string, readonly string[]>,
): readonly WorkBuddyUpstreamModel[] {
  const rawModels = Array.isArray(data['models']) ? data['models'] : []
  const agents = Array.isArray(data['agents']) ? data['agents'] : []
  let cliIds: readonly string[] | undefined
  for (const agent of agents) {
    if (isObject(agent) && agent['name'] === 'cli' && Array.isArray(agent['models'])) {
      cliIds = agent['models'].filter((id): id is string => typeof id === 'string')
      break
    }
  }
  if (cliIds === undefined || cliIds.length === 0) {
    throw new Error('workbuddy model catalog lists no cli agent models')
  }
  const byId = new Map<string, WorkBuddyUpstreamModel>()
  for (const model of rawModels) {
    if (!isObject(model)) continue
    const id = typeof model['id'] === 'string' ? model['id'] : ''
    if (id === '' || model['disabled'] === true) continue
    const input = typeof model['maxInputTokens'] === 'number' ? model['maxInputTokens'] : 0
    const output = typeof model['maxOutputTokens'] === 'number' ? model['maxOutputTokens'] : 0
    if (input <= 0 || output <= 0) continue
    const window = isObject(model['contextWindow']) ? model['contextWindow'] : undefined
    byId.set(id, {
      id,
      name: typeof model['name'] === 'string' && model['name'] !== '' ? model['name'] : id,
      contextWindow: international && positive(window?.['defaultLength']) ? (window?.['defaultLength'] as number) : input,
      ...(international ? {
        ...(positive(window?.['defaultLength']) ? { defaultContextWindow: window?.['defaultLength'] as number } : {}),
        maxInputTokens: input,
        supportedContextWindows: Array.isArray(window?.['supportedLengths'])
          ? (window?.['supportedLengths'] as unknown[]).filter(positive) : [],
        promotions: parsePromotions(data['modelPromotions'], id),
      } : {}),
      maxTokens: output,
      supportsImages: model['supportsImages'] === true && model['disabledMultimodal'] !== true,
      reasoning: resolveReasoning(model),
      billing: resolveBilling(model, promoBadges?.get(id)),
    })
  }
  const models = cliIds.map(id => byId.get(id)).filter((model): model is WorkBuddyUpstreamModel => model !== undefined)
  if (models.length === 0) throw new Error('workbuddy model catalog resolved to an empty list')
  return models
}

/**
 * 按当前时钟重估一行模型的促销。促销时间盒化而目录按进程缓存——冻结在解析
 * 时刻的「限时免费」会在 `validUntil` 之后继续声称折扣。不在生效期时诚实
 * 收声：丢掉报价、摘掉标签、报 `rateUnknown`，绝不继续声称免费。
 * Re-evaluate one model's promotion against the current time. Promotions are
 * time-boxed while the catalog is cached for the process's life; a frozen "free
 * now" keeps claiming a discount after `validUntil`. When none is in force the
 * honest answer is to stop asserting a price and mark `rateUnknown`.
 */
export function modelWithCurrentPromotion(model: WorkBuddyUpstreamModel, now: number = Date.now()): WorkBuddyUpstreamModel {
  if (model.promotions === undefined || model.promotions.length === 0) return model
  const promotion = [...model.promotions]
    .sort((a, b) => b.priority - a.priority)
    .find(candidate => now >= candidate.start && now < candidate.end)
  if (promotion === undefined) {
    const derivedFromPromotion = model.billing?.free === true
      || (model.billing?.badges?.length ?? 0) > 0
      || model.promotions.some(candidate => candidate.factor !== 1)
    if (!derivedFromPromotion) return model
    return { ...model, billing: { free: false, rateUnknown: true } }
  }
  const rate = normalizeCredits(model.billing?.credits)
  const original = rate !== undefined && rate.startsWith('x') ? Number(rate.slice(1)) : Number.NaN
  // 替换为 0 即使基础价未知也有意义（Auto 行价格串为空）；其余乘数没有数字就不发明。
  // A replacement to zero is meaningful even with an unknown base; other multipliers are skipped rather than invented.
  if (promotion.factor !== 0 && !Number.isFinite(original)) return model
  const value = promotion.factor === 0 ? 0 : original * promotion.factor
  return {
    ...model,
    billing: {
      ...model.billing,
      credits: `x${value.toFixed(2)}`,
      free: value === 0,
      badges: [...model.billing?.badges ?? [], ...promotion.label === '' ? [] : [promotion.label]],
    },
  }
}
