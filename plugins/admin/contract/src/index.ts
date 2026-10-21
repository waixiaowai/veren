/**
 * The stable capability contract of the DSH admin platform.
 *
 * Consumers (business modules, the API gateway, the UI kernel) depend only on
 * these declarations; providers are replaceable implementations behind the
 * kernel façades. Nothing here is runtime code beyond constants and the error
 * class, so importing it never pulls an implementation.
 *
 * `@veren/admin-contract` — DSH 后台平台的稳定 Host 能力契约。消费方（业务模块、
 * API 网关、UI 内核）只依赖这些声明；provider 是内核 façade 之后的可替换实现。
 * 除常量与错误类外本包不含运行时代码，因此引用它绝不会拉入任何实现。
 *
 * @module @veren/admin-contract
 */

/**
 * The permission catalog every provider and module shares.
 *
 * Permission strings are wire values: clients, routes and role definitions all
 * compare them literally, so one exported table keeps them from drifting.
 *
 * 每个 provider 与模块共享的权限目录。权限串是线上值：客户端、路由与角色定义都按字面
 * 比较，因此集中导出一张表以免漂移。
 */
export const ADMIN_PERMISSIONS = {
  /** Dashboard read. 仪表盘读取。 */
  dashboardRead: 'admin.dashboard.read',
  /** User directory management. 用户目录管理。 */
  usersManage: 'admin.users.manage',
  /** Role and binding management. 角色与绑定管理。 */
  rolesManage: 'admin.roles.manage',
  /** API token management. API token 管理。 */
  tokensManage: 'admin.tokens.manage',
  /** Audit trail read. 审计轨迹读取。 */
  auditRead: 'admin.audit.read',
  /** Capability catalog read. 能力目录读取。 */
  capabilitiesRead: 'admin.capabilities.read',
  /** Module settings write. 模块设置写入。 */
  settingsWrite: 'admin.settings.write',
  /** Current profile plugin management. 当前 profile 插件管理。 */
  pluginsManage: 'admin.plugins.manage',
  /** Terminal task read. 终端任务读取。 */
  terminalTasksRead: 'terminal.tasks.read',
  /** Terminal task decision. 终端任务决定。 */
  terminalTasksDecide: 'terminal.tasks.decide',
} as const

/** One permission string from {@link ADMIN_PERMISSIONS}. {@link ADMIN_PERMISSIONS} 中的单个权限串。 */
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS]

/**
 * Semantic version of this contract. A provider declares the range it
 * implements in {@link ProviderManifest.contract}; the kernel activates only a
 * provider whose range admits this version.
 *
 * 本契约的语义版本。provider 在 {@link ProviderManifest.contract} 中声明自己实现的
 * 范围；内核只激活范围容纳该版本的 provider。
 */
export const ADMIN_CONTRACT_VERSION = '1.0.0'

/**
 * Every capability the platform can host. Essential capabilities gate boot;
 * optional ones degrade to hidden UI and closed endpoints.
 *
 * 平台可承载的全部能力。必需能力决定能否启动；可选能力缺失时降级为隐藏 UI 与关闭的端点。
 */
export type CapabilityName =
  | 'data'
  | 'auth'
  | 'access'
  | 'navigation'
  | 'audit'
  | 'settings'
  | 'docs'

/** Capabilities without which the platform must not serve traffic. 缺失即不得对外提供服务的能力。 */
export const ESSENTIAL_CAPABILITIES = ['data', 'auth', 'access', 'navigation', 'audit'] as const

/** Capabilities that may be absent; absence hides their endpoints and UI. 可以缺失的能力；缺失时关闭其端点与 UI。 */
export const OPTIONAL_CAPABILITIES = ['settings', 'docs'] as const

/** Health verdict shared by capabilities and backend components. 能力与后端组件共用的健康结论。 */
export type HealthStatus = 'ok' | 'degraded' | 'down'

/** Result of one health probe. 单次健康探测的结果。 */
export interface HealthReport {
  /** Verdict for the probed subject. 被探测对象的结论。 */
  readonly status: HealthStatus
  /** Human-readable detail, present when the verdict is not `ok`. 非 `ok` 时给出的人类可读细节。 */
  readonly detail?: string
  /** ISO-8601 UTC instant of the probe. 探测时刻（ISO-8601 UTC）。 */
  readonly checkedAt?: string
}

/**
 * What a provider package declares about itself. The kernel reads only this
 * declaration when choosing the active implementation.
 *
 * provider 包对自身的声明。内核只依据该声明选择激活实现。
 */
export interface ProviderManifest {
  /** Unique provider id inside its capability. 能力内唯一的 provider id。 */
  readonly id: string
  /** Capability this provider implements. 本 provider 实现的能力。 */
  readonly capability: CapabilityName
  /** Contract range implemented, for example `^1.0`. 实现的契约范围，例如 `^1.0`。 */
  readonly contract: string
  /** Selection priority among compatible providers; higher wins. 兼容 provider 间的选择优先级，数值越高越优先。 */
  readonly priority: number
  /** Data domain this provider owns, when it persists records. 该 provider 拥有的数据域（若持久化数据）。 */
  readonly dataDomain?: string
  /** Migration sources this provider can import from, when it can. 可从中迁移数据的旧 provider 标识。 */
  readonly migrations?: readonly string[]
  /** Display label used by the capability catalog. 能力目录使用的显示名。 */
  readonly label: string
}

/** A provider as projected into the capability catalog. 投影到能力目录中的 provider。 */
export interface ProviderDescriptor {
  /** Provider id from the manifest. manifest 中的 provider id。 */
  readonly id: string
  /** Capability the provider implements. provider 实现的能力。 */
  readonly capability: CapabilityName
  /** Contract range implemented. 实现的契约范围。 */
  readonly contract: string
  /** Selection priority. 选择优先级。 */
  readonly priority: number
  /** Owned data domain, when declared. 声明的数据域（如有）。 */
  readonly dataDomain?: string
}

/** One capability's state in the catalog. 目录中单个能力的状态。 */
export interface CapabilityState {
  /** Capability name. 能力名。 */
  readonly capability: CapabilityName
  /** Whether the platform refuses to boot without it. 缺失时平台是否拒绝启动。 */
  readonly essential: boolean
  /** Currently serving provider, or `null` when absent. 当前提供服务的 provider；缺失为 `null`。 */
  readonly active: ProviderDescriptor | null
  /** Every registered compatible provider, highest priority first. 全部已注册的兼容 provider，按优先级降序。 */
  readonly providers: readonly ProviderDescriptor[]
  /** Latest health verdict for the active provider. 当前 provider 的最新健康结论。 */
  readonly health: HealthReport
}

/** Per-capability availability flags returned by `/bootstrap`. `/bootstrap` 返回的逐能力可用标志。 */
export type CapabilityFeatures = Readonly<Record<CapabilityName, boolean>>

/** The catalog served by `/api/admin/v1/capabilities`. `/api/admin/v1/capabilities` 提供的能力目录。 */
export interface CapabilityCatalog {
  /** Contract version the kernel enforces. 内核执行的契约版本。 */
  readonly contractVersion: string
  /** One entry per capability, in {@link CapabilityName} order. 每个能力一项，按 {@link CapabilityName} 顺序。 */
  readonly capabilities: readonly CapabilityState[]
  /** Availability flags derived from the catalog. 由目录推导出的可用性标志。 */
  readonly features: CapabilityFeatures
}

export { AdminError, isAdminError, toAdminError } from './errors.ts'
export type { AdminErrorCode, AdminErrorDetails } from './errors.ts'
export {
  ADMIN_CSRF_COOKIE,
  ADMIN_CSRF_HEADER,
  ADMIN_SESSION_COOKIE,
} from './api.ts'
export type {
  AdminDatabase,
  AdminEntity,
  AdminRepository,
  AdminTable,
  AdminUnitOfWork,
  DataFeatures,
} from './data.ts'
export type {
  AdminHttpMethod,
  AdminRequest,
  AdminResponse,
  AdminRoute,
  AdminRouteContext,
  AdminSchema,
  ApiAudience,
  ApiErrorBody,
  ApiListBody,
  CookieOptions,
} from './api.ts'
export type {
  AdminAccess,
  AdminAudit,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminAuditResult,
  AdminAuth,
  AdminDocs,
  AdminIdentity,
  AdminLoginInput,
  AdminLoginResult,
  AdminNavigation,
  AdminNavContribution,
  AdminNavNode,
  AdminRoleView,
  AdminSessionView,
  AdminSetupInput,
  AdminSettings,
  AdminTokenView,
  AdminUserView,
  AuthenticatedPrincipal,
} from './capabilities.ts'
