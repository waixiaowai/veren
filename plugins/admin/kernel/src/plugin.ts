/**
 * `@veren/admin-kernel` — the provider registry and stable capability façades.
 *
 * The kernel owns three decisions and nothing else: which provider serves a
 * capability, whether the contract version admits it, and whether the platform
 * may serve traffic at all. It imports no provider, so replacing one never
 * touches kernel code. Catalog projection lives in `./catalog.ts`, plugin
 * configuration in `./config.ts`; this module only composes them.
 *
 * `@veren/admin-kernel` — provider 注册表与稳定能力 façade。内核只负责三个决定：哪个
 * provider 服务某个能力、契约版本是否接纳它、平台是否可以对外服务。它不 import 任何
 * provider，因此替换实现永远不需要改内核代码。目录投影在 `./catalog.ts`，插件配置在
 * `./config.ts`；本模块只负责组装。
 *
 * @module @veren/admin-kernel
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  ADMIN_CONTRACT_VERSION,
  AdminError,
  type AdminAccess,
  type AdminAudit,
  type AdminAuth,
  type AdminDatabase,
  type AdminDocs,
  type AdminNavigation,
  type AdminSettings,
  type CapabilityCatalog,
  type CapabilityFeatures,
  type CapabilityName,
  type HealthReport,
  type ProviderManifest,
} from '@veren/admin-contract'
import { createFacade } from './facades.ts'
import { CapabilityRegistry, probeHealth, readinessOf } from './registry.ts'
import { CAPABILITY_ORDER, featuresOf, type AdminHealthSnapshot } from './catalog.ts'
import { resolveEssential, type Config } from './config.ts'

export { CAPABILITY_ORDER } from './catalog.ts'
export type { AdminHealthSnapshot } from './catalog.ts'
export { Config, resolveEssential } from './config.ts'

/** Service name this plugin provides. 本插件提供的服务名。 */
export const name = 'admin'

/**
 * Service published once every essential capability has an active provider.
 *
 * Consumers list it in `inject` to be ordered after the provider rows even when
 * the loader mounts rows concurrently.
 *
 * 全部必需能力都有激活 provider 后发布的服务。消费方在 `inject` 中声明它，即使 loader
 * 并发挂载各行，也会排在 provider 行之后加载。
 */
export const ADMIN_READINESS_SERVICE = 'adminReadiness' as const

/**
 * The kernel service (`ctx.admin`).
 *
 * Providers register through {@link register}; consumers resolve through the
 * per-capability façades this service also mounts. Health and the capability
 * catalog are derived from the registry on demand, so they can never disagree
 * with it.
 *
 * 内核服务（`ctx.admin`）。provider 通过 {@link register} 注册；消费方通过本服务
 * 一并挂载的逐能力 façade 解析。健康与能力目录按需从注册表推导，因此永不与注册表
 * 不一致。
 */
export class AdminKernel extends Service {
  /** The registry backing every decision. 支撑所有决定的注册表。 */
  readonly registry: CapabilityRegistry

  /** Capability names treated as essential by this deployment. 本部署视为必需的能力名。 */
  private readonly essential: readonly CapabilityName[]

  /** Latest health verdict per capability, refreshed by {@link refreshHealth}. 逐能力的最新健康结论，由 {@link refreshHealth} 刷新。 */
  private readonly healthByCapability = new Map<CapabilityName, HealthReport>()

  /** Whether the one-way readiness service has been published. 单向就绪服务是否已发布。 */
  private readinessPublished = false

  /**
   * @param ctx - owning Cordis context 所属 Cordis 上下文
   * @param config - validated kernel config 已校验的内核配置
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'admin')
    this.essential = resolveEssential(config.essential ?? [])
    this.registry = new CapabilityRegistry(ADMIN_CONTRACT_VERSION)
    this.mountFacades()
    // A deployment whose essential set is already empty is ready immediately.
    // 必需集合本就为空的部署立即就绪。
    this.publishReadiness()
  }

  /**
   * Register one provider implementation.
   *
   * Publishes `adminReadiness` as soon as this registration completes the
   * essential set, so waiting consumers activate after this call returns.
   *
   * 注册一个 provider 实现。一旦本次注册补全必需集合就发布 `adminReadiness`，因此等待中
   * 的消费方会在本调用返回后激活。
   *
   * @param manifest - provider declaration provider 声明
   * @param implementation - the capability implementation 能力实现
   * @returns the disposer removing this registration 移除该注册项的 disposer
   */
  register(manifest: ProviderManifest, implementation: object): () => void {
    const dispose = this.registry.register(manifest, implementation)
    this.publishReadiness()
    return dispose
  }

  /**
   * Resolve the active implementation, failing loudly when absent.
   *
   * @param capability - capability name 能力名
   * @returns the active implementation 激活实现
   * @throws AdminError `CAPABILITY_UNAVAILABLE` when nothing serves it 无实现时抛出
   */
  require<T extends object>(capability: CapabilityName): T {
    const implementation = this.registry.active(capability) as T | undefined
    if (implementation === undefined) {
      throw new AdminError('CAPABILITY_UNAVAILABLE', `capability '${capability}' has no active provider`, {
        capability,
        registered: this.registry.providers(capability).map((provider) => provider.id),
      })
    }
    return implementation
  }

  /**
   * Whether one capability currently has a provider.
   *
   * @param capability - capability name 能力名
   * @returns true when a provider serves it 有 provider 时为 true
   */
  has(capability: CapabilityName): boolean {
    return this.registry.active(capability) !== undefined
  }

  /**
   * The capability catalog, using the latest cached health verdicts.
   *
   * @returns the catalog 能力目录
   */
  catalog(): CapabilityCatalog {
    const states = this.registry.catalog(CAPABILITY_ORDER, this.essential, this.healthByCapability)
    return {
      contractVersion: ADMIN_CONTRACT_VERSION,
      capabilities: states,
      features: featuresOf(states),
    }
  }

  /**
   * Availability flags derived from the catalog. 由目录推导的可用性标志。
   *
   * @returns one boolean per capability 每个能力一个布尔值
   */
  features(): CapabilityFeatures {
    return featuresOf(this.registry.catalog(CAPABILITY_ORDER, this.essential, this.healthByCapability))
  }

  /**
   * Probe every capability and the data backend, then update the cache.
   *
   * @returns the fresh snapshot 最新快照
   */
  async refreshHealth(): Promise<AdminHealthSnapshot> {
    for (const capability of CAPABILITY_ORDER) {
      const implementation = this.registry.active(capability)
      this.healthByCapability.set(
        capability,
        implementation === undefined
          ? { status: 'degraded', detail: 'no active provider' }
          : await probeHealth(capability, implementation),
      )
    }
    const backends: { name: string; health: HealthReport }[] = []
    if (this.has('data')) {
      const database = this.require<AdminDatabase>('data')
      backends.push({ name: 'data', health: await database.health() })
    }
    return {
      contractVersion: ADMIN_CONTRACT_VERSION,
      capabilities: this.registry.catalog(CAPABILITY_ORDER, this.essential, this.healthByCapability),
      backends,
    }
  }

  /**
   * Enforce the boot gate: every essential capability must have an active
   * provider. Called once by the runtime row after all providers registered.
   *
   * @throws AdminError `ESSENTIAL_CAPABILITY_MISSING` listing every gap 列出全部缺口的错误
   */
  ready(): void {
    const missing = this.missingEssential()
    if (missing.length === 0) return
    throw new AdminError(
      'ESSENTIAL_CAPABILITY_MISSING',
      `essential capabilities have no provider: ${missing.join(', ')}`,
      {
        missing,
        registered: CAPABILITY_ORDER.filter((capability) => this.has(capability)),
      },
    )
  }

  /**
   * Publish the one-way readiness service once every essential capability has
   * an active provider. Consumers that inject it stay pending until then,
   * which is what makes startup ordering independent of loader concurrency.
   *
   * 一旦所有必需能力都有激活 provider 就发布单向就绪服务。注入它的消费方在此前保持
   * pending，因此启动顺序与 loader 的并发无关。
   */
  private publishReadiness(): void {
    if (this.readinessPublished) return
    const readiness = readinessOf(this.essential, (capability) => this.has(capability))
    if (readiness === undefined) return
    this.ctx.effect(() => this.ctx.provide(ADMIN_READINESS_SERVICE, readiness), 'admin-kernel: readiness')
    this.readinessPublished = true
  }

  /**
   * Essential capabilities without an active provider. 缺少激活 provider 的必需能力。
   *
   * @returns the missing names, in essential order 按必需顺序排列的缺失名称
   */
  private missingEssential(): CapabilityName[] {
    return this.essential.filter((capability) => !this.has(capability))
  }

  /**
   * Mount one stable façade per capability. Each proxy resolves the active
   * implementation at call time, which is what makes provider replacement
   * invisible to consumers.
   *
   * 为每个能力挂载一个稳定 façade。每个代理在调用时解析激活实现，这正是 provider 替换
   * 对消费方不可见的原因。
   */
  private mountFacades(): void {
    const mount = <T extends object>(serviceName: string, capability: CapabilityName): void => {
      const facade = createFacade<T>(this, capability)
      this.ctx.effect(() => this.ctx.provide(serviceName, facade), `${serviceName}-facade`)
    }
    mount<AdminDatabase>('adminData', 'data')
    mount<AdminAuth>('adminAuth', 'auth')
    mount<AdminAccess>('adminAccess', 'access')
    mount<AdminNavigation>('adminNavigation', 'navigation')
    mount<AdminAudit>('adminAudit', 'audit')
    mount<AdminSettings>('adminSettings', 'settings')
    mount<AdminDocs>('adminDocs', 'docs')
  }
}

/**
 * Plugin entry: install the kernel service and its façades.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  new AdminKernel(ctx, config)
}
