/**
 * Panel stylesheet, injected once per activation.
 *
 * The stylesheet ships as one string rather than CSS Modules because this
 * package is built outside the Client bundler: there is no CSS pipeline to
 * compile `*.module.css` here. Colors come only from the shared `--dsw-*`
 * semantic tokens, so the panel follows every theme. The `<style>` element is
 * owned by `ctx.effect`, so disposing the plugin removes it.
 *
 * 面板样式表，每次激活注入一次。它以单个字符串交付而不是 CSS Module，因为本包在客户端
 * 打包器之外构建：这里没有编译 `*.module.css` 的 CSS 管线。颜色只取自共享的 `--dsw-*`
 * 语义 token，因此面板跟随所有主题。`<style>` 元素由 `ctx.effect` 持有，插件卸载即移除。
 *
 * @module @veren/startup-autostart/client/styles
 */

import type { Context } from '@deepseek-ai/cordis'

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-startup-autostart-panel'

/** The panel's complete stylesheet. */
export const PANEL_CSS = `
/* Panel-local token bridge: the sheet keeps its historical vocabulary
   (--dsw-text-*, --dsw-surface-*, ...) while the actual values come from the
   current client theme aliases (--dsw-alias-*). Every .sa-* element sits inside
   .sa-page, so these definitions inherit to the whole panel and the theme
   switch keeps working. 面板局部 token 桥：样式表沿用自身历史词汇（--dsw-text-*、
   --dsw-surface-* 等），实际取值映射到当前客户端主题别名（--dsw-alias-*）。所有
   .sa-* 元素都在 .sa-page 内部，这些定义随之继承到整个面板，主题切换仍然生效。 */
.sa-page {
  --dsw-text-primary: var(--dsw-alias-label-primary);
  --dsw-text-secondary: var(--dsw-alias-label-secondary);
  --dsw-text-tertiary: var(--dsw-alias-label-tertiary);
  --dsw-surface-sunken: var(--dsw-alias-bg-layer-1);
  --dsw-surface-raised: var(--dsw-alias-bg-layer-2);
  --dsw-border-subtle: var(--dsw-alias-border-l2);
  --dsw-accent: var(--dsw-alias-state-business-primary);
  --dsw-text-on-accent: var(--dsw-alias-label-primary-foreground);
  --dsw-success-text: var(--dsw-alias-state-success-primary);
  --dsw-danger-text: var(--dsw-alias-state-error-primary);
  --dsw-danger-border: var(--dsw-alias-state-error-primary);
}
/* Border-box for every panel element: rows use width: 100% plus padding and
   border; under the default content-box each row overflows its column, so the
   list scrolls sideways and the row's right edge is clipped behind the detail
   pane. 面板内所有元素统一 border-box：行使用 width:100% 再加内边距与边框，默认
   content-box 下每行都会溢出所在列，列表出现横向滚动、行右缘被详情面板裁切遮挡。 */
.sa-page, .sa-page *, .sa-page *::before, .sa-page *::after { box-sizing: border-box; }
.sa-page { display: flex; flex-direction: column; gap: 12px; padding: 16px; height: 100%; overflow: hidden; }
.sa-head { display: flex; flex-direction: column; gap: 4px; }
.sa-title { font-size: 16px; font-weight: 600; color: var(--dsw-text-primary); margin: 0; }
.sa-subtitle { font-size: 12px; color: var(--dsw-text-tertiary); margin: 0; }
.sa-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sa-input { flex: 1 1 220px; min-width: 160px; padding: 6px 10px; font-size: 13px;
  color: var(--dsw-text-primary); background: var(--dsw-surface-sunken);
  border: 1px solid var(--dsw-border-subtle); border-radius: 6px; }
.sa-seg { display: flex; border: 1px solid var(--dsw-border-subtle); border-radius: 6px; overflow: hidden; }
.sa-seg > button { padding: 6px 10px; font-size: 12px; cursor: pointer; border: 0;
  color: var(--dsw-text-secondary); background: var(--dsw-surface-sunken); }
.sa-seg > button[aria-pressed="true"] { color: var(--dsw-text-primary); background: var(--dsw-surface-raised); font-weight: 600; }
.sa-btn { padding: 6px 12px; font-size: 12px; cursor: pointer; border-radius: 6px;
  color: var(--dsw-text-primary); background: var(--dsw-surface-raised);
  border: 1px solid var(--dsw-border-subtle); }
.sa-btn:disabled { opacity: .5; cursor: default; }
.sa-btn-primary { color: var(--dsw-text-on-accent); background: var(--dsw-accent); border-color: var(--dsw-accent); }
.sa-btn-danger { color: var(--dsw-danger-text); border-color: var(--dsw-danger-border); }
.sa-body { display: flex; gap: 12px; min-height: 0; flex: 1 1 auto; }
.sa-list-wrap { flex: 1 1 100%; min-width: 0; overflow: auto; }
/* Sort toolbar: the dropdown stays compact beside the direction toggle. */
/* 排序工具条：下拉保持紧凑，与方向切换按钮并排。 */
.sa-sort { flex: 0 1 auto; min-width: 0; width: auto; }
.sa-row-edit { flex: 0 0 auto; align-self: flex-start; }
.sa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sa-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; cursor: pointer; border-radius: 8px;
  background: var(--dsw-surface-sunken); border: 1px solid var(--dsw-border-subtle);
  transition: border-color .15s ease, background-color .15s ease; }
.sa-row:hover { border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover); }
.sa-row[aria-current="true"] { border-color: var(--dsw-accent);
  background: color-mix(in srgb, var(--dsw-accent) 6%, transparent); }
.sa-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px;
  /* button 要素：浏览器默认居中文字且不继承字体，必须显式还原为普通文本流。 */
  /* button element: the UA centers text and drops inherited fonts; restore a
     plain text flow explicitly. */
  text-align: left; font: inherit; color: inherit; padding: 0; border: 0;
  background: transparent; cursor: pointer; }
.sa-row-name { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-row-meta { font-size: 12px; color: var(--dsw-text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-badge { display: inline-block; font-size: 11px; line-height: 1.4; padding: 0 6px;
  border-radius: 999px; vertical-align: 1px;
  color: var(--dsw-text-secondary); background: var(--dsw-alias-bg-layer-3); }
.sa-badge-ok { color: var(--dsw-success-text); }
.sa-badge-bad { color: var(--dsw-danger-text); }
.sa-switch { flex: 0 0 auto; margin-top: 2px; cursor: pointer; }
.sa-detail { display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: 8px; background: var(--dsw-surface-raised); border: 1px solid var(--dsw-border-subtle); }
.sa-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sa-detail-title { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary); margin: 0; }
.sa-field { display: flex; flex-direction: column; gap: 3px; }
/* The shared Menu trigger stretches to the field width; the value hugs the
   left and the chevron rides the right edge. */
/* 共享 Menu 的触发钮拉伸到字段宽度：取值靠左，箭头贴右缘。 */
.sa-select-trigger { width: 100%; justify-content: space-between; }
.sa-select-trigger svg:last-child { flex: 0 0 auto; }
.sa-select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-field-label { font-size: 11px; color: var(--dsw-text-tertiary); }
/* The required-field asterisk rides the label in the danger tone. */
/* 必填星号跟随标签，使用危险色。 */
.sa-required { color: var(--dsw-danger-text); }
.sa-field-value { font-size: 12px; color: var(--dsw-text-primary); word-break: break-word; }
.sa-field-input, .sa-field-select, .sa-field-textarea { padding: 5px 8px; font-size: 12px;
  color: var(--dsw-text-primary); background: var(--dsw-surface-sunken);
  border: 1px solid var(--dsw-border-subtle); border-radius: 6px; font-family: inherit; }
.sa-field-textarea { min-height: 56px; resize: vertical; }
.sa-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.sa-note { font-size: 12px; color: var(--dsw-text-tertiary); }
.sa-note-bad { font-size: 12px; color: var(--dsw-danger-text); }
.sa-hint { font-size: 11px; color: var(--dsw-text-tertiary); }
.sa-empty { padding: 24px; text-align: center; font-size: 13px; color: var(--dsw-text-tertiary); }
/* Edit drawer: a right-side sheet over a dimming veil. Clicking the veil or
   the close button dismisses it; clicks inside do not. The drawer scrolls its
   own body so the list underneath keeps its scroll position. */
/* 编辑抽屉：压在变暗遮罩上的右侧面板。点遮罩或关闭按钮收起，内部点击不冒泡。
   抽屉自带滚动，底下列表的滚动位置不受影响。 */
.sa-drawer-veil { position: fixed; inset: 0; z-index: 1000;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, transparent);
  display: flex; justify-content: flex-end; }
.sa-drawer { width: min(420px, 92vw); height: 100%; display: flex; flex-direction: column;
  background: var(--dsw-surface-raised); border-left: 1px solid var(--dsw-border-subtle);
  box-shadow: -8px 0 24px color-mix(in srgb, #000 20%, transparent); }
.sa-drawer-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-border-subtle); }
.sa-drawer-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px; }
.sa-drawer-body .sa-detail { background: transparent; border: 0; padding: 0; }
`

/**
 * Inject the panel stylesheet and return its removal.
 *
 * A stale sheet from an earlier activation carries the same marker, so it is
 * replaced rather than duplicated; the returned disposer removes only the sheet
 * this activation created.
 * @param ctx - Client context owning the effect.
 */
export function installPanelStyles(ctx: Context): void {
  const doc = globalThis.document
  ctx.effect(() => {
    const previous = doc.querySelector(`style[${STYLE_MARKER}]`)
    previous?.remove()
    const style = doc.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = PANEL_CSS
    doc.head.append(style)
    return () => { style.remove() }
  }, 'startup-autostart panel styles')
}
