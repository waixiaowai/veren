/**
 * The forum page's shared control styles: chips and avatars, the vote pair,
 * and the button family (regular, ghost, primary, CTA, wide, icon, link).
 *
 * 论坛页面的共享控件样式：标签与头像、投票对，以及按钮族（常规、幽灵、主按钮、CTA、
 * 通栏、图标、链接）。
 *
 * @module @veren/forum-ui/client/styles-controls
 */

/** Controls slice: chips, avatars, votes, buttons. 控件片段：标签、头像、投票与按钮。 */
export const CONTROLS_CSS = `
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
`
