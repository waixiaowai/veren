/**
 * Capability catalog order and its projections.
 *
 * The order is the contract's: essentials first, then optionals. Everything
 * derived from the registry — availability flags, health snapshots — keeps that
 * order so catalogs are stable across providers and deployments.
 *
 * 能力目录顺序及其投影。顺序即契约顺序：先必需后可选。从注册表推导的一切——可用性
 * 标志、健康快照——都保持该顺序，因此目录在不同 provider 与部署间保持稳定。
 *
 * @module @veren/admin-kernel/catalog
 */

import {
  ESSENTIAL_CAPABILITIES,
  OPTIONAL_CAPABILITIES,
  type CapabilityFeatures,
  type CapabilityName,
  type CapabilityState,
  type HealthReport,
} from '@veren/admin-contract'

/** Every capability in catalog order: essentials first, then optionals. 目录顺序的全部能力：先必需后可选。 */
export const CAPABILITY_ORDER: readonly CapabilityName[] = [...ESSENTIAL_CAPABILITIES, ...OPTIONAL_CAPABILITIES]

/** One health snapshot of the whole platform. 整个平台的一次健康快照。 */
export interface AdminHealthSnapshot {
  /** Contract version negotiated at boot. 启动时协商的契约版本。 */
  readonly contractVersion: string
  /** Per-capability state with the latest probe verdict. 带最新探测结论的逐能力状态。 */
  readonly capabilities: readonly CapabilityState[]
  /** Backend component health, `data` first. 后端组件健康，`data` 在前。 */
  readonly backends: readonly { readonly name: string; readonly health: HealthReport }[]
}

/**
 * Project catalog states into availability flags.
 *
 * @param states - catalog states 目录状态
 * @returns one boolean per capability 每个能力一个布尔值
 */
export function featuresOf(states: readonly CapabilityState[]): CapabilityFeatures {
  const features = {} as Record<CapabilityName, boolean>
  for (const state of states) features[state.capability] = state.active !== null
  return features
}
