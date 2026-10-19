/**
 * Browser half of the default theme pack.
 *
 * One theme with a light and a dark scheme. Both schemes define the complete
 * token set the SPA consumes, because a missing token would silently fall back
 * to a stylesheet default and break the promise that swapping a theme changes
 * only values, never layout.
 *
 * 默认主题包的浏览器半边。一个主题，含亮色与暗色两套方案。两套方案都定义了 SPA 消费的
 * 全部 token，因为缺失的 token 会静默落回样式表默认值，破坏“换主题只改值、不改布局”的
 * 承诺。
 *
 * Colour choices: body text and muted text keep at least 4.5:1 against both
 * `--admin-bg` and `--admin-surface`; accent buttons keep at least 4.5:1 between
 * `--admin-accent` and `--admin-accent-text`.
 *
 * 选色原则：正文与弱化文字相对 `--admin-bg` 与 `--admin-surface` 均保持至少 4.5:1；强调
 * 按钮的 `--admin-accent` 与 `--admin-accent-text` 之间同样至少 4.5:1。
 *
 * @module @veren/admin-theme-default/client.js
 */

/** Light scheme: paper-like surfaces with a single blue accent. 亮色方案：纸感表面加单一蓝色强调。 */
const light = {
  '--admin-bg': '#f7f8fa',
  '--admin-surface': '#ffffff',
  '--admin-surface-2': '#eef1f5',
  '--admin-border': '#cfd6de',
  '--admin-text': '#141a21',
  '--admin-muted': '#55616f',
  '--admin-accent': '#1b5fc1',
  '--admin-accent-text': '#ffffff',
  '--admin-danger': '#b3261e',
  '--admin-radius': '10px',
  '--admin-shadow': '0 1px 2px rgba(15, 23, 42, 0.08), 0 10px 24px rgba(15, 23, 42, 0.08)',
}

/** Dark scheme: deep slate surfaces with a light blue accent. 暗色方案：深石板表面配浅蓝强调。 */
const dark = {
  '--admin-bg': '#0e1319',
  '--admin-surface': '#151c24',
  '--admin-surface-2': '#1d2731',
  '--admin-border': '#2c3846',
  '--admin-text': '#e8eef6',
  '--admin-muted': '#a8b6c6',
  '--admin-accent': '#6ea8fe',
  '--admin-accent-text': '#08111d',
  '--admin-danger': '#ff9b91',
  '--admin-radius': '10px',
  '--admin-shadow': '0 1px 2px rgba(0, 0, 0, 0.5), 0 14px 30px rgba(0, 0, 0, 0.45)',
}

/**
 * Register the theme with the SPA runtime.
 *
 * @param runtime - the admin UI runtime 后台 UI 运行时
 */
export function activate(runtime) {
  runtime.registerTheme({
    id: 'default',
    label: { en: 'Default', zh: '默认' },
    light,
    dark,
  })
}
