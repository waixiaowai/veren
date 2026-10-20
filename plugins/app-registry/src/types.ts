/**
 * 应用侧共享契约（只放类型与常量）/ Application-side shared contracts (types & constants only)
 *
 * 本文件是会话 A（app-registry 实现）与其它会话之间的接口合同：
 * - 字段语义以 docs/application-concept.cn.md §2.3、§3.1、§6.2 为准；
 * - 跨边界 id 用 brand（零运行时开销）；错误码是稳定字符串，失败方必须原样抛出。
 * This file is the contract between session A (the app-registry implementer)
 * and the other sessions; field semantics follow the design doc §2.3/§3.1/§6.2.
 */
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
 * `requires` 是本应用声明的全局能力；页面工具级的能力检查在 `AppToolDefinition.requires`。
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

/** 页面工具定义（应用级目录；最终名 = `<toolPrefix>__<name>`）/ app-scoped tool definition */
export interface AppToolDefinition {
  /** 本地名：应用内唯一，≤24 字符 / local name, unique within the app */
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  /** 调用此工具需要的能力 / capabilities required to call this tool */
  readonly requires?: readonly AppCapability[]
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
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
  /** 定义工具：本地名重复 fail loud（app/tool-duplicate） */
  define(tool: AppToolDefinition): () => void
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
