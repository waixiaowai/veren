/**
 * The unified API gateway: registration, authentication, authorization,
 * validation, rate limiting, auditing, error mapping and OpenAPI.
 *
 * One gateway owns the order of these steps so a new endpoint cannot skip CSRF,
 * a permission check, or an audit row. Providers register routes and handlers;
 * they never touch a request directly.
 *
 * 统一 API 网关：注册、认证、授权、校验、限流、审计、错误映射与 OpenAPI。一个网关
 * 独占这些步骤的顺序，因此新端点不可能绕过 CSRF、权限校验或审计行。provider 只注册
 * 路由与 handler，绝不直接触碰请求。
 *
 * @module @veren/admin-api-kernel
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_CSRF_HEADER,
  ADMIN_SESSION_COOKIE,
  AdminError,
  toAdminError,
  type AdminAccess,
  type AdminAudit,
  type AdminAuth,
  type AdminIdentity,
  type AdminRequest,
  type AdminRoute,
  type AdminRouteContext,
  type AdminSchema,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import { readJsonBody, requestFacts, ResponseCollector, sendEmpty, sendJson, type RequestFacts } from './http.ts'
import { buildOpenApi } from './openapi.ts'
import { RouteTable, routePath, type RouteMatch } from './router.ts'

/** Methods that may change state and therefore need CSRF and audit. 可能改变状态、因此需要 CSRF 与审计的方法。 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Plugin configuration. 插件配置。 */
export interface Config {
  /** Path the gateway mounts on. 网关挂载路径。 */
  mountPath?: string
  /** Maximum accepted JSON body size. 可接受的最大 JSON 体积。 */
  maxBodyBytes?: number
  /** Baseline rate limit. 基线限流。 */
  rateLimit?: { window?: number; max?: number }
  /** Extra browser origins allowed to call the API. 允许调用 API 的额外浏览器来源。 */
  trustedOrigins?: string[]
  /** Advertised URL used by generated OpenAPI. 生成的 OpenAPI 使用的对外 URL。 */
  publicUrl?: string
}

export const Config: z<Config> = z.object({
  mountPath: z.string().default('/api'),
  maxBodyBytes: z.natural().default(1_048_576),
  rateLimit: z.object({
    window: z.natural().default(60),
    max: z.natural().default(120),
  }).default(undefined as never),
  trustedOrigins: z.array(z.string()).default([]),
  publicUrl: z.string().default(''),
})

/** Validated configuration with every default applied. 已应用全部默认值的配置。 */
export interface ResolvedConfig {
  /** Mount path. 挂载路径。 */
  readonly mountPath: string
  /** Body ceiling in bytes. 请求体上限（字节）。 */
  readonly maxBodyBytes: number
  /** Baseline rate limit. 基线限流。 */
  readonly rateLimit: { readonly window: number; readonly max: number }
  /** Trusted browser origins. 受信浏览器来源。 */
  readonly trustedOrigins: readonly string[]
  /** Advertised URL, or an empty string. 对外 URL，或空串。 */
  readonly publicUrl: string
}

/**
 * Apply defaults to a validated config.
 *
 * @param config - validated plugin config 已校验插件配置
 * @returns the resolved configuration 解析后的配置
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    mountPath: config.mountPath ?? '/api',
    maxBodyBytes: config.maxBodyBytes ?? 1_048_576,
    rateLimit: { window: config.rateLimit?.window ?? 60, max: config.rateLimit?.max ?? 120 },
    trustedOrigins: config.trustedOrigins ?? [],
    publicUrl: config.publicUrl ?? '',
  }
}

/** One bucket of the fixed-window limiter. 固定窗口限流器的单个桶。 */
interface Bucket {
  /** Window start, epoch milliseconds. 窗口起点（毫秒）。 */
  start: number
  /** Hits inside the window. 窗口内命中次数。 */
  count: number
}

/**
 * The API gateway service (`ctx.adminApi`).
 *
 * 网关服务（`ctx.adminApi`）。
 */
export class AdminApi extends Service {
  /** Route table. 路由表。 */
  private readonly table = new RouteTable()

  /** Rate-limit buckets keyed by caller and route. 按调用方与路由索引的限流桶。 */
  private readonly buckets = new Map<string, Bucket>()

  /** Resolved configuration. 解析后的配置。 */
  readonly config: ResolvedConfig

  /**
   * @param ctx - owning context 所属上下文
   * @param config - validated config 已校验配置
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'adminApi')
    this.config = resolveConfig(config)
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
    const requestId = randomUUID()
    const collector = new ResponseCollector()
    const facts = requestFacts(req)
    let route: AdminRoute | undefined
    let principal: AuthenticatedPrincipal | undefined

    try {
      if (!facts.pathname.startsWith(this.config.mountPath)) {
        throw new AdminError('NOT_FOUND', `no API route for ${facts.pathname}`)
      }
      this.assertOrigin(facts)
      if (req.method === 'OPTIONS') {
        sendEmpty(res, 204, this.corsHeaders(facts))
        return
      }
      route = this.match(facts, req.method ?? 'GET')
      this.limit(facts, route)
      const unsafe = UNSAFE_METHODS.has(route.method)
      const body = unsafe ? await readJsonBody(req, this.config.maxBodyBytes) : undefined
      const identity = await this.authenticate(route, facts)
      if (route.audience !== 'public' && identity === undefined) {
        throw new AdminError('AUTH_REQUIRED', 'authentication is required for this endpoint')
      }
      if (unsafe && route.audience !== 'public') this.assertCsrf(facts)
      principal = identity === undefined ? undefined : await this.principalOf(identity)
      if (route.permission !== undefined) this.assertPermission(route, principal)
      if (route.scopes !== undefined && route.scopes.length > 0) this.assertScopes(route, principal)
      // Repeated query keys collapse to the last value; routes that need a
      // repeated key must read `request.query` themselves.
      // 重复查询键折叠为最后一个值；需要重复键的路由须自行读取 `request.query`。
      this.validate(route.query, Object.fromEntries(facts.query), 'query')

      const request: AdminRequest = {
        requestId,
        method: route.method,
        path: route.path,
        params: this.lastParams ?? {},
        query: facts.query,
        headers: facts.headers,
        body: this.validate(route.input, body, 'body'),
        principal,
        audience: route.audience,
        ip: facts.ip,
        cookie: (cookieName) => facts.cookies[cookieName],
        header: (headerName) => facts.headers[headerName.toLowerCase()],
      }
      await this.audit(route, request, 'intent')
      const payload = await route.handler({ request, response: collector } satisfies AdminRouteContext)
      await this.audit(route, request, 'success')
      collector.applyTo(res)
      sendJson(res, 200, payload ?? {}, this.corsHeaders(facts))
    } catch (error) {
      const failure = toAdminError(error)
      failure.requestId = requestId
      await this.auditFailure(route, principal, facts, failure.code === 'FORBIDDEN' ? 'denied' : 'failure')
      collector.applyTo(res)
      sendJson(res, failure.status, {
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.details === undefined ? {} : { details: failure.details }),
          requestId,
        },
      }, this.corsHeaders(facts))
    }
  }

  /** Path parameters of the last match, read by {@link handle} while building the request. 最近一次匹配的路径参数。 */
  private lastParams: Readonly<Record<string, string>> = {}

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
   * Consume one rate-limit token.
   *
   * @param facts - request facts 请求事实
   * @param route - matched route 匹配路由
   */
  private limit(facts: RequestFacts, route: AdminRoute): void {
    const key = `${facts.ip}|${route.audience}|${route.method}|${route.path}`
    const now = Date.now()
    const windowMs = this.config.rateLimit.window * 1000
    const bucket = this.buckets.get(key)
    if (bucket === undefined || now - bucket.start >= windowMs) {
      this.buckets.set(key, { start: now, count: 1 })
      return
    }
    bucket.count += 1
    if (bucket.count > this.config.rateLimit.max) {
      throw new AdminError('RATE_LIMITED', 'too many requests', { window: this.config.rateLimit.window })
    }
  }

  /**
   * Resolve the caller identity for a route's audience.
   *
   * @param route - matched route 匹配路由
   * @param facts - request facts 请求事实
   * @returns the identity, or `undefined` for an anonymous public caller 身份；公开匿名调用为 `undefined`
   */
  private async authenticate(route: AdminRoute, facts: RequestFacts): Promise<AdminIdentity | undefined> {
    if (!this.ctx.admin.has('auth')) return undefined
    const auth = this.ctx.admin.require<AdminAuth>('auth')
    if (route.audience === 'terminal') {
      const header = facts.headers.authorization ?? ''
      const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
      if (bearer === undefined || bearer.length === 0) return undefined
      return auth.authenticate({ bearer })
    }
    const sessionId = facts.cookies[ADMIN_SESSION_COOKIE]
    if (sessionId === undefined) return undefined
    return auth.authenticate({ sessionId })
  }

  /**
   * Attach resolved permissions to an identity.
   *
   * @param identity - the authenticated identity 已认证身份
   * @returns the principal 主体
   */
  private async principalOf(identity: AdminIdentity): Promise<AuthenticatedPrincipal> {
    const access = this.ctx.admin.has('access') ? this.ctx.admin.require<AdminAccess>('access') : undefined
    const permissions = access === undefined ? [] : await access.permissionsOf(identity)
    return { ...identity, permissions }
  }

  /**
   * Enforce one route permission.
   *
   * @param route - matched route 匹配路由
   * @param principal - resolved principal 已解析主体
   */
  private assertPermission(route: AdminRoute, principal: AuthenticatedPrincipal | undefined): void {
    const permission = route.permission as string
    if (principal === undefined) throw new AdminError('AUTH_REQUIRED', `authentication is required for ${permission}`)
    const access = this.ctx.admin.has('access') ? this.ctx.admin.require<AdminAccess>('access') : undefined
    if (access === undefined || !access.can(principal, permission)) {
      throw new AdminError('FORBIDDEN', `missing permission ${permission}`, { permission })
    }
  }

  /**
   * Enforce the scopes a terminal route requires.
   *
   * @param route - matched route 匹配路由
   * @param principal - resolved principal 已解析主体
   */
  private assertScopes(route: AdminRoute, principal: AuthenticatedPrincipal | undefined): void {
    const required = route.scopes as readonly string[]
    const granted = principal?.scopes ?? []
    const missing = required.filter((scope) => !granted.includes(scope))
    if (missing.length > 0) {
      throw new AdminError('FORBIDDEN', `token is missing scopes: ${missing.join(', ')}`, { missingScopes: missing })
    }
  }

  /**
   * Enforce the double-submit CSRF check.
   *
   * @param facts - request facts 请求事实
   */
  private assertCsrf(facts: RequestFacts): void {
    const cookie = facts.cookies[ADMIN_CSRF_COOKIE]
    const header = facts.headers[ADMIN_CSRF_HEADER]
    if (cookie === undefined || header === undefined || cookie !== header) {
      throw new AdminError('CSRF_FAILED', 'CSRF token is missing or does not match the cookie')
    }
  }

  /**
   * Reject a cross-origin request from an origin the deployment does not trust.
   *
   * @param facts - request facts 请求事实
   */
  private assertOrigin(facts: RequestFacts): void {
    const origin = facts.headers.origin
    if (origin === undefined) return
    if (origin === 'null') throw new AdminError('FORBIDDEN', 'null origin is not allowed')
    const host = new URL(origin).host
    if (host === facts.headers.host) return
    if (this.config.trustedOrigins.includes(origin)) return
    throw new AdminError('FORBIDDEN', `origin ${origin} is not trusted`, { origin })
  }

  /**
   * CORS headers for a trusted cross-origin caller.
   *
   * @param facts - request facts 请求事实
   * @returns response headers, empty for same-origin callers 响应头；同源调用为空
   */
  private corsHeaders(facts: RequestFacts): Record<string, string> {
    const origin = facts.headers.origin
    if (origin === undefined || !this.config.trustedOrigins.includes(origin)) return {}
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': `content-type,${ADMIN_CSRF_HEADER},idempotency-key`,
      Vary: 'Origin',
    }
  }

  /**
   * Validate one untrusted value with an optional schema.
   *
   * @param schema - schema to apply 要应用的 schema
   * @param value - untrusted value 不可信值
   * @param field - field name used in the error 错误中使用的字段名
   * @returns the validated value, or the input when no schema exists 校验后的值；无 schema 时原值
   */
  private validate(schema: AdminSchema | undefined, value: unknown, field: string): unknown {
    if (schema === undefined) return value
    try {
      return schema.parse(value)
    } catch (error) {
      throw new AdminError('VALIDATION_FAILED', `${field} is invalid`, {
        field,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Append one audit row for a resolved request.
   *
   * @param route - matched route 匹配路由
   * @param request - the request being handled 正在处理的请求
   * @param result - outcome to record 要记录的结果
   */
  private async audit(route: AdminRoute, request: AdminRequest, result: 'intent' | 'success'): Promise<void> {
    if (route.audit !== true || !this.ctx.admin.has('audit')) return
    const audit = this.ctx.admin.require<AdminAudit>('audit')
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
   * @param route - matched route, when matching succeeded 匹配到的路由
   * @param principal - resolved principal, when known 已解析主体
   * @param facts - request facts 请求事实
   * @param result - outcome to record 要记录的结果
   */
  private async auditFailure(
    route: AdminRoute | undefined,
    principal: AuthenticatedPrincipal | undefined,
    facts: RequestFacts,
    result: 'failure' | 'denied',
  ): Promise<void> {
    if (route?.audit !== true || !this.ctx.admin.has('audit')) return
    const audit = this.ctx.admin.require<AdminAudit>('audit')
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
}
