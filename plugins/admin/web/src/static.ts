/**
 * Static file serving for the admin SPA.
 *
 * Every path is resolved inside one root directory and refused when it escapes,
 * and only allowlisted extensions are served. The SPA is small, same-origin and
 * cache-hostile during development, so responses are `no-store`.
 *
 * 后台 SPA 的静态文件服务。每个路径都在一个根目录内解析，越界即拒绝，且只提供白名单
 * 扩展名。SPA 体积小、同源、开发期不宜缓存，因此响应为 `no-store`。
 *
 * @module @veren/admin-web/static
 */

import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

/** Content type per served extension. 每个被提供扩展名的内容类型。 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Resolve a request path inside a root directory.
 *
 * @param root - absolute root directory 根目录绝对路径
 * @param relative - request path 请求路径
 * @returns the absolute path, or `undefined` when it escapes or has no allowed type 绝对路径；越界或类型不允许时为 `undefined`
 */
export function resolveWithin(root: string, relative: string): string | undefined {
  const base = resolve(root)
  const candidate = resolve(base, `.${relative.startsWith('/') ? relative : `/${relative}`}`)
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) return undefined
  if (candidate === base) return undefined
  const extension = candidate.slice(candidate.lastIndexOf('.'))
  return CONTENT_TYPES[extension] === undefined ? undefined : candidate
}

/**
 * Content type for one path, when the extension is served.
 *
 * @param path - file path 文件路径
 * @returns the content type, or `undefined` 内容类型或 `undefined`
 */
export function contentTypeFor(path: string): string | undefined {
  return CONTENT_TYPES[path.slice(path.lastIndexOf('.'))]
}

/**
 * Send one file, or a minimal 404 when it cannot be read.
 *
 * @param res - the response 响应
 * @param path - absolute file path 文件绝对路径
 * @param contentType - content type to set 要设置的内容类型
 * @param cacheControl - cache policy 缓存策略
 */
export async function sendFile(
  res: ServerResponse,
  path: string,
  contentType: string,
  cacheControl = 'no-store',
): Promise<void> {
  try {
    const body = await readFile(path)
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', body.byteLength)
    res.setHeader('Cache-Control', cacheControl)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('not found')
  }
}

/**
 * Security headers attached to the SPA entry document.
 *
 * The policy allows only same-origin scripts and styles; UI packs are served
 * from the same origin, so `'self'` covers them and remote code stays blocked.
 *
 * 附加到 SPA 入口文档的安全响应头。策略只允许同源脚本与样式；UI 包同源提供，因此
 * `'self'` 已覆盖它们，远程代码仍被阻断。
 */
export const INDEX_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}
