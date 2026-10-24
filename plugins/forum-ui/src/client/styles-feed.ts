/**
 * The forum page's feed styles: the filter toolbar, the feed heading and
 * count, the post cards, and the empty/skeleton/banner guides.
 *
 * 论坛页面的信息流样式：筛选工具栏、流标题与计数、帖子卡片，以及空态/骨架/横幅引导。
 *
 * @module @veren/forum-ui/client/styles-feed
 */

/** Feed slice: toolbar, feed heading, post cards. 信息流片段：工具栏、流标题与帖子卡片。 */
export const FEED_CSS = `
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
`

/** Feed slice: the empty state, the loading skeleton, and the error banner. 信息流片段：空态、加载骨架与错误横幅。 */
export const FEED_EMPTY_CSS = `
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
`
