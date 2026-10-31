/**
 * The public login page: a single self-contained HTML document styled after
 * the dsh Web shell (flat surfaces, boot background `#fff` / `#151517`,
 * Montserrat-first stack, the DeepSeek blue accent). It posts to Better
 * Auth's `/auth/sign-in/email`, never reveals whether the account or the
 * password failed, and offers sign-out for an already-authenticated browser.
 * Inline style/script keeps the page free of SPA assets so it loads before
 * any authentication exists. The document is assembled from per-section
 * fragments: see `login-page-style`, `login-page-body` and `login-page-script`.
 * 公开登录页：单个自包含 HTML 文档，视觉沿用 dsh Web 外壳风格（平面、启动背景
 * `#fff` / `#151517`、Montserrat 优先字体栈、DeepSeek 蓝色强调色）。表单提交到
 * Better Auth 的 `/auth/sign-in/email`，不区分账号不存在与密码错误，并为已
 * 登录浏览器提供登出入口。内联样式/脚本使页面不依赖任何 SPA 资源，可在未
 * 认证时加载。文档由分节片段装配而成：见 `login-page-style`、
 * `login-page-body` 与 `login-page-script`。
 * @module src/login-page
 */

import { renderLoginStyle } from './login-page-style.js'
import { renderLoginBody } from './login-page-body.js'
import { renderLoginScript } from './login-page-script.js'

/**
 * Render the page head: metadata, title and the inline stylesheet.
 * 渲染页面头部：元信息、标题与内联样式表。
 * @returns the `<head>` element text ending in a newline. 以换行结尾的 `<head>` 元素文本。
 */
function renderLoginHead(): string {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh Web · Sign in / 登录</title>
${renderLoginStyle()}</head>
`
}

/**
 * Render the login page. Every request the page makes is same-origin
 * relative, so the listener's origin never appears in the document — a
 * browser may reach the listener through `127.0.0.1`, `localhost`, or any
 * authority without tripping CORS.
 * 渲染登录页。页面的所有请求都是同源相对路径，文档中绝不出现监听器 origin
 * ——浏览器经 `127.0.0.1`、`localhost` 或任何 authority 访问都不会触发 CORS。
 * @returns the full HTML document.
 */
export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en">
${renderLoginHead()}${renderLoginBody()}${renderLoginScript()}</html>
`
}
