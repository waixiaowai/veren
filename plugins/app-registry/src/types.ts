/**
 * 应用侧共享契约（只放类型与常量）/ Application-side shared contracts (types & constants only)
 *
 * 本文件是会话 A（app-registry 实现）与其它会话之间的接口合同：
 * - 字段语义以 docs/application-concept.cn.md §2.3、§3.1、§6.2 为准；
 * - 跨边界 id 用 brand（零运行时开销）；错误码是稳定字符串，失败方必须原样抛出。
 * This file is the contract between session A (the app-registry implementer)
 * and the other sessions; field semantics follow the design doc §2.3/§3.1/§6.2.
 */
import type { PageDefinition, PageLiveBinding } from '@veren/prompt-page'

/** 应用 id：安装后稳定，进入页面 URL、存储域、任务 kind、工具前缀 / stable app identity */
export type AppId = string & { readonly __brand: 'AppId' }

/** 能力名：`<域>:<动作>`，如 `tasks:send` / capability name like `tasks:send` */
export type AppCapability = string & { readonly __brand: 'AppCapability' }

/** 应用内页面键（不含应用前缀）/ app-internal page key */
export type PageKey = string & { readonly __brand: 'PageKey' }

/** 应用 id 的保留字 / reserved app ids */
export const RESERVED_APP_IDS: readonly string[] = ['api', 'apps', 'system', '__global__']

/**
 * 应用定义（运行时权威面）。
 * `requires` 是本应用声明的全局能力；页面工具级的能力在 `define(tool, { requires })`
 * 的注册元参数上声明（工具本体保持纯 DSH `ToolDefinition` 形状）。
 */
export interface ApplicationDefinition {
  /** 稳定 slug：小写字母开头，仅小写字母/数字/连字符，≤32 字符，不占保留字 */
  readonly id: AppId
  /** 显示名 / display name */
  readonly name: string
  /** 一句话说明（目录/商店用）/ catalog-facing description */
  readonly description: string
  /** 入口页面键（应用内，不是 URL）/ entry page key (app-internal, not a url) */
  readonly entry: PageKey
  /** 应用级说明：随 PAGE 块附上，不是系统提示词 / app-level note, not a system prompt */
  readonly instructions?: string
  /** 工具名前缀；缺省由 id 推导（连字符换下划线）/ tool-name prefix, derived from id by default */
  readonly toolPrefix?: string
  /** 声明的全局能力 / declared capabilities */
  readonly requires?: readonly AppCapability[]
}

/** 应用的一条运行时记录 / one runtime application record */
export interface AppRecord {
  readonly definition: ApplicationDefinition
  /** 注册时从 fiber 推导的提供包名 / owner package derived from the registering fiber */
  readonly owner: string
  /** 组合包版本快照 / bundle version snapshot */
  readonly version: string
  /** 分配到的最终工具前缀 / assigned final tool prefix */
  readonly toolPrefix: string
  readonly state: 'active' | 'disabled' | 'broken'
  readonly brokenReason?: string
  /**
   * 本应用已注册页面的投影（键 = 应用内页面键）：map 由注册表推导（RFC
   * prompt-page-render §3.5）与规则 1 的"列全记录页"都从这里取事实。可选：
   * 手工构造 AppRecord 的既有测试/消费方缺省视为无页面。
   * A projection of the app's registered pages (keyed by app-internal page
   * key): the registry-derived map (RFC prompt-page-render §3.5) and rule 1's
   * "list all record pages" both take their facts from here. Optional: legacy
   * consumers/tests that hand-build AppRecord default to no pages.
   */
  readonly pages?: ReadonlyMap<string, { readonly url: string; readonly description: string; readonly component: boolean }>
}

/**
 * 一条页面登记：定义 + 实时数据绑定（必填——页面 = 组件页，§3.10.3 的权威 store
 * 由 defineComponentPage 在适配时一并产出）。
 * One page registration: the definition plus the required live data binding
 * (a page IS a component page; defineComponentPage produces the §3.10.3
 * authoritative-store binding during adaptation).
 */
export interface PageRegistration {
  readonly page: PageDefinition<never>
  readonly live: PageLiveBinding
  /** 组件页标记（RFC prompt-page-render §3.5）：map 由注册表推导，正文渲染为 Markdown
   * / the component-page marker (RFC prompt-page-render §3.5): the map is registry-derived and the body renders as Markdown */
  readonly component?: boolean
}

/** 页面注册面：只有应用自己能拿到 / app-scoped page registrar */
export interface AppPageRegistrar {
  /**
   * 注册页面：URL 由宿主拼上 `/apps/<appId>` 前缀；返回 disposer（HMR/卸载安全）。
   * `live.store` 让本页成为"活的视图"（§3.10.3）：宿主在页面会话建立时按参数
   * 挂载订阅该 store 的视图，store 变化经 PAGE-DATA 块同步进上下文。状态类型
   * S 在这里（注册处）被消费；registry/运行时只见擦除后的绑定闭包。
   * Register a page; the url gains the `/apps/<appId>` prefix; returns a
   * disposer (HMR/unload safe). `live.store` makes the page a live view
   * (§3.10.3): the host mounts a store-subscribed view per page session, and
   * store changes reach the context as PAGE-DATA blocks. The state type S is
   * consumed here; the registry and the runtime see only the erased closure.
   */
  /**
   * 组件页注册（RFC prompt-page-render §3.5/C8 的唯一注册签名扩展）：传 PageFC
   * 组件 + 契约 meta，适配器（defineComponentPage）内部包成 PageDefinition 与
   * 实时绑定——一次性渲染：组件体在页面会话的真实 Agent 上执行恰好一次，正文
   * 成型为 Markdown，工具/订阅/skill/首屏读由组件体经 `agent.ctx` 直接登记
   * （页面 meta 无任何行为钩子）。返回 disposer（HMR/卸载安全）。
   * P 由组件与 meta 同时推断。
   * Component-page registration (the single registration-signature extension of
   * RFC prompt-page-render §3.5/C8): pass a PageFC component + contract meta;
   * the adapter (defineComponentPage) wraps them into a PageDefinition plus a
   * live binding — the one-shot render: the body runs exactly once on the page
   * session's real Agent, its output finalized into Markdown, with tools/
   * subscriptions/skills/the first-screen read registered by the body via
   * `agent.ctx` (the page meta carries no behavioral hooks). Returns a disposer
   * (HMR/unload safe). P is inferred from both the component and meta.
   */
  register<P extends Record<string, unknown>>(component: import('@veren/prompt-page').PageFC<P>, meta: import('@veren/prompt-page').ComponentPageMeta<P>): () => void
  /**
   * 预构建注册对象（prompt-page 的 defineComponentPage 产物）直接登记——
   * 调用方自己持有适配结果时用这个形态。
   * Register a pre-built registration object (defineComponentPage's product)
   * directly — for callers that already hold the adapter's result.
   */
  register(registration: import('@veren/prompt-page').ComponentPageRegistration): () => void
}

/**
 * 页面镜像面（缺口 3 的收敛点）：由宿主装配把 page-registry 接进来，
 * registerPage 内部自动镜像，应用作者只调一次注册。
 * The page-mirror face (gap-3 convergence): wired by host assembly; registerPage
 * mirrors automatically so app authors register once.
 */
export interface PageMirrorFace {
  /** 镜像一条页面注册（live 绑定必填：页面 = 组件页）；失败抛错（内部登记会回滚）
   * / mirror one page (the live binding is required: a page IS a component page); throw to roll back */
  registerAppPage(appId: AppId, page: PageDefinition<never>, live: PageLiveBinding): () => void
  /** 应用卸载/禁用：摘掉该应用所有活会话的页面工具（§7.2/§7.4）/ strip page tools on teardown */
  releaseApp?(appId: AppId): Promise<void> | void
}

/**
 * 错误 details 的闭集字段：机器可读上下文全部是字符串 id/url/名字，
 * 不用 `Record<string, unknown>` 逃逸。
 * Closed details fields: machine-readable context is always a string id/url/name;
 * no `Record<string, unknown>` escape hatch.
 */
export interface AppErrorDetails {
  readonly appId?: string
  readonly url?: string
  readonly page?: string
  readonly tool?: string
  readonly id?: string
  readonly field?: string
  readonly toolPrefix?: string
  readonly existingApp?: string
  readonly newApp?: string
  readonly face?: string
}

/** 应用侧稳定错误码 / stable application error codes */
export const AppErrorCode = {
  /** 应用已禁用 / app is disabled */
  Disabled: 'app/disabled',
  /** 应用不存在 / app not found */
  NotFound: 'app/not-found',
  /** 应用请求绑定预设（第 1 阶段一律拒绝）/ app tried to bind a preset (always rejected in phase 1) */
  PresetRestricted: 'app/preset-restricted',
  /** 入口页面缺失 / entry page missing */
  EntryMissing: 'app/entry-missing',
  /**
   * 入口指向了带 :param 的页面（§3.10.5 规则 4）：entry 必须指向首页（home 档）；
   * 应用标 broken，不抛到宿主启动。
   * / the entry points at a :param page (§3.10.5 rule 4): entry must be the home
   * page (the home archetype); the app turns broken instead of failing host startup.
   */
  EntryNotHome: 'app/entry-not-home',
  /** 工具本地名重复 / duplicate tool local name */
  ToolDuplicate: 'app/tool-duplicate',
  /** 工具前缀冲突 / tool prefix conflict */
  ToolPrefixConflict: 'app/tool-prefix-conflict',
  /** id/slug/前缀等清单不合法 / invalid manifest field */
  ManifestInvalid: 'app/manifest-invalid',
  /** 能力未授予 / capability not granted */
  PermissionDenied: 'app/permission-denied',
  /** 跨应用注销/改动被拒 / cross-app mutation forbidden */
  Forbidden: 'app/forbidden',
} as const

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode]
