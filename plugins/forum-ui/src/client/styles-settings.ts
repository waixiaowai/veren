/**
 * The forum page's settings-view styles: the second-level config page
 * container, the collapsible side cards, the notification list, and the
 * auto-post rows with their switches.
 *
 * 论坛页面配置视图的样式：二级配置页容器、可折叠侧卡片、通知列表，以及带开关的
 * 自动发帖行。
 *
 * @module @veren/forum-ui/client/styles-settings
 */

/** Settings slice: the config page container. 配置片段：配置页容器。 */
export const CONFIG_CSS = `
/* ---------- second-level settings page ---------- */
.forum-config {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
  padding-bottom: 12px;
}
.forum-config-head { display: flex; flex-direction: column; gap: 3px; margin-bottom: 2px; }
.forum-config-title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.015em; }
.forum-config-subtitle { margin: 0; color: var(--forum-secondary); font-size: 12px; }
.forum-config .forum-side-card { flex: 0 0 auto; }
`

/** Settings slice: side cards, notifications, auto-post rows. 配置片段：侧卡片、通知与自动发帖行。 */
export const SIDE_CARDS_CSS = `
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
`
