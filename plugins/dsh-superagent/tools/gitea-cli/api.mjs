// The `gitea api` subcommand: one authenticated call against the configured host's `/api/v1`.
// `gitea api` 子命令：对所配站点的 `/api/v1` 发起一次带鉴权的调用。
//
// argv: api <path> [--method GET|POST|PUT|PATCH|DELETE] [-f key=value]... [-H 'Header: value']...
// The path is repo-relative as the plugin passes it (`repos/owner/name/issues/1`) or instance-relative (`user`).
// 路径可以是仓库相对（插件传入的 `repos/owner/name/issues/1`）或实例相对（`user`）。
//
// Output: the response body as received (JSON bodies print as-is; raw endpoints print raw). HTTP errors print
// `gitea: <message> (HTTP <status>)` on stderr and exit 1 — the shape dsh-superagent's `commandError` parses.
// 输出：原样打印响应体（JSON 照打印；raw 端点打印原文）。HTTP 错误在 stderr 打印
// `gitea: <message> (HTTP <status>)` 并以 1 退出——这正是 dsh-superagent 的 `commandError` 解析的形状。

import { GiteaCliError } from './config.mjs'

/** Builds the RequestInit for one API call from the parsed arguments. */
/** 由解析后的参数构建一次 API 调用的 RequestInit。 */
export function request(config, path, { method = 'GET', fields = [], headers = [] } = {}) {
  const url = `${config.url}/api/v1/${path.replace(/^\/+/, '')}`
  const body = fields.length
    ? new URLSearchParams(fields.map(field => {
      const at = field.indexOf('=')
      return [field.slice(0, at), field.slice(at + 1)]
    }))
    : undefined
  return { url, init: {
    method,
    ...(body ? { body } : {}),
    headers: {
      Authorization: `token ${config.token}`,
      ...Object.fromEntries(headers.map(header => {
        const at = header.indexOf(':')
        return [header.slice(0, at).trim(), header.slice(at + 1).trim()]
      })),
    },
  } }
}

/** Performs one API call and prints the body; throws a GiteaCliError with exit 1 on any HTTP failure. */
/** 执行一次 API 调用并打印响应体；任何 HTTP 失败都抛出退出码为 1 的 GiteaCliError。 */
export async function api(config, path, options = {}) {
  const { url, init } = request(config, path, options)
  const response = await fetch(url, { ...init, redirect: 'follow' })
  const text = await response.text()
  if (!response.ok) {
    // Surface Gitea's own message when the body carries one; otherwise the status text.
    // 响应体带消息时透出 Gitea 自己的消息；否则用状态文本。
    let message = response.statusText || 'request failed'
    try {
      const parsed = JSON.parse(text)
      message = parsed.message ?? message
    } catch { /* The body is not JSON; keep the status text. 响应体不是 JSON；沿用状态文本。 */ }
    throw new GiteaCliError(`gitea: ${message} (HTTP ${response.status})`, 1)
  }
  return text
}
