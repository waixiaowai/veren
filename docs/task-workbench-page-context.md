# Task Workbench page context: byte-level spec and live measurement (2026-10-29)

English | [中文](task-workbench-page-context.cn.md)

**This document answers one question: in a task-workbench page session, what does the model actually receive, which sentence does the work, and where are the empty promises?**

Every number here is reproducible with the single command at the end ("Recompute"); a number that command cannot produce does not belong in this document.

---

## 0. Summary

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | The **first user message of a page session is the PAGE block**: 63 of 64 page sessions carried no human instruction at all — the model starts working on arrival. | measured, `logsScanned=658` |
| 2 | Of those 63 instruction-free sessions, **29 fired a tool on the first turn and 10 changed task state on the first turn** (take/complete). | measured, filtered by `source.kind=app/page` |
| 3 | The one load-bearing sentence is the **conditional wording**: the generation whose note says "盘点/询问/查看类请求不接取" (G4) shows 7 sessions with zero overreach; the other 56 instruction-free sessions account for all 10 overreaches. | wording generations, §3 |
| 4 | An **incomplete PAGE skeleton is the norm, not the exception**: across 64 sessions, map line 47, tools line 50, app note 41, page note 52. | measured; the 12 `task-workbench/task` blocks carry no note line at all |
| 5 | A session **repeats the same block**: 7 sessions re-sent the PAGE block, 6 of them byte-identical, up to 7 times; median block length 871 chars. | measured |
| 6 | The **page-identity block covers only 10 of 64 sessions** (after 2026-10-25); the earlier 54 sessions had no identity layer at all. | measured + [session-port.ts:218](../plugins/app-host/src/session-port.ts#L218) |
| 7 | Inside a page session, **this app's own tools are 4.8% of the tool schema** in aggregate (5.3% median per session); the schema itself is 10.4 KB median, 48 KB max. | measured from `request/header` |

---

## 1. From session creation to the first model request

The order is fixed, and both sources and sizes are measured (sample session `0151fe6e`, list page):

| # | Kind | Source kind | Measured chars | Written by |
| --- | --- | --- | --- | --- |
| 1 | system prompt | `system-prompt` | 2746 | host composition (persona + tool notes + runtime sections) |
| 2 | user message | `app/page` | 879 | page-registry's `componentPageBlock` |
| 3 | user message | `runtime-context` | 786 | the system-prompt runtime snapshot; **the page identity lives here** |
| 4 | request header | `request/header` | 6241 (44 tools) | the agent loop; `tools` is the tool face the model sees |
| then | `skill-catalog` / `time-context` / `page/data` / `page/send` / `task-center/notice` | their own sources | median 6.6 KB / 258 / 365 / 181 / 209 | per-plugin, per-turn |

Three facts to keep:

1. **The identity is not in the PAGE block.** `app-host` registers it into the system prompt on `agent/created` ([session-port.ts:200-232](../plugins/app-host/src/session-port.ts#L200)), and it finally merges into the `runtime-context` user message. "What the block says" and "what the model is made to believe" are two separate texts.
2. **The tool face is not decided by source comments.** What the code `register`s and what `request/header.tools` contains are two facts; page scope additionally applies `restrict({ deny: ['app_open','app_list','app_pages'] })`.
3. **The PAGE block is written once**; later task changes are never pushed back. `TaskStore` implements `subscribe`, and **nothing in the repository consumes it** ([store.ts:110](../plugins/task-workbench/src/store.ts#L110) defines it, zero callers). The header comment's "subscribable, for page-mount sync" is an expired promise.

---

## 2. What the PAGE block actually contains

`componentPageBlock` ([runtime.ts:222](../plugins/page-registry/src/runtime.ts#L222)) assembles it line by line:

```text
PAGE task-workbench/list /apps/task-workbench/list        ← locator: params already substituted into the url
map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）
- /apps/task-workbench/task/:taskId → 任务详情页：…        ← sibling pages, registration order, self excluded
- /apps/task-workbench/publish → 发布任务页：…
tools: task_workbench__list_tasks（只读盘点：…）、…        ← the real registration delta, description first sentence capped at 60
应用说明：…                                              ← the app definition's instructions
说明：…                                                  ← the page meta's instructions
# 任务工作台 · 任务列表                                    ← the component-rendered Markdown body
open 5 · taken 0 · done 0。…
- **t-1** 示例任务 1（open · 子树进度 0/1）
> 正文是打开时刻的首屏快照；此后任务的变化以工具调用的结果为准。
```

Three traps where something looks derived but is actually fixed copy:

- The `map` **header line** is one **fixed Chinese sentence** (the `MAP_HEADER` constant); what is derived is each following line.
- The `tools` line takes only the first sentence of `description`, capped at 60 chars — the package's 8 tool descriptions total 1196 chars and land in the block as roughly 200.
- The body's `t-1 … t-5` come from an **in-process store** (`makeList(config.listSize)`); they share no id namespace with the host task center's `task-*`. The detail note already says delivered tasks are not in the local list and the body honestly renders "不存在".

---

## 3. Wording generations and autonomous overreach (the measured verdict on the load-bearing sentence)

Splitting the 63 instruction-free sessions into 6 generations by a marker sentence in the page note, and counting "did the first turn write state":

| Generation | Marker | Sessions | Fired a tool | Wrote state |
| --- | --- | --- | --- | --- |
| G0 no note | (no `说明：` line in the block) | 12 | 0 | 0 |
| G1 imperative | `接取用 take_task` / `用 take_task 接取 open` | 6 | 6 | **2** |
| G2 live sync | `SNAPSHOT/PATCH` or `PAGE-PATCH` | 5 | 5 | **2** |
| G3 detail "someone delivered to this page" | `有人把任务投给本页时` | 21 | 9 | **6** |
| G4 conditional | `查看类请求不接取` / `类请求用 list_tasks 直接回答` | 7 | 7 | **0** |
| G5 other | — | 12 | 2 | 0 |

The limits of this measurement must be stated:

- **Correlation is not causation.** All 21 G3 sessions are detail pages and G4 spans 1 detail + 6 list sessions; page archetype and wording changed together in history, so this sample cannot separate them. Separating them requires an **ablation**: same page, only that sentence changed, fresh page, read the first turn (§5).
- G0's 12 sessions carry the page key `task-workbench/task`, which is **not one of today's three pages** (`list`/`detail`/`publish`) — they are blocks left by a historical probe page. Mixing them into today's table would corrupt the metric, so they are broken out.
- The overreach is not random: 3 sessions each took 5 tasks in one turn — `接取用 take_task` reads as "go take them".

---

## 4. Promise / fact reconciliation

| Promise (text) | Location | Fact | Verdict |
| --- | --- | --- | --- |
| "Active branches render expanded by default" | [pages.tsx:88](../plugins/task-workbench/src/pages.tsx#L88) `expandHint` | `subtaskTree` computes `expanded`, the render body never reads it; `SubtaskRow` has no consumer either | **empty promise** |
| "store is subscribable, for page-mount sync" | [store.ts:2](../plugins/task-workbench/src/store.ts#L2) | `subscribe` has zero consumers; no PAGE-PATCH channel exists in this package | **expired comment** |
| The block always carries map / tools | §3.10.2 spec | measured 47/64 and 50/64 | **older versions did not comply** |
| Every page note is non-empty | registration rule 3 | 12 blocks carry no `说明：` line (the historical `task` page) | spec changed; old blocks are not rewritten |
| `PUBLISH_TASK_REQUIRES` declares the publish capability | [app.ts:118](../plugins/task-workbench/src/app.ts#L118) | defined, never referenced; `requires` is "recorded, not enforced" per [bootstrap-tools.ts:8](../plugins/app-registry/src/bootstrap-tools.ts#L8) | **declaration without a consumer** |
| `TaskListItem` / `SubtaskRow` | [types.ts:42](../plugins/task-workbench/src/types.ts#L42), [types.ts:59](../plugins/task-workbench/src/types.ts#L59) | each appears exactly once, at its definition | **dead types** |
| `entryUrlOf` exported for the app dropdown / task notices | [actions.ts:38](../plugins/task-workbench/src/actions.ts#L38) | only re-exported in app.ts, never called | **dead export** |
| Single authoritative `APP_ID` | [pages.tsx:102](../plugins/task-workbench/src/pages.tsx#L102) vs [app.ts:29](../plugins/task-workbench/src/app.ts#L29) | two independent declarations (one branded, one bare string) | **double source** |
| Eight tools | `createAppTools` | the README tool table lists 6 (missing `list_tasks`/`get_page_task`) | **doc drift** |
| The note names `task/already-taken`, `task/subtree-limit` | [pages.tsx:216](../plugins/task-workbench/src/pages.tsx#L216), [actions.ts:135](../plugins/task-workbench/src/actions.ts#L135) | the former really comes from `takePageTask`; the latter comes from the task center and is passed through | holds |
| The note says completion rides `task_complete`/`task_fail` | [pages.tsx:224](../plugins/task-workbench/src/pages.tsx#L224) | both tools exist in the page session's tool face | holds (but see the cost in §6) |

---

## 5. The one load-bearing sentence, and how to prove it

**Hypothesis**: the two G4 sentences ("只读盘点、询问类请求用 `list_tasks` 直接回答，不要改动任何任务状态" / "盘点、询问、查看类请求不接取、不改动任务，直接用 `get_page_task` 读取后回答") are why the first turn does not overreach.

**Ablation (under 30 minutes, on the stable test node)**:

1. Delete that sentence in [pages.tsx](../plugins/task-workbench/src/pages.tsx), keeping every other character;
2. `pnpm --dir deepseek\deepseek-harness run dev:web -- --port 3080 --no-open`;
3. Open `/apps/task-workbench/list` and `/apps/task-workbench/task/t-1`, **send nothing**;
4. `node scripts/audit-page-context.mjs --json`, then read `writeOnFirstTurn` for the new sessions;
5. Verdict "no": any new session fires `take_*`/`complete_task` on turn one. Verdict "yes": three fresh opens per page with zero write tools.

Why not do it right now: that wording is the only generation with a zero-overreach record, so it must not be removed before a replacement exists. This document supplies the verdict procedure, not the edit.

---

## 6. Cost account (measured, not estimated)

| Item | Median | Max | Note |
| --- | --- | --- | --- |
| Tool schema chars | 10,432 | 48,295 | sent on every request; this app owns 4.8% in aggregate (5.3% per-session median) |
| PAGE block chars | 871 | 1323 | once per session; up to 7 times in a repeating session |
| `skill-catalog` | 6,558 | — | 11 messages, mostly the tool-skill catalog |
| `runtime-context` | 816 | — | 69 messages, page identity included |
| This app's tool schema | 554 | 1601 | 8 tools, median 2 mounted per page |

Two consequences:

- **Adding a tool to a page is among the cheapest context changes** (own tools are ~5% of the schema), while **adding a sentence to a note is among the most expensive** (every character enters the block and repeats with the session).
- The `task_*` tools are a **cross-app face** in task-workbench page sessions (they belong to the task center); they take a large share of the schema while being weakly related to "handle this one task". That is the one place where the money is saved by changing the tool face rather than the prose.

---

## 7. Recompute

```bash
# both homes (test environment + production, the latter read-only)
node scripts/audit-page-context.mjs

# one home, machine-readable
node scripts/audit-page-context.mjs --home deepseek/.dsh --json

# metric self-proof (synthetic logs, never reads a real home)
pnpm check:gate-selftest
```

Every verdict function lives under `scripts/audit/` and is pure: `zstd-frames.mjs` (multi-frame decoding), `page-block.mjs` (block parsing), `observe.mjs` (observation and aggregation). Changing a metric means changing those three plus their spec; the CLI does not move.

**Two traps you must know**:

1. Session logs are **multi-frame** zstd: a single `zstdDecompressSync` decodes only the first frame, so reading them naively yields the false conclusion "zero PAGE blocks" (the first pass of this measurement fell into exactly that).
2. Each PAGE block appears **twice** in the log: as `user/message` (`source.kind=app/page`) and inside `agent/inbox/spliced.inserted`. Count only the former or the block count doubles.
