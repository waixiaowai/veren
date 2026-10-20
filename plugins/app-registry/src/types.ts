/**
 * 应用侧共享契约（只放类型与常量）/ Application-side shared contracts (types & constants only)
 *
 * 本文件是会话 A（app-registry 实现）与其它会话之间的接口合同：
 * - 字段语义以 docs/application-concept.cn.md §2.3、§3.1、§6.2 为准；
 * - 跨边界 id 用 brand（零运行时开销）；错误码是稳定字符串，失败方必须原样抛出。
 * This file is the contract between session A (the app-registry implementer)
 * and the other sessions; field semantics follow the design doc §2.3/§3.1/§6.2.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PageDefinition } from '@veren/prompt-page'

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
}

/**
 * 工具定义直接复用 DSH 的 `ToolDefinition`（`@deepseek-ai/dsh-tools` 的
 * `defineTool` 产物）：名称/描述/参数/输出契约/执行体只有一种形状，应用目录
 * 不是第二套工具类型。能力等注册期元数据走 {@link AppToolRegistrar.define}
 * 的第二个参数，不塞进 DSH 类型。
 * Tool definitions reuse DSH's `ToolDefinition` verbatim — the app catalog is
 * not a second tool type. Capability metadata rides the registrar, not DSH.
 */
/** 应用工具目录条目：DSH 工具本体 + 注册期元数据 / catalog entry: DSH tool + registration meta */
export interface AppToolEntry {
  /** 工具本体（defineTool 产物，未改字段）/ the DSH definition itself, fields untouched */
  readonly tool: ToolDefinition
  /** 第 1 阶段只记录不强制的能力声明 / capability declaration, recorded not enforced in phase 1 */
  readonly requires?: readonly AppCapability[]
}

/** 页面注册面：只有应用自己能拿到 / app-scoped page registrar */
export interface AppPageRegistrar {
  /** 注册页面：URL 由宿主拼上 `/apps/<appId>` 前缀；返回 disposer（HMR/卸载安全） */
  register(page: PageDefinition<never>): () => void
}

/**
 * 页面镜像面（缺口 3 的收敛点）：由宿主装配把 page-registry 接进来，
 * registerPage 内部自动镜像，应用作者只调一次注册。
 * The page-mirror face (gap-3 convergence): wired by host assembly; registerPage
 * mirrors automatically so app authors register once.
 */
export interface PageMirrorFace {
  /** 镜像一条页面注册；失败抛错（内部登记会回滚）/ mirror one page; throw to roll back */
  registerAppPage(appId: AppId, page: PageDefinition<never>): () => void
  /** 应用卸载/禁用：摘掉该应用所有活会话的页面工具（§7.2/§7.4）/ strip page tools on teardown */
  releaseApp?(appId: AppId): Promise<void> | void
}

/** 工具目录注册面 / app-scoped tool registrar */
export interface AppToolRegistrar {
  /**
   * 定义工具：本体必须是 `defineTool` 产物；本地名重复 fail loud（app/tool-duplicate）。
   * `requires` 等应用侧元数据放这里，工具本体保持纯 DSH 形状（第 1 阶段只记录不强制）。
   * The tool body must come from `defineTool`; app-side metadata rides here so
   * the DSH shape stays pure (recorded, not enforced, in phase 1).
   */
  define(tool: ToolDefinition, meta?: { readonly requires?: readonly AppCapability[] }): () => void
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
