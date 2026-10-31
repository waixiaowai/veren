/**
 * 页面侧结构化错误（稳定 code）/ page-side structured errors with stable codes.
 *
 * 错误码常量冻结（§5.6）；消费方按 `code` 分支，新增码先报告。
 * The code table is frozen (§5.6); consumers branch on `code` — report before
 * adding a new one.
 *
 * @module @veren/prompt-page/page-errors
 */

/**
 * 页面侧稳定错误码（§5.6）。错误码常量冻结；本表是会话 C 对 §5.6 的落地，
 * 新增码先报告。Stable page-side codes; frozen — report before adding.
 */
export const PageErrorCode = {
  /** URL 不合法 / url failed canonicalization */
  UrlInvalid: 'page/url-invalid',
  /** URL 没有命中任何已注册页面 / url matched no registered page */
  PageNotFound: 'page/not-found',
  /** 页面工具与既有工具重名 / page tool name conflicts with an existing tool */
  ToolConflict: 'page/tool-conflict',
  /** 页面引用了不存在的工具 / page references an unknown tool */
  UnknownTool: 'page/unknown-tool',
  /** 索引不可用（存储失败）/ instance index unavailable */
  IndexUnavailable: 'page/index-unavailable',
  /** 索引冲突：URL 已有行 / sessionId 已被占用 / index conflict on url or sessionId */
  IndexConflict: 'page/index-conflict',
  /** 会话创建失败 / session creation failed */
  SessionCreateFailed: 'page/session-create-failed',
  /** 宿主能力缺失（sessions/agents 等）/ host capability missing */
  HostUnavailable: 'page/host-unavailable',
  /** 应用未注册 / app not registered */
  AppNotFound: 'app/not-found',
  /** 应用被禁用或损坏 / app disabled or broken */
  AppDisabled: 'app/disabled',
  /** 任务已过期 / task expired before take */
  TaskExpired: 'task/expired',
  /**
   * 投递链深超硬上限（§3.9 级联闸门）：A 投 B、B 投 C…… 超过
   * MAX_DELIVERY_HOPS 跳即拒绝，构造上阻断"页面自开页"式级联复发。
   * Delivery chain exceeded the hard hop cap (§3.9 cascade gate): A→B→C…
   * is refused past MAX_DELIVERY_HOPS — a structural brake, not caller discipline.
   */
  HopLimit: 'page/hop-limit',
  /**
   * 首页（home 档）结构不合规（§3.10.5 规则 1）：URL 带 :param，或——仅当本应用
   * 还有详情页时——map 为空。单页/纯仪表盘应用的空 map 合法，不报错。
   * / home page structurally invalid (§3.10.5 rule 1): the url carries a :param,
   * or — only when the app also has detail pages — the map is empty. An empty
   * map is legal for single-page / pure-dashboard apps and must not be rejected.
   */
  HomeInvalid: 'page/home-invalid',
  /**
   * 详情页结构不合规（§3.10.5 规则 3）：带 `:param` 且声明 `writes: true` 的页
   * 缺工具或说明为空，注册期拒绝。带 `:param` 而未声明 writes = viewer（只读
   * 详情），不走本门禁——如实注册是它的合法形态。
   * / detail page structurally invalid (§3.10.5 rule 3): a `:param` page that
   * declares `writes: true` yet lacks tools or instructions; registration is
   * refused. A `:param` page without a writes declaration is a viewer (a
   * read-only drilldown) and never sees this gate — honest registration is its
   * legal shape.
   */
  DetailInvalid: 'page/detail-invalid',
  /**
   * PAGE 块 params 与 URL 模式 :param 不一致（§3.10.5 规则 5），挂载期 fail loud。
   * / the PAGE block params disagree with the url pattern's :params (rule 5);
   * fails loud at mount.
   */
  ParamsMismatch: 'page/params-mismatch',
  /**
   * 首屏 load 失败（§3.10.3）：错误本身写进 PAGE 块 data 行，附重试指引。
   * / the first-screen load failed (§3.10.3): the error lands in the PAGE
   * block's data line with a retry hint.
   */
} as const

export type PageErrorCode = (typeof PageErrorCode)[keyof typeof PageErrorCode]

/** 带稳定 code 的结构化错误 / a structured error carrying a stable code */
export class PageError extends Error {
  /**
   * @param code - 稳定错误码 / stable machine-readable code
   * @param message - 人读说明 / human-readable account
   */
  constructor(readonly code: PageErrorCode, message: string) {
    super(message)
    this.name = 'PageError'
  }
}
