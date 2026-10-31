/**
 * The `docs` capability: the generated API and capability documentation.
 *
 * `docs` 能力：生成的 API 与能力文档。
 *
 * @module @veren/admin-contract/docs
 */

import type { CapabilityCatalog, HealthReport } from './index.ts'

/** The `docs` capability: generated API and capability documentation. `docs` 能力：生成的 API 与能力文档。 */
export interface AdminDocs {
  /**
   * The live capability catalog.
   * @returns the catalog served to clients 提供给客户端的能力目录
   */
  catalog(): Promise<CapabilityCatalog>

  /**
   * The generated OpenAPI document.
   * @returns an OpenAPI 3.1 document OpenAPI 3.1 文档
   */
  openapi(): Promise<Record<string, unknown>>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
