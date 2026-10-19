/**
 * The audit HTTP route and its query schema.
 *
 * The route delegates to the capability so HTTP and in-process callers share
 * one filtering and paging implementation. The declared `query` schema is a
 * structural adapter over schemastery: the gateway's `AdminSchema` port only
 * requires `parse`, which schemastery does not expose by name.
 *
 * 审计 HTTP 路由及其查询 schema。路由委托给能力实现，因此 HTTP 与进程内调用方共用同一套
 * 过滤与分页实现。声明的 `query` schema 是 schemastery 的结构适配器：网关的 `AdminSchema`
 * 端口只要求 `parse`，而 schemastery 并未以此名暴露该方法。
 *
 * @module @veren/admin-audit-default/route
 */

import z from '@deepseek-ai/schemastery'
import {
  ADMIN_PERMISSIONS,
  AdminError,
  type AdminAudit,
  type AdminAuditQuery,
  type AdminRoute,
  type AdminSchema,
} from '@veren/admin-contract'

/** Query keys the route understands, in documentation order. 路由支持的查询键，按文档顺序。 */
const QUERY_KEYS = ['limit', 'cursor', 'actorId', 'action', 'result', 'since', 'until'] as const

/** Wire-level query validation. 线上查询校验。 */
const querySchema = z.object({
  limit: z.natural().description('Page size, default 50, values above 200 are clamped.'),
  cursor: z.string().description('Opaque cursor returned as nextCursor by the previous page.'),
  actorId: z.string().description('Exact acting user id.'),
  action: z.string().description('Action name prefix such as `auth.`.'),
  result: z.union(['intent', 'success', 'failure', 'denied']).description('Recorded outcome.'),
  since: z.string().description('Inclusive lower time bound, ISO-8601 UTC.'),
  until: z.string().description('Inclusive upper time bound, ISO-8601 UTC.'),
})

/**
 * Route query schema, adapted to the gateway's structural schema port.
 *
 * It accepts either a `URLSearchParams` or a plain record, so the gateway may
 * validate before dispatch or the handler may parse after it.
 *
 * 路由查询 schema，适配网关的结构化 schema 端口。它接受 `URLSearchParams` 或普通记录，
 * 因此网关既可在分发前校验，handler 也可在分发后自行解析。
 */
export const auditQuerySchema: AdminSchema<AdminAuditQuery> = {
  parse: parseAuditQueryInput,
}

/**
 * Parse the raw query string into a validated audit query.
 *
 * @param search - request query string 请求查询串
 * @returns the validated query 已校验查询
 */
export function readAuditQuery(search: URLSearchParams): AdminAuditQuery {
  return parseAuditQueryInput(search)
}

/**
 * Build the audit list route.
 *
 * @param audit - the audit capability the handler delegates to handler 委托的审计能力
 * @returns the route contract 路由契约
 */
export function createAuditRoute(audit: AdminAudit): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/audit',
    permission: ADMIN_PERMISSIONS.auditRead,
    summary: 'List audit entries, newest first',
    tags: ['audit'],
    query: auditQuerySchema,
    handler: async ({ request }) => audit.list(readAuditQuery(request.query)),
  }
}

/**
 * Validate one raw query object or query string.
 *
 * `limit` arrives as text on the wire and is normalized to a number before
 * validation, so the schema can state the real numeric contract.
 *
 * 校验一个原始查询对象或查询串。`limit` 在线上是文本，校验前会被归一化为数字，因此 schema
 * 能表达真实的数字契约。
 *
 * @param input - untrusted query input 不可信查询输入
 * @returns the validated query 已校验查询
 * @throws AdminError `VALIDATION_FAILED` when any field is invalid 任一字段非法时抛出
 */
function parseAuditQueryInput(input: unknown): AdminAuditQuery {
  const source = input instanceof URLSearchParams ? valuesOf(input) : plainRecord(input)
  if (source.limit !== undefined) source.limit = Number(source.limit)
  try {
    return querySchema(source) as AdminAuditQuery
  } catch (error) {
    throw new AdminError('VALIDATION_FAILED', 'invalid audit query', { reason: messageOf(error) })
  }
}

/**
 * Extract only the known query keys from a query string.
 *
 * @param search - request query string 请求查询串
 * @returns a plain record of present keys 仅含存在键的普通记录
 */
function valuesOf(search: URLSearchParams): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const key of QUERY_KEYS) {
    const value = search.get(key)
    if (value !== null) values[key] = value
  }
  return values
}

/**
 * Copy an untrusted value into a plain record, rejecting non-objects.
 *
 * @param input - untrusted value 不可信值
 * @returns a shallow copy, or an empty record 浅拷贝或空记录
 */
function plainRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  return { ...(input as Record<string, unknown>) }
}

/**
 * Render an unknown failure as human-readable text.
 *
 * @param error - any thrown value 任意抛出值
 * @returns the message 消息文本
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
