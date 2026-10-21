/**
 * The stylesheet for the toolbar dropdown, injected once per load.
 *
 * The rules consume the shared `--dsw-*` semantic tokens only - no literal
 * colors - so the dropdown follows every theme the shell ships. One `<style>`
 * element per plugin instance, replaced idempotently on reload, removed on
 * unload.
 *
 * 工具栏下拉的样式，每次加载注入一份。规则只消费共享的 `--dsw-*` 语义令牌——
 * 不写死颜色——因此下拉跟随外壳的每一个主题。每个插件实例一个 `<style>` 元素，
 * 重载时幂等替换，卸载时移除。
 * @module @veren/app-host-ui/client/styles
 */

import type { Context } from '@deepseek-ai/cordis'

/** The `<style>` element id this plugin owns. */
const STYLE_ID = 'app-host-ui-picker-styles'

const CSS = `
.ah-picker { display: inline-flex; min-width: 0; }
.ah-picker .ah-picker-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 12em; }
.ah-picker .ah-picker-note { opacity: 0.7; font-size: 0.85em; margin-left: 0.35em; }
.ah-picker-status { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; max-width: 20em;
  color: var(--dsw-alias-label-secondary, inherit); font-size: 0.9em; }
`

/** Install the dropdown styles for this plugin instance; returns the disposer. */
export function installPickerStyles(_ctx: Context): () => void {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
