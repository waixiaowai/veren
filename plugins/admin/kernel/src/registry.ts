/**
 * The capability registry: provider registration, version negotiation and
 * deterministic active-provider selection.
 *
 * The registry is the only place that decides which implementation serves a
 * capability. It never imports a provider: providers hand it a manifest and an
 * implementation, and unloading the provider removes both.
 *
 * 能力注册表：provider 注册、版本协商与确定性的激活选择。注册表是唯一决定“哪个实现
 * 服务哪个能力”的地方。它从不 import 任何 provider：provider 交出清单与实现，卸载时
 * 两者一并移除。
 *
 * @module @veren/admin-kernel/registry
 */

import {
  ADMIN_CONTRACT_VERSION,
  AdminError,
  type CapabilityName,
  type CapabilityState,
  type HealthReport,
  type ProviderDescriptor,
  type ProviderManifest,
} from '@veren/admin-contract'
import { satisfies } from './range.ts'

/** One registered provider. 一个已注册的 provider。 */
interface Registration {
  /** Provider declaration. provider 声明。 */
  readonly manifest: ProviderManifest
  /** The capability implementation object. 能力实现对象。 */
  readonly implementation: object
  /** Monotonic registration order, used to break selection ties deterministically. 单调注册序号，用于确定性打破选择歧义。 */
  readonly sequence: number
}

/** Project a registration into its catalog descriptor. 把注册项投影为目录描述符。 */
function describe(registration: Registration): ProviderDescriptor {
  const { manifest } = registration
  return {
    id: manifest.id,
    capability: manifest.capability,
    contract: manifest.contract,
    priority: manifest.priority,
    ...(manifest.dataDomain === undefined ? {} : { dataDomain: manifest.dataDomain }),
  }
}

/**
 * Choose the active registration: highest priority wins, ties resolve to the
 * most recent registration so a hot-swapped provider takes effect immediately.
 *
 * 选择激活注册项：优先级最高者胜出；同优先级时取最近注册者，使热替换立即生效。
 */
function pick(registrations: readonly Registration[]): Registration | undefined {
  let winner: Registration | undefined
  for (const candidate of registrations) {
    if (winner === undefined) {
      winner = candidate
      continue
    }
    if (candidate.manifest.priority > winner.manifest.priority) winner = candidate
    else if (candidate.manifest.priority === winner.manifest.priority && candidate.sequence > winner.sequence) winner = candidate
  }
  return winner
}

/**
 * Snapshot published once every essential capability has an active provider.
 *
 * 全部必需能力都有激活 provider 后发布的快照。
 */
export interface AdminReadiness {
  /** Contract version the kernel negotiated at boot. 内核启动时协商的契约版本。 */
  readonly contractVersion: string
  /** Essential capabilities, all active at publication time. 发布时全部激活的必需能力。 */
  readonly essentials: readonly CapabilityName[]
}

/**
 * Build the readiness snapshot, or `undefined` while any required capability
 * still lacks a provider.
 *
 * 构建就绪快照；仍有必需能力缺少 provider 时返回 `undefined`。
 *
 * @param essential - capability names that must be served 必须被服务的能力名
 * @param has - active-provider predicate 激活 provider 判定
 * @returns the readiness value, or `undefined` when a provider is missing 就绪值；缺 provider 时为 `undefined`
 */
export function readinessOf(
  essential: readonly CapabilityName[],
  has: (capability: CapabilityName) => boolean,
): AdminReadiness | undefined {
  if (essential.some((capability) => !has(capability))) return undefined
  return { contractVersion: ADMIN_CONTRACT_VERSION, essentials: [...essential] }
}

/** The registry itself; one instance per kernel. 注册表本体；每个内核一个实例。 */
export class CapabilityRegistry {
  /** Registrations per capability, in registration order. 逐能力的注册项，按注册顺序。 */
  private readonly registrations = new Map<CapabilityName, Registration[]>()

  /** Next registration sequence number. 下一个注册序号。 */
  private sequence = 0

  /** Contract version every provider is negotiated against. 用于协商的契约版本。 */
  readonly contractVersion: string

  /**
   * @param contractVersion - contract version to negotiate against 用于协商的契约版本
   */
  constructor(contractVersion: string = ADMIN_CONTRACT_VERSION) {
    this.contractVersion = contractVersion
  }

  /**
   * Register one provider.
   *
   * @param manifest - provider declaration provider 声明
   * @param implementation - the capability implementation 能力实现
   * @returns the disposer removing this exact registration 移除该注册项的 disposer
   * @throws AdminError `PROVIDER_CONFLICT` on a duplicate id or priority, and
   *   `CONTRACT_INCOMPATIBLE` when the declared range excludes this contract
   */
  register(manifest: ProviderManifest, implementation: object): () => void {
    if (!satisfies(this.contractVersion, manifest.contract)) {
      throw new AdminError(
        'CONTRACT_INCOMPATIBLE',
        `provider '${manifest.id}' implements contract ${manifest.contract}, which excludes ${this.contractVersion}`,
        { provider: manifest.id, contract: manifest.contract, contractVersion: this.contractVersion },
      )
    }
    const current = this.registrations.get(manifest.capability) ?? []
    if (current.some((entry) => entry.manifest.id === manifest.id)) {
      throw new AdminError('PROVIDER_CONFLICT', `provider id '${manifest.id}' is already registered for '${manifest.capability}'`, {
        provider: manifest.id,
        capability: manifest.capability,
      })
    }
    if (current.some((entry) => entry.manifest.priority === manifest.priority)) {
      throw new AdminError(
        'PROVIDER_CONFLICT',
        `provider '${manifest.id}' reuses priority ${manifest.priority} of '${manifest.capability}'`,
        { provider: manifest.id, capability: manifest.capability, priority: manifest.priority },
      )
    }

    let registered: Registration | undefined
    const dispose = (): void => {
      const entries = this.registrations.get(manifest.capability)
      if (entries === undefined || registered === undefined) return
      const index = entries.indexOf(registered)
      if (index >= 0) entries.splice(index, 1)
      if (entries.length === 0) this.registrations.delete(manifest.capability)
      registered = undefined
    }

    // The registration is visible only after the checks above passed, so a
    // thrown conflict never leaves a half-registered provider behind.
    // 只有上面的检查全部通过后才让注册可见，因此冲突异常不会留下半注册状态。
    registered = { manifest, implementation, sequence: this.sequence++ }
    this.registrations.set(manifest.capability, [...current, registered])
    return dispose
  }

  /**
   * Read the active implementation of one capability.
   *
   * @param capability - capability name 能力名
   * @returns the active implementation, or `undefined` when absent 激活实现；缺失为 `undefined`
   */
  active(capability: CapabilityName): object | undefined {
    return pick(this.registrations.get(capability) ?? [])?.implementation
  }

  /**
   * Read the active provider descriptor of one capability.
   *
   * @param capability - capability name 能力名
   * @returns the descriptor, or `null` when absent 描述符；缺失为 `null`
   */
  activeDescriptor(capability: CapabilityName): ProviderDescriptor | null {
    const winner = pick(this.registrations.get(capability) ?? [])
    return winner === undefined ? null : describe(winner)
  }

  /**
   * Every registration of one capability, highest priority first.
   *
   * @param capability - capability name 能力名
   * @returns the descriptors 描述符列表
   */
  providers(capability: CapabilityName): readonly ProviderDescriptor[] {
    return [...(this.registrations.get(capability) ?? [])]
      .sort((a, b) => b.manifest.priority - a.manifest.priority)
      .map(describe)
  }

  /**
   * Build the catalog for the supplied capability order.
   *
   * @param capabilities - capability order to publish 要发布的顺序
   * @param essential - which capabilities are essential 哪些能力是必需的
   * @param health - health probe results keyed by capability 按能力索引的健康探测结果
   * @returns the catalog states 目录状态
   */
  catalog(
    capabilities: readonly CapabilityName[],
    essential: readonly CapabilityName[],
    health: ReadonlyMap<CapabilityName, HealthReport>,
  ): readonly CapabilityState[] {
    return capabilities.map((capability) => ({
      capability,
      essential: essential.includes(capability),
      active: this.activeDescriptor(capability),
      providers: this.providers(capability),
      health: health.get(capability) ?? { status: this.active(capability) === undefined ? 'degraded' : 'ok' },
    }))
  }
}

/**
 * Probe one implementation's optional `health` hook.
 *
 * @param capability - capability name used in the detail text 细节文本中使用的名称
 * @param implementation - the implementation to probe 要探测的实现
 * @returns the verdict, defaulting to `ok` when the hook is absent 结论；无钩子时默认 `ok`
 */
export async function probeHealth(capability: CapabilityName, implementation: object): Promise<HealthReport> {
  const hook = (implementation as { health?: () => Promise<HealthReport> }).health
  if (typeof hook !== 'function') return { status: 'ok' }
  try {
    return await hook.call(implementation)
  } catch (error) {
    return { status: 'down', detail: `${capability}: ${error instanceof Error ? error.message : String(error)}` }
  }
}
