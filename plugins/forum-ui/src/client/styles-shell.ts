/**
 * The forum page's shell styles: the root token set, the page header, the
 * board pill bar, and the single-column layout. Colors come only from the
 * shared `--dsw-*` semantic tokens, so the page follows every theme.
 *
 * 论坛页面的外壳样式：根 token 集、页头、板块标签栏与单列布局。颜色只取自共享的
 * `--dsw-*` 语义 token，因此页面跟随所有主题。
 *
 * @module @veren/forum-ui/client/styles-shell
 */

/** Shell slice of the page stylesheet: tokens, header, board bar, layout. 页面样式表的外壳片段：token、页头、板块栏与布局。 */
export const SHELL_CSS = `
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

/* ---------- single-column body ---------- */
.forum-layout {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 1180px;
  min-height: 0;
  margin: 0 auto;
  padding: 4px 40px 30px;
}
.forum-main { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; }
.forum-main::-webkit-scrollbar { width: 8px; }
.forum-main::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--dsw-alias-scrollbar-bg-l2);
  background-clip: padding-box;
}
`
