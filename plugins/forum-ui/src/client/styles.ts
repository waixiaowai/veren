/**
 * The forum page stylesheet, injected once per activation.
 *
 * The sheet ships as one string rather than CSS Modules because this package is
 * built outside the Client bundler: there is no CSS pipeline to compile
 * `*.module.css` here. Colors come only from the shared `--dsw-*` semantic
 * tokens, so the page follows every theme. The `<style>` element is owned by
 * `ctx.effect`, so disposing the plugin removes it.
 *
 * 论坛页面样式表，每次激活注入一次。它以单个字符串交付而不是 CSS Module，因为本包在客户端
 * 打包器之外构建：这里没有编译 `*.module.css` 的 CSS 管线。颜色只取自共享的 `--dsw-*`
 * 语义 token，因此页面跟随所有主题。`<style>` 元素由 `ctx.effect` 持有，插件卸载即移除。
 *
 * @module @veren/forum-ui/client/styles
 */

import type { Context } from '@deepseek-ai/cordis'

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-forum-panel'

/** The page's complete stylesheet. */
export const PANEL_CSS = `
.forum-page {
  --forum-canvas: var(--dsw-alias-bg-module-platform);
  --forum-surface: var(--dsw-alias-bg-layer-1);
  --forum-sunken: var(--dsw-alias-turn-trigger-bg);
  --forum-text: var(--dsw-alias-label-primary);
  --forum-secondary: var(--dsw-alias-label-secondary);
  --forum-muted: var(--dsw-alias-label-tertiary);
  --forum-border: var(--dsw-alias-border-l2);
  --forum-border-soft: var(--dsw-alias-border-l1);
  --forum-accent: var(--dsw-alias-state-business-primary);
  --forum-accent-soft: var(--dsw-alias-state-business-tertiary);
  --forum-ink: var(--dsw-alias-button-primary-fill);
  --forum-ink-hover: var(--dsw-alias-button-primary-hover);
  --forum-ink-fg: var(--dsw-alias-label-primary-foreground);
  --forum-success: var(--dsw-alias-state-success-primary);
  --forum-success-soft: var(--dsw-alias-state-success-tertiary);
  --forum-warn: var(--dsw-alias-state-warn-primary);
  --forum-warn-label: var(--dsw-alias-state-warn-label);
  --forum-warn-soft: var(--dsw-alias-state-warn-tertiary);
  --forum-danger: var(--dsw-alias-state-error-primary);
  --forum-danger-soft: color-mix(in srgb, var(--forum-danger) 10%, transparent);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(1100px 300px at 50% -120px, color-mix(in srgb, var(--forum-accent) 8%, transparent), transparent 72%),
    var(--forum-canvas);
  color: var(--forum-text);
  font-family: var(--dsw-font-family);
  font-size: 13.5px;
  line-height: 1.5;
}
.forum-page *, .forum-page *::before, .forum-page *::after { box-sizing: border-box; }
.forum-page :focus-visible { outline: 2px solid var(--forum-accent); outline-offset: 2px; }
.forum-page ::selection { background: var(--forum-accent-soft); }

/* ---------- header ---------- */
.forum-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 26px 40px 14px;
}
.forum-heading-row { display: flex; align-items: center; gap: 11px; }
.forum-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--forum-ink), color-mix(in srgb, var(--forum-ink) 62%, var(--forum-accent)));
  color: var(--forum-ink-fg);
  box-shadow: var(--dsw-shadow-lv2);
}
.forum-mark svg { width: 20px; height: 20px; }
.forum-heading h1 {
  margin: 0;
  font-size: 25px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.025em;
}
.forum-heading p {
  margin: 7px 0 0;
  color: var(--forum-secondary);
  font-size: 12.5px;
}
.forum-header-actions { display: flex; align-items: center; gap: 10px; padding-bottom: 2px; }
.forum-actor {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--forum-border-soft);
  border-radius: 10px;
  background: var(--forum-surface);
}
.forum-actor span { color: var(--forum-muted); font-size: 11px; white-space: nowrap; }
.forum-actor select {
  max-width: 128px;
  height: 30px;
  padding: 0 4px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--forum-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.forum-actor select:hover { background: var(--forum-sunken); }

/* ---------- board pills ---------- */
.forum-boardbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 40px 15px;
  overflow-x: auto;
  scrollbar-width: none;
}
.forum-boardbar::-webkit-scrollbar { display: none; }
.forum-boardbar-empty { color: var(--forum-muted); font-size: 12px; }
.forum-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--forum-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.forum-pill:hover {
  border-color: var(--forum-border-soft);
  background: var(--forum-surface);
  color: var(--forum-text);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-pill[aria-selected='true'] {
  background: var(--forum-ink);
  color: var(--forum-ink-fg);
  box-shadow: var(--dsw-shadow-lv2);
}
.forum-pill-count {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--forum-sunken);
  color: var(--forum-muted);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
}
.forum-pill[aria-selected='true'] .forum-pill-count {
  background: color-mix(in srgb, var(--forum-ink-fg) 18%, transparent);
  color: inherit;
}

/* ---------- two-column body ---------- */
.forum-layout {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 312px;
  gap: 24px;
  width: 100%;
  max-width: 1180px;
  min-height: 0;
  margin: 0 auto;
  padding: 4px 40px 30px;
}
.forum-main { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; }
.forum-side { display: flex; flex-direction: column; gap: 14px; min-height: 0; overflow-y: auto; padding-right: 2px; }
.forum-main::-webkit-scrollbar, .forum-side::-webkit-scrollbar { width: 8px; }
.forum-main::-webkit-scrollbar-thumb, .forum-side::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--dsw-alias-scrollbar-bg-l2);
  background-clip: padding-box;
}

/* ---------- feed toolbar ---------- */
.forum-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  gap: 8px;
  padding: 4px 0 13px;
  background: linear-gradient(var(--forum-canvas) 72%, transparent);
}
.forum-search { position: relative; flex: 1 1 auto; min-width: 0; }
.forum-search-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  color: var(--forum-muted);
  transform: translateY(-50%);
  pointer-events: none;
}
.forum-search .forum-input { height: 38px; padding-left: 35px; background: var(--forum-surface); }
.forum-select {
  height: 38px;
  width: auto;
  max-width: 160px;
  padding: 0 10px;
  border: 1px solid var(--forum-border);
  border-radius: 10px;
  background: var(--forum-surface);
  color: var(--forum-text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.forum-select:hover { border-color: var(--forum-muted); }
.forum-select:focus { outline: none; border-color: var(--forum-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--forum-accent) 18%, transparent); }

/* ---------- feed ---------- */
.forum-feed-head { display: flex; align-items: center; justify-content: space-between; margin: 1px 0 11px; }
.forum-feed-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--forum-secondary);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: .01em;
}
.forum-feed-title::before {
  content: '';
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--forum-accent);
}
.forum-count {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--forum-sunken);
  color: var(--forum-secondary);
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1;
}
.forum-live { color: var(--forum-muted); font-size: 10.5px; font-weight: 500; }
.forum-feed { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }

/* ---------- post card ---------- */
.forum-card {
  border: 1px solid var(--forum-border-soft);
  border-radius: 16px;
  background: var(--forum-surface);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-post {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 17px 20px 14px;
  transition: box-shadow .16s ease, border-color .16s ease, transform .16s ease;
}
.forum-post:hover {
  border-color: var(--forum-border);
  box-shadow: var(--dsw-shadow-lv2);
  transform: translateY(-1px);
}
.forum-post.is-pinned { box-shadow: inset 3px 0 0 var(--forum-warn), var(--dsw-shadow-lv1); }
.forum-post.is-pinned:hover { box-shadow: inset 3px 0 0 var(--forum-warn), var(--dsw-shadow-lv2); }
.forum-post-top { display: flex; align-items: flex-start; gap: 9px; }
.forum-post-title { margin: 0; font-size: 15.5px; line-height: 1.45; font-weight: 650; letter-spacing: -0.01em; }
.forum-post-link {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: color .13s ease;
}
.forum-post-link:hover { color: var(--forum-accent); }
.forum-post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: var(--forum-secondary); font-size: 11.5px; }
.forum-post-author { font-weight: 600; color: var(--forum-secondary); }
.forum-avatar {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: var(--forum-accent-soft);
  color: var(--forum-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  flex: 0 0 auto;
}
.forum-post-excerpt {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--forum-secondary);
  font-size: 12.5px;
  line-height: 1.65;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.forum-post-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
  padding-top: 11px;
  border-top: 1px solid var(--forum-border-soft);
}
.forum-post-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.forum-stat { color: var(--forum-muted); font-size: 11px; white-space: nowrap; }
.forum-dot { color: var(--forum-muted); font-size: 10px; line-height: 1; }

/* ---------- chips, avatars, votes ---------- */
.forum-chip {
  display: inline-flex;
  align-items: center;
  max-width: 160px;
  padding: 2px 7px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--forum-sunken);
  color: var(--forum-secondary);
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-chip.is-warn { background: var(--forum-warn-soft); color: var(--forum-warn-label); font-weight: 650; }
.forum-chip.is-accent { background: var(--forum-accent-soft); color: var(--forum-accent); font-weight: 650; }
.forum-vote-group { display: inline-flex; gap: 5px; }
.forum-vote {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 27px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--forum-sunken);
  color: var(--forum-secondary);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background .13s ease, color .13s ease, border-color .13s ease;
}
.forum-vote:hover:not(:disabled) { border-color: var(--forum-border); background: var(--forum-sunken); color: var(--forum-text); }
.forum-vote:disabled { opacity: .55; cursor: default; }
.forum-vote[aria-pressed='true'] {
  border-color: transparent;
  background: var(--forum-accent-soft);
  color: var(--forum-accent);
  font-weight: 650;
}
.forum-vote[aria-pressed='true']:last-child {
  background: var(--forum-danger-soft);
  color: var(--forum-danger);
}

/* ---------- buttons ---------- */
.forum-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--forum-border);
  border-radius: 9px;
  background: var(--forum-surface);
  color: var(--forum-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, color .14s ease, transform .1s ease;
}
.forum-btn:hover:not(:disabled) { background: var(--forum-sunken); border-color: var(--forum-border); }
.forum-btn:active:not(:disabled) { transform: translateY(1px); }
.forum-btn:disabled { opacity: .5; cursor: not-allowed; }
.forum-btn.forum-ghost { border-color: transparent; background: transparent; color: var(--forum-secondary); }
.forum-btn.forum-ghost:hover:not(:disabled) { background: var(--forum-sunken); color: var(--forum-text); }
.forum-btn.forum-primary {
  border-color: var(--forum-ink);
  background: var(--forum-ink);
  color: var(--forum-ink-fg);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-btn.forum-primary:hover:not(:disabled) {
  border-color: var(--forum-ink-hover);
  background: var(--forum-ink-hover);
  box-shadow: var(--dsw-shadow-lv2);
}
.forum-cta { height: 40px; padding: 0 17px; border-radius: 10px; font-size: 13px; font-weight: 600; }
.forum-wide { width: 100%; }
.forum-icon-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--forum-muted);
  cursor: pointer;
  transition: background .14s ease, color .14s ease;
}
.forum-icon-btn:hover { background: var(--forum-sunken); color: var(--forum-text); }
.forum-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--forum-accent);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.forum-link:hover { text-decoration: underline; }

/* ---------- empty, skeleton, banner ---------- */
.forum-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 620px;
  margin: 18px auto;
  padding: 48px 30px;
  border: 1px solid var(--forum-border-soft);
  border-radius: 18px;
  background: linear-gradient(180deg, var(--forum-surface), color-mix(in srgb, var(--forum-surface) 55%, var(--forum-canvas)));
  box-shadow: var(--dsw-shadow-lv1);
  text-align: center;
}
.forum-empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 15px;
  border-radius: 18px;
  background: linear-gradient(145deg, var(--forum-accent-soft), color-mix(in srgb, var(--forum-accent-soft) 45%, var(--forum-surface)));
  color: var(--forum-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--forum-accent) 12%, transparent);
}
.forum-empty h3 { margin: 0 0 6px; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.forum-empty p { max-width: 390px; margin: 0 0 18px; color: var(--forum-secondary); font-size: 12.5px; line-height: 1.7; }
.forum-empty-sm { max-width: none; margin: 0; padding: 24px; gap: 10px; border-style: solid; background: transparent; }
.forum-empty-sm h3 { margin: 0; font-size: 13px; font-weight: 550; color: var(--forum-secondary); }
.forum-skeleton {
  height: 128px;
  border: 1px solid var(--forum-border-soft);
  border-radius: 16px;
  background: linear-gradient(100deg, var(--forum-surface) 32%, var(--forum-sunken) 50%, var(--forum-surface) 68%);
  background-size: 220% 100%;
  animation: forum-shimmer 1.4s linear infinite;
}
.forum-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 13px;
  border: 1px solid color-mix(in srgb, var(--forum-danger) 22%, transparent);
  border-radius: 11px;
  background: var(--forum-danger-soft);
  color: var(--forum-danger);
  font-size: 12px;
}

/* ---------- thread ---------- */
.forum-thread { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px; }
.forum-back { align-self: flex-start; padding-left: 6px; }
.forum-thread-card { padding: 22px 24px 16px; }
.forum-thread-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.forum-thread-head h2 {
  margin: 0 0 10px;
  font-size: 21px;
  line-height: 1.35;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.forum-thread-body {
  margin: 12px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--forum-border-soft);
  font-size: 14px;
  line-height: 1.85;
  white-space: pre-wrap;
  word-break: break-word;
}
.forum-thread-foot { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.forum-comments { display: flex; flex-direction: column; gap: 10px; }
.forum-section-head { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 2px; }
.forum-section-head h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--forum-secondary);
  font-size: 12px;
  font-weight: 650;
}
.forum-comment { display: flex; flex-direction: column; gap: 8px; padding: 15px 17px; }
.forum-comment.is-nested { background: transparent; box-shadow: none; }
.forum-comment-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.forum-comment-head strong { font-weight: 650; }
.forum-body { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
.forum-replies {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding-left: 13px;
  border-left: 2px solid var(--forum-border-soft);
}

/* ---------- side cards ---------- */
.forum-side-card { overflow: hidden; border: 1px solid var(--forum-border-soft); border-radius: 16px; background: var(--forum-surface); box-shadow: var(--dsw-shadow-lv1); }
.forum-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 13px 15px;
  border: none;
  background: none;
  color: var(--forum-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.forum-card-head:hover { background: var(--forum-sunken); }
.forum-card-head .forum-card-title { margin: 0; font-size: 13px; font-weight: 650; }
.forum-card-head .forum-chevron { margin-left: auto; }
.forum-chevron { color: var(--forum-muted); transition: transform .18s ease; }
.forum-card-head[aria-expanded='false'] .forum-chevron { transform: rotate(-90deg); }
.forum-card-body { display: flex; flex-direction: column; gap: 10px; padding: 2px 15px 15px; }
.forum-side-hint { margin: 0; color: var(--forum-muted); font-size: 11.5px; line-height: 1.65; }
.forum-status {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--forum-sunken);
  color: var(--forum-muted);
  font-size: 10px;
  font-weight: 650;
}
.forum-status.is-on { background: var(--forum-success-soft); color: var(--forum-success); }

/* notifications */
.forum-notif-list { display: flex; flex-direction: column; }
.forum-notif { display: flex; flex-direction: column; gap: 5px; padding: 10px 0; border-top: 1px solid var(--forum-border-soft); }
.forum-notif:first-child { border-top: none; padding-top: 2px; }
.forum-notif p { margin: 0; font-size: 12px; line-height: 1.55; }
.forum-notif-meta { display: flex; align-items: center; gap: 6px; color: var(--forum-muted); font-size: 10.5px; }
.forum-reason {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--forum-accent-soft);
  color: var(--forum-accent);
  font-size: 10px;
  font-weight: 650;
}
.forum-reason.is-reply { background: var(--forum-sunken); color: var(--forum-secondary); }

/* auto-post */
.forum-auto-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--forum-border-soft); }
.forum-auto-row:first-of-type { border-top: none; padding-top: 2px; }
.forum-auto-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.forum-auto-name { overflow: hidden; font-size: 12.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.forum-auto-note { color: var(--forum-muted); font-size: 10.5px; }
.forum-auto-min { width: 54px; height: 28px; flex: 0 0 54px; padding: 0 6px; text-align: center; font-size: 11.5px; border-radius: 8px; }
.forum-switch { position: relative; display: inline-flex; flex: 0 0 34px; width: 34px; height: 20px; cursor: pointer; }
.forum-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.forum-switch-track { position: relative; width: 100%; height: 100%; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); transition: background .16s ease; }
.forum-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .28);
  transition: transform .16s ease;
}
.forum-switch input:checked + .forum-switch-track { background: var(--forum-accent); }
.forum-switch input:checked + .forum-switch-track::after { transform: translateX(14px); }
.forum-switch input:focus-visible + .forum-switch-track { outline: 2px solid var(--forum-accent); outline-offset: 2px; }

/* ---------- modal ---------- */
.forum-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #000 42%, transparent);
  backdrop-filter: blur(5px);
  animation: forum-fade .16s ease-out;
}
.forum-modal {
  width: min(620px, 100%);
  max-height: min(88vh, 900px);
  overflow-y: auto;
  border: 1px solid var(--forum-border-soft);
  border-radius: 20px;
  background: var(--forum-surface);
  box-shadow: var(--dsw-shadow-lv3);
  animation: forum-pop .2s cubic-bezier(.2, .8, .2, 1);
}
.forum-modal-head { display: flex; align-items: flex-start; gap: 18px; padding: 22px 24px 0; }
.forum-modal-head h2 { margin: 0; font-size: 19px; line-height: 1.3; font-weight: 700; letter-spacing: -0.02em; }
.forum-modal-head p { margin: 5px 0 0; color: var(--forum-secondary); font-size: 12px; line-height: 1.6; }
.forum-modal-head .forum-icon-btn { margin-left: auto; }
.forum-form { display: flex; flex-direction: column; }
.forum-modal-body { display: flex; flex-direction: column; gap: 15px; padding: 18px 24px 6px; }
.forum-modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px 22px;
}
.forum-modal-foot .forum-muted { overflow: hidden; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.forum-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.forum-label { color: var(--forum-secondary); font-size: 11.5px; font-weight: 600; }
.forum-input, .forum-textarea, .forum-select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--forum-border);
  border-radius: 10px;
  background: var(--forum-surface);
  color: var(--forum-text);
  font: inherit;
  font-size: 13px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.forum-input::placeholder, .forum-textarea::placeholder { color: var(--forum-muted); }
.forum-input:focus, .forum-textarea:focus, .forum-select:focus {
  outline: none;
  border-color: var(--forum-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--forum-accent) 16%, transparent);
}
.forum-textarea { min-height: 120px; line-height: 1.75; resize: vertical; }
.forum-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.forum-seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--forum-sunken); width: fit-content; }
.forum-seg-btn {
  padding: 7px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--forum-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background .14s ease, color .14s ease, box-shadow .14s ease;
}
.forum-seg-btn:hover { color: var(--forum-text); }
.forum-seg-btn[aria-pressed='true'] {
  background: var(--forum-surface);
  color: var(--forum-text);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-form-error { margin: 0; color: var(--forum-danger); font-size: 11.5px; line-height: 1.5; }
.forum-muted { color: var(--forum-muted); font-size: 12px; }
.forum-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

/* ---------- toasts ---------- */
.forum-toasts {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 9px;
  pointer-events: none;
}
.forum-toast {
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 380px;
  padding: 11px 14px;
  border-radius: 12px;
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  box-shadow: var(--dsw-shadow-lv3);
  font-size: 12px;
  line-height: 1.45;
  animation: forum-toast-in .24s cubic-bezier(.2, .8, .2, 1);
}
.forum-toast span:last-child { overflow-wrap: anywhere; }
.forum-toast-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 50%; }
.forum-toast.is-success .forum-toast-icon { background: color-mix(in srgb, #22c55e 24%, transparent); color: #4ed17e; }
.forum-toast.is-error .forum-toast-icon { background: color-mix(in srgb, #ec1313 28%, transparent); color: #ff8080; }

@keyframes forum-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes forum-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes forum-pop { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes forum-toast-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

@media (max-width: 1120px) {
  .forum-header, .forum-boardbar, .forum-layout { padding-left: 24px; padding-right: 24px; }
  .forum-layout { grid-template-columns: minmax(0, 1fr); }
  .forum-page { overflow-y: auto; }
  .forum-main, .forum-side { overflow: visible; }
}
@media (prefers-reduced-motion: reduce) {
  .forum-page *, .forum-page *::before, .forum-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 * @param ctx - the plugin's client context, whose effect owns the element.
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
