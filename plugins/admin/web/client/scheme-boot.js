/**
 * First-paint colour-scheme bootstrap.
 *
 * Loaded synchronously in `<head>` after the stylesheet and before the module
 * entry, so the very first paint already carries the right `data-scheme`. Without
 * it a dark-mode operator sees the light fallback until the UI packs arrive,
 * because the theme tokens only exist after an async pack import.
 *
 * It has to be a same-origin file rather than an inline script: the CSP is
 * `script-src 'self'` with no `'unsafe-inline'`.
 *
 * 首帧配色引导脚本。
 *
 * 在 `<head>` 中、样式表之后、模块入口之前同步加载，因此第一帧就带上正确的
 * `data-scheme`。没有它时，暗色用户会一直看到亮色兜底，直到 UI 包异步加载完成——主题
 * token 只有在包导入之后才存在。
 *
 * 必须是同源文件而不是内联脚本：CSP 为 `script-src 'self'`，不含 `'unsafe-inline'`。
 */
;(function () {
  var KEY = 'admin.theme'
  var stored = null
  try {
    stored = window.localStorage.getItem(KEY)
  } catch (error) {
    // Private mode may block storage; the system preference is the right fallback.
    // 隐私模式可能禁用存储；此时以系统偏好为退路。
    stored = null
  }
  var scheme = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-scheme', scheme)
})()
