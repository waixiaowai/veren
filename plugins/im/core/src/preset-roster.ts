/**
 * Discover the deployment's DSH presets as IM agents.
 *
 * A DSH preset *is* an agent (`agent:<presetId>`), so the roster should list
 * every preset the workspace declares, not only the ones a config repeated by
 * hand. The registry arrives through the loader and may mount after this
 * plugin, so discovery runs through `ctx.inject` and keeps a live cache the
 * roster reads on every lookup.
 *
 * 把部署里的 DSH preset 发现为 IM 智能体。
 *
 * 一个 DSH preset 就是一个智能体（`agent:<presetId>`），名册应当列出工作区声明的全部
 * preset，而不只是配置里手抄的那几个。注册表经 loader 到达，可能比本插件更晚挂载，
 * 因此发现走 `ctx.inject`，并维护一份名册每次查询都会读的活缓存。
 *
 * @module @veren/im/preset-roster
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImRosterEntry } from './participants.ts'

/** A live list of discovered presets, plus the reload that refreshes it. */
export interface PresetDiscovery {
  /** Current rows; read synchronously by the roster. */
  readonly rows: () => readonly ImRosterEntry[]
  /** Ask the registry again (new presets appear without a restart). */
  readonly reload: () => Promise<void>
}

/**
 * Wire preset discovery once the registry exists.
 * @param ctx - host context.
 * @returns the live discovery handle.
 */
export function discoverPresets(ctx: Context): PresetDiscovery {
  let rows: ImRosterEntry[] = []
  const load = async (registry: { list(): Promise<readonly PresetRow[]> }): Promise<void> => {
    try {
      rows = (await registry.list()).map(row => ({
        presetId: row.id,
        ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.description === undefined ? {} : { description: row.description }),
      }))
    } catch {
      rows = []
    }
  }
  ctx.inject(['agentPresets'], child => {
    const registry = child.agentPresets
    void load(registry)
  })
  return {
    rows: () => rows,
    reload: async () => {
      const registry = ctx.get('agentPresets')
      if (registry !== undefined) await load(registry)
    },
  }
}

/** The subset of a preset row the roster needs. */
interface PresetRow {
  readonly id: string
  readonly name?: string
  readonly description?: string
}
