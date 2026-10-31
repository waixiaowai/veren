/**
 * Configuration of the admin kernel.
 *
 * The only knob is the essential set: a deployment may declare additional
 * capability names that must resolve before traffic is served. Unknown names
 * fail at load so a typo cannot silently weaken the boot gate.
 *
 * 内核配置。唯一旋钮是必需集合：部署可声明额外的能力名，要求其解析完成后才能对外
 * 服务。未知名称在加载时失败，因此拼写错误无法静默削弱启动门禁。
 *
 * @module @veren/admin-kernel/config
 */

import { ESSENTIAL_CAPABILITIES, type CapabilityName } from '@veren/admin-contract'
import z from '@deepseek-ai/schemastery'
import { CAPABILITY_ORDER } from './catalog.ts'

/** Kernel configuration. 内核配置。 */
export interface Config {
  /**
   * Additional capability names this deployment treats as essential. An unknown
   * name fails at load, so a typo cannot silently weaken the boot gate.
   *
   * 本部署额外视为必需的能力名。未知名称在加载时失败，因此拼写错误不会静默削弱启动
   * 门禁。
   */
  essential?: string[]
}

export const Config: z<Config> = z.object({
  essential: z.array(z.string()).default([]),
})

/**
 * Validate configured essential capability names and merge them with the
 * contract's own essential set.
 *
 * @param configured - names from plugin config 插件配置中的名称
 * @returns the effective essential set, contract essentials first 生效的必需集合，契约必需项在前
 * @throws Error naming the unknown capability 命名未知能力的错误
 */
export function resolveEssential(configured: readonly string[]): readonly CapabilityName[] {
  const unknown = configured.filter((entry) => !(CAPABILITY_ORDER as readonly string[]).includes(entry))
  if (unknown.length > 0) {
    throw new Error(
      `admin-kernel: config.essential names unknown capabilities: ${unknown.join(', ')}`
      + ` (known: ${CAPABILITY_ORDER.join(', ')})`,
    )
  }
  return [...new Set<CapabilityName>([...ESSENTIAL_CAPABILITIES, ...(configured as CapabilityName[])])]
}
