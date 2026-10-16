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
.sa-page { display: flex; flex-direction: column; gap: 12px; padding: 16px; height: 100%; box-sizing: border-box; overflow: hidden; }
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
.sa-list-wrap { flex: 1 1 55%; min-width: 0; overflow: auto; }
.sa-detail-wrap { flex: 1 1 45%; min-width: 280px; overflow: auto; }
.sa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sa-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; cursor: pointer; border-radius: 8px;
  background: var(--dsw-surface-sunken); border: 1px solid var(--dsw-border-subtle); }
.sa-row[aria-current="true"] { border-color: var(--dsw-accent); }
.sa-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sa-row-name { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-row-meta { font-size: 12px; color: var(--dsw-text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px;
  color: var(--dsw-text-secondary); background: var(--dsw-surface-raised); }
.sa-badge-ok { color: var(--dsw-success-text); }
.sa-badge-bad { color: var(--dsw-danger-text); }
.sa-switch { flex: 0 0 auto; margin-top: 2px; cursor: pointer; }
.sa-detail { display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: 8px; background: var(--dsw-surface-raised); border: 1px solid var(--dsw-border-subtle); }
.sa-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sa-detail-title { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary); margin: 0; }
.sa-field { display: flex; flex-direction: column; gap: 3px; }
.sa-field-label { font-size: 11px; color: var(--dsw-text-tertiary); }
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
