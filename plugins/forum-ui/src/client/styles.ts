/**
 * The forum page stylesheet, injected once per activation.
 *
 * The sheet ships as one string rather than CSS Modules because this package is
 * built outside the Client bundler: there is no CSS pipeline to compile
 * `*.module.css` here. The sections live in per-view sibling modules
 * (`styles-shell`, `styles-feed`, `styles-controls`, `styles-thread`,
 * `styles-settings`, `styles-overlays`); this file joins them in the original
 * cascade order — later rules still win over earlier ones exactly as before —
 * and owns the `<style>` element, which `ctx.effect` holds so disposing the
 * plugin removes it.
 *
 * 论坛页面样式表，每次激活注入一次。它以单个字符串交付而不是 CSS Module，因为本包在客户端
 * 打包器之外构建：这里没有编译 `*.module.css` 的 CSS 管线。各分段住在按视图划分的同级模块里
 * （`styles-shell`、`styles-feed`、`styles-controls`、`styles-thread`、`styles-settings`、
 * `styles-overlays`）；本文件按原始级联顺序拼接它们——后面的规则依旧和从前一样压过前面的——
 * 并持有 `<style>` 元素：它由 `ctx.effect` 持有，插件卸载即移除。
 *
 * @module @veren/forum-ui/client/styles
 */

import type { Context } from '@deepseek-ai/cordis'
import { SHELL_CSS } from './styles-shell.ts'
import { CONFIG_CSS, SIDE_CARDS_CSS } from './styles-settings.ts'
import { FEED_CSS, FEED_EMPTY_CSS } from './styles-feed.ts'
import { CONTROLS_CSS } from './styles-controls.ts'
import { THREAD_CSS } from './styles-thread.ts'
import { OVERLAY_CSS, TOASTS_CSS } from './styles-overlays.ts'

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. 标记属性：重新激活时替换自己的样式表，而不是叠加。 */
const STYLE_MARKER = 'data-forum-panel'

/** The page's complete stylesheet, joined in the original cascade order. 页面完整样式表，按原始级联顺序拼接。 */
export const PANEL_CSS = [
  SHELL_CSS,
  CONFIG_CSS,
  FEED_CSS,
  CONTROLS_CSS,
  FEED_EMPTY_CSS,
  THREAD_CSS,
  SIDE_CARDS_CSS,
  OVERLAY_CSS,
  TOASTS_CSS,
].join('')

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 * @param ctx - the plugin's client context, whose effect owns the element.
 *
 * 安装页面样式表一次，替换上一次激活的副本。
 * @param ctx - 插件的客户端上下文，其 effect 持有该元素。
 */
export function installPanelStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = PANEL_CSS
    document.head.append(style)
    return () => { style.remove() }
  }, 'forum-ui:styles')
}
