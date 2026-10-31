/**
 * The unified API gateway: registration, authentication, authorization,
 * validation, rate limiting, auditing, error mapping and OpenAPI.
 *
 * One gateway owns the order of these steps so a new endpoint cannot skip CSRF,
 * a permission check, or an audit row. Providers register routes and handlers;
 * they never touch a request directly. The steps live in their own modules —
 * configuration, rate limiting, cross-site protection, access control,
 * validation and the audit writers — and this class only sequences them.
 *
 * 统一 API 网关：注册、认证、授权、校验、限流、审计、错误映射与 OpenAPI。一个网关
 * 独占这些步骤的顺序，因此新端点不可能绕过 CSRF、权限校验或审计行。provider 只注册
 * 路由与 handler，绝不直接触碰请求。各步骤归各自的模块——配置、限流、跨站防护、
 * 访问控制、校验与审计写入器——本类只负责编排。
 *
 * @module @veren/admin-api-kernel
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  AdminError,
  toAdminError,
  type AdminRequest,
  type AdminRoute,
  type AdminRouteContext,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import { resolveConfig, Config, type ResolvedConfig } from './config.ts'
import { assertCsrf, assertTrustedOrigin, corsHeaders } from './cross-site.ts'
import { readJsonBody, requestFacts, ResponseCollector, sendEmpty, sendJson, type RequestFacts } from './http.ts'
import { assertPermission, assertScopes, principalOf, resolveCaller } from './access-control.ts'
import { auditFailure, auditRequest } from './audit-writer.ts'
import { FixedWindowLimiter } from './limiter.ts'
import { buildOpenApi } from './openapi.ts'
import { RouteTable, type RouteMatch } from './router.ts'
import { validate } from './validation.ts'

export { resolveConfig, Config } from './config.ts'
export type { ResolvedConfig } from './config.ts'

/** Methods that may change state and therefore need CSRF and audit. 可能改变状态、因此需要 CSRF 与审计的方法。 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Mutable facts of one request, threaded through the pipeline so the failure
 * path can audit what the success path had resolved.
 *
 * 单请求的可变事实，贯穿管线，使失败路径能审计成功路径已解析的内容。
 */
interface RequestScope {
  /** Correlation id minted at entry. 入口生成的关联 id。 */
  readonly requestId: string
  /** Immutable request facts. 不可变的请求事实。 */
  readonly facts: RequestFacts
  /** Matched route, set by {@link AdminApi.admit}. 匹配到的路由，由 {@link AdminApi.admit} 写入。 */
  route?: AdminRoute
  /** Resolved principal, set by {@link AdminApi.admit}. 已解析主体，由 {@link AdminApi.admit} 写入。 */
  principal?: AuthenticatedPrincipal | undefined
  /** Parsed unsafe-method body, set by {@link AdminApi.admit}. 已解析的非安全方法请求体。 */
  body?: unknown | undefined
}

/**
 * The API gateway service (`ctx.adminApi`).
 *
 * 网关服务（`ctx.adminApi`）。
 */
export class AdminApi extends Service {
  /** Route table. 路由表。 */
  private readonly table = new RouteTable()

  /** Fixed-window limiter over caller and route. 按调用方与路由的固定窗口限流器。 */
  private readonly limiter: FixedWindowLimiter

  /** Resolved configuration. 解析后的配置。 */
  readonly config: ResolvedConfig

  /** Path parameters of the last match, read while building the request. 最近一次匹配的路径参数。 */
  private lastParams: Readonly<Record<string, string>> = {}

  /**
   * @param ctx - owning context 所属上下文
   * @param config - validated config 已校验配置
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'adminApi')
    this.config = resolveConfig(config)
    this.limiter = new FixedWindowLimiter(this.config.rateLimit)
  }

  /**
   * Register one route.
   *
   * @param route - the route contract 路由契约
   * @returns the disposer removing it 移除它的 disposer
   */
  register(route: AdminRoute): () => void {
    return this.table.add(route)
  }

  /**
   * Every registered route.
   * @returns the route contracts 路由契约
   */
  routes(): readonly AdminRoute[] {
    return this.table.list()
  }

  /**
   * The generated OpenAPI document.
   * @returns an OpenAPI 3.1 document OpenAPI 3.1 文档
   */
  openapi(): Record<string, unknown> {
    return buildOpenApi(this.table.list(), this.config.publicUrl || undefined)
  }

  /**
   * Handle one HTTP request mounted at {@link Config.mountPath}.
   *
   * @param req - incoming request 传入请求
   * @param res - server response 服务端响应
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const scope: RequestScope = { requestId: randomUUID(), facts: requestFacts(req) }
    const collector = new ResponseCollector()
    try {
      if (!scope.facts.pathname.startsWith(this.config.mountPath)) {
        throw new AdminError('NOT_FOUND', `no API route for ${scope.facts.pathname}`)
      }
      assertTrustedOrigin(this.config, scope.facts)
      if (req.method === 'OPTIONS') {
        sendEmpty(res, 204, corsHeaders(this.config, scope.facts))
        return
      }
      const payload = await this.dispatch(req, scope, collector)
      collector.applyTo(res)
      sendJson(res, 200, payload ?? {}, corsHeaders(this.config, scope.facts))
    } catch (error) {
      await this.reject(res, error, scope, collector)
    }
  }

  /**
   * Match a request, mapping the failure modes onto platform errors.
   *
   * @param facts - request facts 请求事实
   * @param method - request method 请求方法
   * @returns the matched route 匹配到的路由
   */
  private match(facts: RequestFacts, method: string): AdminRoute {
    const matched: RouteMatch | 'method-not-allowed' | undefined = this.table.match(facts.pathname, method)
    if (matched === 'method-not-allowed') {
      throw new AdminError('METHOD_NOT_ALLOWED', `${method} is not allowed on ${facts.pathname}`, { path: facts.pathname })
    }
    if (matched === undefined) throw new AdminError('NOT_FOUND', `no API route for ${facts.pathname}`, { path: facts.pathname })
    this.lastParams = matched.params
    return matched.route
  }

  /**
   * Admit one request: match, rate-limit, authenticate, authorize and validate.
   * Everything resolved here is written into the scope for the audit trail.
   *
   * 受理一个请求：匹配、限流、认证、授权与校验。此处解析出的所有内容都写入 scope，
 * 供审计轨迹使用。
   *
   * @param req - incoming request 传入请求
   * @param scope - the request scope 请求作用域
   */
  private async admit(req: IncomingMessage, scope: RequestScope): Promise<void> {
    const { facts } = scope
    const route = (scope.route = this.match(facts, req.method ?? 'GET'))
    this.limiter.consume(facts, route)
    const unsafe = UNSAFE_METHODS.has(route.method)
    scope.body = unsafe ? await readJsonBody(req, this.config.maxBodyBytes) : undefined
    const identity = await resolveCaller(this.ctx, route, facts)
    if (route.audience !== 'public' && identity === undefined) {
      throw new AdminError('AUTH_REQUIRED', 'authentication is required for this endpoint')
    }
    if (unsafe && route.audience !== 'public') assertCsrf(facts)
    scope.principal = identity === undefined ? undefined : await principalOf(this.ctx, identity)
    if (route.permission !== undefined) assertPermission(this.ctx, route, scope.principal)
    if (route.scopes !== undefined && route.scopes.length > 0) assertScopes(route, scope.principal)
    // Repeated query keys collapse to the last value; routes that need a
    // repeated key must read `request.query` themselves.
    // 重复查询键折叠为最后一个值；需要重复键的路由须自行读取 `request.query`。
    validate(route.query, Object.fromEntries(facts.query), 'query')
  }

  /**
   * Build the handler request, run the handler with audit intent and success
   * around it, and return the payload.
   *
   * 组装 handler 请求，在其前后写入审计 intent 与 success，并返回载荷。
   *
   * @param scope - the request scope 请求作用域
   * @param collector - response collector 响应收集器
   * @returns the handler payload handler 载荷
   */
  private async execute(scope: RequestScope, collector: ResponseCollector): Promise<unknown> {
    const route = scope.route as AdminRoute
    const request: AdminRequest = {
      requestId: scope.requestId,
      method: route.method,
      path: route.path,
      params: this.lastParams ?? {},
      query: scope.facts.query,
      headers: scope.facts.headers,
      body: validate(route.input, scope.body, 'body'),
      principal: scope.principal,
      audience: route.audience,
      ip: scope.facts.ip,
      cookie: (name) => scope.facts.cookies[name],
      header: (name) => scope.facts.headers[name.toLowerCase()],
    }
    await auditRequest(this.ctx, route, request, 'intent')
    const payload = await route.handler({ request, response: collector } satisfies AdminRouteContext)
    await auditRequest(this.ctx, route, request, 'success')
    return payload
  }

  /**
   * Run the admitted pipeline: admission first, then execution.
   *
   * 运行受理后的管线：先受理，后执行。
   *
   * @param req - incoming request 传入请求
   * @param scope - the request scope 请求作用域
   * @param collector - response collector 响应收集器
   * @returns the handler payload handler 载荷
   */
  private async dispatch(req: IncomingMessage, scope: RequestScope, collector: ResponseCollector): Promise<unknown> {
    await this.admit(req, scope)
    return this.execute(scope, collector)
  }

  /**
   * Map one failure onto the error envelope, with the failure audit row.
   *
   * 把一次失败映射为错误信封，并写入失败审计行。
   *
   * @param res - server response 服务端响应
   * @param error - the caught error 捕获的错误
   * @param scope - the request scope 请求作用域
   * @param collector - response collector 响应收集器
   */
  private async reject(
    res: ServerResponse,
    error: unknown,
    scope: RequestScope,
    collector: ResponseCollector,
  ): Promise<void> {
    const failure = toAdminError(error)
    failure.requestId = scope.requestId
    await auditFailure(this.ctx, scope.route, scope.principal, scope.facts, failure.code === 'FORBIDDEN' ? 'denied' : 'failure')
    collector.applyTo(res)
    sendJson(res, failure.status, {
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details === undefined ? {} : { details: failure.details }),
        requestId: scope.requestId,
      },
    }, corsHeaders(this.config, scope.facts))
  }
}
