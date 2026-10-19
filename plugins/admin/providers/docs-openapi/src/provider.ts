/**
 * The documentation capability over the kernel catalog and the API gateway.
 *
 * Nothing here is cached or copied: the catalog is derived after a fresh health
 * probe, and OpenAPI is generated from the live route table. A route that is
 * not registered therefore cannot be documented, and a provider swap is
 * reflected on the next request.
 *
 * 基于内核目录与 API 网关的文档能力。这里不缓存也不复制：目录在重新探测健康后推导，OpenAPI
 * 由实时路由表生成。因此未注册的路由无法出现在文档里，provider 替换也会在下次请求时体现。
 *
 * @module @veren/admin-docs-openapi/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AdminDocs,
  CapabilityCatalog,
  HealthReport,
} from '@veren/admin-contract'
import type { AdminHealthSnapshot } from '@veren/admin-kernel'
import type {} from '@veren/admin-kernel'
import type {} from '@veren/admin-api-kernel'

/** The docs capability implementation. 文档能力的实现。 */
export class OpenApiDocs implements AdminDocs {
  /** Owning context, used to reach the kernel and gateway services. 所属上下文，用于访问内核与网关服务。 */
  private readonly ctx: Context

  /**
   * @param ctx - owning context 所属上下文
   */
  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * Probe every capability, then publish the resulting catalog.
   *
   * @returns the live capability catalog 实时能力目录
   */
  async catalog(): Promise<CapabilityCatalog> {
    await this.refresh()
    return this.ctx.admin.catalog()
  }

  /**
   * Refresh capability and backend health.
   *
   * @returns the fresh platform health snapshot 最新的平台健康快照
   */
  async refresh(): Promise<AdminHealthSnapshot> {
    return this.ctx.admin.refreshHealth()
  }

  /**
   * Generate the OpenAPI 3.1 document from the live route table.
   *
   * @returns an OpenAPI 3.1 document OpenAPI 3.1 文档
   */
  async openapi(): Promise<Record<string, unknown>> {
    return this.ctx.adminApi.openapi()
  }

  /**
   * Probe the gateway the documentation is generated from.
   *
   * @returns `ok`, or `down` with the failure detail 成功为 `ok`，失败为带细节的 `down`
   */
  async health(): Promise<HealthReport> {
    try {
      this.ctx.adminApi.routes()
      return { status: 'ok' }
    } catch (error) {
      return { status: 'down', detail: error instanceof Error ? error.message : String(error) }
    }
  }
}
