/**
 * The wide-screen layout styles: the two rails (boards + community) and the
 * container-query tiers that put them beside the feed. Queries run against the
 * page's own width — not the viewport — so the layout adapts to the space the
 * host actually gives the page, sidebar and chat panel included. Everything
 * lives inside `@container` blocks: a runtime without container queries simply
 * keeps the narrow single-column shell.
 *
 * 宽屏布局样式：两侧栏（板块栏 + 社区栏）与把它们排到信息流旁边的容器查询档位。
 * 查询针对页面自身宽度而非视口，因此布局适配宿主实际给页面的空间（含侧边导航与聊天面板）。
 * 所有增强都在 `@container` 块内：不支持容器查询的运行时直接保持窄屏单列外壳。
 *
 * @module @veren/forum-ui/client/styles-rail
 */

/** Rail slice: rails, side cards, and the wide layout tiers. 栏目片段：两侧栏、侧卡与宽屏档位。 */
export const RAIL_CSS = `
/* ---------- rails (hidden until the container is wide) ---------- */
.forum-rail { display: none; min-height: 0; }
.forum-rail-label {
  margin: 2px 0 8px;
  padding-left: 12px;
  color: var(--forum-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.forum-rail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--forum-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease;
}
.forum-rail-item:hover {
  border-color: var(--forum-border-soft);
  background: var(--forum-surface);
  color: var(--forum-text);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-rail-item[aria-selected='true'] {
  background: var(--forum-ink);
  color: var(--forum-ink-fg);
  box-shadow: var(--dsw-shadow-lv2);
}
.forum-rail-item-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.forum-rail-count {
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
.forum-rail-item[aria-selected='true'] .forum-rail-count {
  background: color-mix(in srgb, var(--forum-ink-fg) 18%, transparent);
  color: inherit;
}

/* ---------- community side cards ---------- */
.forum-side-card {
  padding: 15px 16px 16px;
  border: 1px solid var(--forum-border-soft);
  border-radius: 16px;
  background: var(--forum-surface);
  box-shadow: var(--dsw-shadow-lv1);
}
.forum-side-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: var(--forum-secondary);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: .01em;
}
.forum-side-title::before {
  content: '';
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--forum-accent);
}
.forum-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.forum-stat-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px 8px;
  border-radius: 10px;
  background: var(--forum-sunken);
}
.forum-stat-value { color: var(--forum-text); font-size: 16px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.forum-stat-label { color: var(--forum-muted); font-size: 10.5px; }
.forum-side-hint { margin: 0; color: var(--forum-muted); font-size: 11.5px; line-height: 1.6; }
.forum-tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
.forum-tag-chip {
  height: 26px;
  padding: 0 11px;
  border: 1px solid var(--forum-border-soft);
  border-radius: 999px;
  background: var(--forum-surface);
  color: var(--forum-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.forum-tag-chip:hover { border-color: var(--forum-accent); color: var(--forum-accent); }
.forum-tag-chip.is-active { border-color: transparent; background: var(--forum-accent-soft); color: var(--forum-accent); }
.forum-people { display: flex; flex-direction: column; gap: 2px; }
.forum-person {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 9px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background .14s ease;
}
.forum-person:hover { background: var(--forum-sunken); }
.forum-person-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--forum-text);
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-person-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--forum-accent-soft);
  color: var(--forum-accent);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}

/* ---------- wide tiers ---------- */
/* Two tiers: >=1160px the boards rail joins (pill bar retires); >=1500px the
   community rail joins too. Both read the page container, not the viewport. */
/* 两个档位：容器 >=1160px 板块栏加入（胶囊栏退场）；>=1500px 社区栏也加入。
   两者都读页面容器，而不是视口。 */
@container forum (min-width: 1160px) {
  .forum-shell { grid-template-columns: 232px minmax(0, 1fr); column-gap: 28px; }
  .forum-rail-boards { display: flex; flex-direction: column; overflow-y: auto; padding-bottom: 8px; scrollbar-width: none; }
  .forum-rail-boards::-webkit-scrollbar { display: none; }
  .forum-boardbar { display: none; }
}
@container forum (min-width: 1500px) {
  .forum-shell { grid-template-columns: 232px minmax(0, 1fr) 300px; }
  .forum-rail-side { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; padding-bottom: 8px; }
}
`
