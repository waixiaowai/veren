/**
 * Audit writers of the API gateway.
 *
 * Both writers are best effort: a full audit store must never turn a completed
 * or failed request into an error the caller would retry. The gateway owns the
 * `intent`/`success`/`failure`/`denied` vocabulary and the fallback action name.
 *
 * API 网关的审计写入器。两个写入器都尽力而为：审计存储写满也绝不能把已完成或已失败
 * 的请求变成调用方会重试的错误。网关独占 `intent`/`success`/`failure`/`denied` 词汇
 * 与兜底动作名。
 *
 * @module @veren/admin-api-kernel/audit-writer
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type AdminAudit,
  type AdminRequest,
  type AdminRoute,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import type { RequestFacts } from './http.ts'
import { routePath } from './router.ts'

/**
 * Append one audit row for a resolved request.
 *
 * @param ctx - owning context 所属上下文
 * @param route - matched route 匹配路由
 * @param request - the request being handled 正在处理的请求
 * @param result - outcome to record 要记录的结果
 */
export async function auditRequest(
  ctx: Context,
  route: AdminRoute,
  request: AdminRequest,
  result: 'intent' | 'success',
): Promise<void> {
  if (route.audit !== true || !ctx.admin.has('audit')) return
  const audit = ctx.admin.require<AdminAudit>('audit')
  try {
    await audit.record({
      actorId: request.principal?.userId ?? null,
      actorLabel: request.principal?.email ?? 'anonymous',
      action: route.action ?? `${route.audience}.${route.method.toLowerCase()} ${route.path}`,
      result,
      target: routePath(route.audience, route.path),
      requestId: request.requestId,
      ip: request.ip,
    })
  } catch {
    // Auditing is best effort on the success path: a full audit store must not
    // turn a completed write into an error the caller would retry.
    // 成功路径上审计尽力而为：审计存储写满不应把已完成的写操作变成调用方会重试的错误。
  }
}

/**
 * Append one audit row for a failed request, if the route opted in.
 *
 * @param ctx - owning context 所属上下文
 * @param route - matched route, when matching succeeded 匹配到的路由
 * @param principal - resolved principal, when known 已解析主体
 * @param facts - request facts 请求事实
 * @param result - outcome to record 要记录的结果
 */
export async function auditFailure(
  ctx: Context,
  route: AdminRoute | undefined,
  principal: AuthenticatedPrincipal | undefined,
  facts: RequestFacts,
  result: 'failure' | 'denied',
): Promise<void> {
  if (route?.audit !== true || !ctx.admin.has('audit')) return
  const audit = ctx.admin.require<AdminAudit>('audit')
  try {
    await audit.record({
      actorId: principal?.userId ?? null,
      actorLabel: principal?.email ?? 'anonymous',
      action: route.action ?? `${route.audience}.${route.method.toLowerCase()} ${route.path}`,
      result,
      target: routePath(route.audience, route.path),
      ip: facts.ip,
    })
  } catch {
    // Same best-effort policy as the success path. 与成功路径同样的尽力而为策略。
  }
}
