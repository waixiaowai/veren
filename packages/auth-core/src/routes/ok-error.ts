/**
 * 基础路由：探活与错误页兜底（设计文档 api.md API-02-01/02）。
 * `/ok` 返回 `{ ok: true }`；`/error` 渲染内建 HTML 错误页，配置
 * `onAPIError.errorURL` 时 302 跳宿主错误页并透传 `error` 与
 * `error_description`。两路由永远最后追加、不可覆盖（§3.3）。
 *
 * Base routes: liveness and the error-page fallback (design api.md
 * API-02-01/02). `/ok` answers `{ ok: true }`; `/error` renders the built-in
 * HTML error page and 302-jumps to `onAPIError.errorURL` with `error` and
 * `error_description` forwarded when configured. Both append last and
 * cannot be overridden (§3.3).
 *
 * @module @veren/auth-core/routes/ok-error
 */

import { createAuthEndpoint } from '../endpoint/endpoint.ts'
import type { AuthEndpoint } from '../endpoint/endpoint.ts'
import type { EndpointContext } from '../endpoint/endpoint-types.ts'
import { redirect } from '../endpoint/dispatch.ts'
import { z } from 'zod'

/** 错误码归一：非法字符一律归为 UNKNOWN。 / Error-code normalization: illegal characters fold into UNKNOWN. */
function safeErrorCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : 'UNKNOWN'
}

/** 渲染内建错误页：深浅色跟随系统，键盘可达。 / Render the built-in error page: theme-aware and keyboard accessible. */
function renderErrorPage(code: string, description: string | null): string {
  const detail = description === null ? '' : `<p class="detail">${escapeHtml(description)}</p>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authentication error</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: Canvas; color: CanvasText; }
.card { max-width: 32rem; padding: 2rem; text-align: center; }
h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
.detail { color: color-mix(in srgb, CanvasText 70%, transparent); margin: 0; }
.fallback { display: none; }
</style></head>
<body><main class="card"><h1>Sign-in could not be completed</h1>
<p>Code: <code>${escapeHtml(code)}</code></p>${detail}
<p class="fallback">Return to the application and try again.</p>
</main></body></html>`
}

/** 最小 HTML 转义。 / Minimal HTML escaping. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${String(ch.charCodeAt(0))};`)
}

/** 错误查询模式。 / The error query schema. */
const errorQuery = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  errorURL: z.string().optional(),
})

/** /error：宿主错误页优先，其次内建页。 / `/error`: the host error URL first, the built-in page otherwise. */
async function handleError(ctx: EndpointContext): Promise<Response> {
  const query = ctx.query as z.infer<typeof errorQuery>
  const code = safeErrorCode(query.error)
  const description = typeof query.error_description === 'string' ? query.error_description : null
  if (typeof query.errorURL === 'string' && query.errorURL !== '') {
    const target = new URL(query.errorURL)
    target.searchParams.set('error', code)
    if (description !== null) target.searchParams.set('error_description', description)
    redirect(ctx, target.toString(), 302)
  }
  return new Response(renderErrorPage(code, description), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 基础路由（永远最后追加）。 / The base routes (always appended last). */
export const baseRoutes: readonly AuthEndpoint[] = [
  createAuthEndpoint('/ok', { method: 'GET' }, async () => ({ ok: true })),
  createAuthEndpoint('/error', { method: 'GET', query: errorQuery }, handleError),
]
