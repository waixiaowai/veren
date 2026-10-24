/**
 * The forum page's overlay styles: the centered modal and its form fields,
 * the toast stack, the shared keyframes, and the responsive/motion media
 * queries.
 *
 * 论坛页面的浮层样式：居中模态框及其表单字段、提示堆栈、共享关键帧，以及响应式与
 * 动效媒体查询。
 *
 * @module @veren/forum-ui/client/styles-overlays
 */

/** Overlay slice: modal shell and form fields. 浮层片段：模态框外壳与表单字段。 */
export const OVERLAY_CSS = `
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
`

/** Overlay slice: toasts, keyframes, and the media queries. 浮层片段：提示、关键帧与媒体查询。 */
export const TOASTS_CSS = `
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
  .forum-page { overflow-y: auto; }
  .forum-main { overflow: visible; }
}
@media (prefers-reduced-motion: reduce) {
  .forum-page *, .forum-page *::before, .forum-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`
