/**
 * Browser half of the default theme pack.
 *
 * One theme with a light and a dark scheme. Both schemes define the complete
 * token set the SPA consumes, because a missing token would silently fall back
 * to a stylesheet default and break the promise that swapping a theme changes
 * only values, never layout. Status colours (`ok`, `warn`, `danger`, `info`) are
 * part of the contract in v2: a theme that omits them leaves success/warning
 * badges at the fallback palette, which is exactly what the contract exists to
 * prevent.
 *
 * 默认主题包的浏览器半边。一个主题，含亮色与暗色两套方案。两套方案都定义了 SPA 消费的
 * 全部 token，因为缺失的 token 会静默落回样式表默认值，破坏“换主题只改值、不改布局”的
 * 承诺。状态色（`ok`、`warn`、`danger`、`info`）在 v2 属于契约：省略它们的主题会把
 * 成功/警告徽标留在兜底配色上，而这正是契约要防止的情况。
 *
 * Colour choices follow the redesign proposal: body text and muted text keep at
 * least 4.5:1 against both `--admin-bg` and `--admin-surface`; status colours are
 * chosen so they can be used as text; the single accent is unchanged because its
 * white-on-blue contrast already passes.
 *
 * 选色遵循重设计方案：正文与弱化文字相对 `--admin-bg` 与 `--admin-surface` 均保持至少
 * 4.5:1；状态色可直接作文本色；唯一强调色沿用原值，因为其“蓝底白字”对比度已经达标。
 *
 * @module @veren/admin-theme-default/client.js
 */

/** Token contract version this pack implements. 本包实现的 token 契约版本。 */
const CONTRACT = '2.0.0'

/** Light scheme: paper-like surfaces, borders carry the hierarchy. 亮色方案：纸感表面，层级由边框承担。 */
const light = {
  '--admin-bg': '#f7f8fa',
  '--admin-surface': '#ffffff',
  '--admin-surface-2': '#f1f3f6',
  '--admin-surface-3': '#ffffff',
  '--admin-border': '#e3e7ec',
  '--admin-border-strong': '#cbd3dd',
  '--admin-text': '#171a1f',
  '--admin-muted': '#5b6472',
  '--admin-subtle': '#6b7484',
  '--admin-accent': '#1b5fc1',
  '--admin-accent-text': '#ffffff',
  '--admin-ok': '#15803d',
  '--admin-warn': '#8a5a00',
  '--admin-danger': '#b42318',
  '--admin-info': '#1a6fa8',
  '--admin-radius': '8px',
  '--admin-shadow': '0 8px 24px rgb(16 24 40 / 0.12), 0 2px 6px rgb(16 24 40 / 0.06)',
}

/** Dark scheme: a brightness ladder calibrated first, then the light values were derived. 暗色方案：先校准亮度阶梯，再反推亮色。 */
const dark = {
  '--admin-bg': '#0b0e12',
  '--admin-surface': '#11151b',
  '--admin-surface-2': '#171d25',
  '--admin-surface-3': '#1d2530',
  '--admin-border': '#242c37',
  '--admin-border-strong': '#36424f',
  '--admin-text': '#e9eef5',
  '--admin-muted': '#a2aebf',
  '--admin-subtle': '#808da0',
  '--admin-accent': '#6ea8fe',
  '--admin-accent-text': '#08111d',
  '--admin-ok': '#5fd39b',
  '--admin-warn': '#e5b567',
  '--admin-danger': '#ff8f85',
  '--admin-info': '#7cc4e8',
  '--admin-radius': '8px',
  '--admin-shadow': '0 10px 28px rgb(0 0 0 / 0.55), 0 2px 8px rgb(0 0 0 / 0.4)',
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
    contract: CONTRACT,
    light,
    dark,
  })
}
