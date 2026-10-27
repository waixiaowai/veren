/**
 * Durable state of the hub-device plugin: the poll cursor. One tiny domain —
 * losing it would replay the hub's whole history into the router, so the
 * cursor persists after every batch, not on shutdown.
 *
 * hub 设备插件的持久化状态：轮询游标。丢它会把 hub 的全部历史重放进路由器，
 * 因此游标在每批之后持久化，而不是停机时。
 *
 * @module @veren/im-hub/store
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'

/** One device's poll cursor row. */
export interface HubCursorRow {
  device: string
  after: number
}

const cursorSchema = z.object({ device: z.string().min(1), after: z.number() })

/** The plugin's storage domain: one table, one row per device. */
export const hubDomain = defineDomain({
  name: 'im_hub',
  version: 1,
  tables: {
    cursor: domainTable<string, HubCursorRow>(cursorSchema),
  },
})

/** The cursor seam the poll loop programs against. */
export interface HubCursorStore {
  after(device: string): number
  save(device: string, after: number): Promise<void>
}

/** Domain-backed cursor store. */
export class DomainHubCursorStore implements HubCursorStore {
  private domain: Domain<typeof hubDomain> | undefined

  constructor(private readonly ctx: Context) {}

  async open(): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(hubDomain)
  }

  async close(): Promise<void> {
    const domain = this.domain
    this.domain = undefined
    await domain?.close()
  }

  after(device: string): number {
    return this.table().get(device)?.after ?? 0
  }

  async save(device: string, after: number): Promise<void> {
    await this.table().put(device, { device, after })
  }

  private table() {
    const domain = this.domain
    if (domain === undefined) throw new Error('im_hub storage domain is not open')
    return domain.table('cursor')
  }
}
