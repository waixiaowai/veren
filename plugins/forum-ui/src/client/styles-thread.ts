/**
 * The forum page's thread styles: the thread card, the flattened comment
 * tree, and the nested reply rail.
 *
 * 论坛页面的讨论串样式：主题卡片、展平的评论树与嵌套回复栏。
 *
 * @module @veren/forum-ui/client/styles-thread
 */

/** Thread slice: thread card and comment tree. 讨论串片段：主题卡片与评论树。 */
export const THREAD_CSS = `
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
`
