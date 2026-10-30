/**
 * 目录与计费的值类型（纯数据，无解析逻辑）。
 * Value types of the catalog and billing (pure data, no parsing).
 *
 * @module @veren/workbuddy-protocol/catalog-types
 */

/** WorkBuddy 线上的档位拼写闭集（`minimal` 不存在于上游词表）。 */
/** The closed set of effort spellings on the wire (`minimal` exists in no upstream vocabulary). */
export type WorkBuddyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 档位词表，供过滤与遍历。The effort vocabulary, for filtering and iteration. */
export const EFFORT_VALUES: readonly WorkBuddyEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** 目录行声明的推理元数据。Reasoning metadata a catalog row declares. */
export interface WorkBuddyModelReasoning {
  /** 是否推理模型（上游 `supportsReasoning`）。Whether the model reasons at all. */
  readonly supports: boolean
  /** 是否只会推理（上游 `onlyReasoning`）。Whether the model can only reason. */
  readonly onlyReasoning: boolean
  /** 可选档位集；缺省=该行无显式集。Selectable efforts; absent means no explicit set. */
  readonly supportedEfforts?: readonly WorkBuddyEffort[]
  /** 上游默认档位。The upstream's default effort. */
  readonly defaultEffort?: WorkBuddyEffort
  /** 能否关思考；false=恒开。显式 `true` 才算能关（旧行缺字段且若干线上拒 `off`）。 */
  /** Whether thinking can be switched off; only an explicit `true` counts (older rows omit it and several reject `off` on the wire). */
  readonly canDisableThinking: boolean
}

/** 计费便捷元数据。Billing convenience metadata. */
export interface WorkBuddyModelBilling {
  /** 倍率原文，如 `x0.79` 或 `x0.79 credits`。The raw multiplier string. */
  readonly credits?: string
  /** 促销标签，如 `限时免费`。Promotional labels. */
  readonly badges?: readonly string[]
  /** 当前免费（规范化倍率为 `x0.00`）。Currently free (`x0.00` normalized). */
  readonly free: boolean
  /** 报价不可言说：行带促销但无一在生效期，缓存行上的折扣价已过期，原价不可恢复。 */
  /** The rate cannot be stated right now: the row's baked price described a promotion that has ended and the original is unrecoverable. */
  readonly rateUnknown?: boolean
}

/** 一条已核实的时间盒促销（只建模实测形态：enabled + replace 折扣）。 */
/** One verified promotion (only the measured shape: enabled, time-boxed, `replace` discount). */
export interface WorkBuddyPromotion {
  readonly start: number
  readonly end: number
  readonly label: string
  /** 折扣乘数；`0` 表示直接替换为免费。The multiplier; `0` replaces the rate outright. */
  readonly factor: number
  /** 多促销覆盖同模型时高者胜。Higher wins when several cover one model. */
  readonly priority: number
}

/** 上游目录描述的一条可用模型。One CLI-usable model as the upstream catalog describes it. */
export interface WorkBuddyUpstreamModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  /** 上游首选窗口（可选最大窗口之前的那个）。The upstream's preferred window before an optional maximum. */
  readonly defaultContextWindow?: number
  readonly maxInputTokens?: number
  readonly supportedContextWindows?: readonly number[]
  readonly promotions?: readonly WorkBuddyPromotion[]
  readonly maxTokens: number
  /** 图片输入能力：缺失/false 按 false——夸口会让一条已入库的消息在请求时被上游拒。 */
  /** Image input capability: missing/false resolves false — over-claiming admits an image the provider then rejects. */
  readonly supportsImages: boolean
  readonly reasoning?: WorkBuddyModelReasoning
  readonly billing?: WorkBuddyModelBilling
}

/** 一个计费包与其余额。One billing package and its remaining credit. */
export interface WorkBuddyCreditAccount {
  readonly packageName: string
  readonly remain: number
  readonly size: number
  /** 周期配额无上限（CN 企业端点 `limitNum === -1`）。The cycle quota is uncapped. */
  readonly unlimited?: true
}

/** 一个凭据的聚合余额。The aggregated credit answer for one credential. */
export interface WorkBuddyCredits {
  readonly total: number
  readonly accounts: readonly WorkBuddyCreditAccount[]
  /** 无上限标志：独立于 total——`-1`（无上限）与 `0`（用光）对读者是相反语义，绝不折叠。 */
  /** Uncapped flag: separate from `total` — "no limit" and "nothing left" are opposite meanings, never folded. */
  readonly unlimited?: true
  readonly cycleResetTime?: string
}
