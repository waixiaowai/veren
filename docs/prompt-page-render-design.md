# PAGE Block Render-Face Redesign: WYSIWYG JSX (HTML Vocabulary → Markdown) + Direct cordis Calls

- Status: RFC v2 (converged 2026-10-21; draft, not implemented)
- Scope: `@veren/prompt-core`, `@veren/prompt-page`, `plugins/page-registry`, the exemplar plugin (the three task-center pages in Appendix A)
- Related: `docs/application-concept.cn.md` (§3.9/§3.10 page-spec numbering and semantics follow that document)

## 0. TL;DR

1. **WYSIWYG**: the page component IS the PAGE block's single render face. What you write top to bottom is what the model reads top to bottom; React's readability never came from writing less — it comes from "what you write is what renders".
2. **The vocabulary is the full HTML tag set; the render target is Markdown.** React's primitives were always HTML tags; here the output domain is Markdown, so: primitives = HTML tags (the full set, unknown tags degrade transparently), the renderer = one fixed HTML→Markdown mapping table (§3.2). **Built-in special components = 0**.
3. **Full language, always open**: `.map()`, ternaries, `&&`, optional chaining and template literals go directly into JSX.
4. **A minimal view-hook face**: `useState / useMemo / useSnapshot / useContext` (things needing slot/stack bookkeeping are called hooks); effects and subscriptions get **no hooks** — direct `ctx.effect` / `ctx.on` calls in the component body (recorded by the scheduler during render, §5.3).
5. **Dynamically generated tools**: components call `ctx.tools.register(defineTool(…))` within the page session's scope (a native dsh-tools API — scoped tools shadow globals); dispatch/approval/result projection ride the host's existing `tools/*` pipeline (§5.4).
6. **The lifecycle is events**: two notify events, `page:ready` / `page:dispose`, on pageCtx (§5.5); listeners are cleaned up automatically with the session.
7. **The integration face reuses existing services throughout** (§3.5): registration via `apps.register` / `apps.pages(id).register` / `apps.tools(id).define` (this proposal only extends pages.register to accept PageFC components); cross-session notification via `pageRegistry.deliverUrl` (delivery creates-or-wakes the session); tools via `ToolDefinition` (§5.4). The invented router/messages/tools facades are all withdrawn.
8. **Two domain-specific decisions**: change means patch — changed element subtrees render as Markdown appended to history in a `PAGE-PATCH` block (the key does position matching, §A.6); the first screen's only legal data source is `load` (an empty-then-filled document misleads a model reader).
9. **Reuse first**: effects, events, teardown and injection all reuse existing cordis facilities; the only new machinery is fiber slot bookkeeping, falsy normalization, the Markdown serializer and the context stack — four items.

## 1. Background and Diagnosis

The old shape (`defineAppPage` + `tree` + `Static/Data/Keyed`) cannot tell you what the model reads. Three breaks:

1. **Primitives speak the engine dialect**: `Static/Data/Keyed` are diff bookkeeping types, not document vocabulary;
2. **Half the document is not in the JSX**: the PAGE block's header lines (params/data/map/tools/notes) are assembled by `pageBlock()` in another package;
3. **The final text sits behind two serializers**: you must mentally run `pageBlock()` + `renderSync()` across two packages.

## 2. Decision Record: Rejected Directions

- **D1 (rejected) Config-ification**: dropping JSX, pages as pure configuration. It optimized "readability" into "writing less"; the reader still simulates assembly in their head.
- **D2 (rejected) Closed row components**: `<Rows items={...}>` hides the projection inside a component — the same disease as the old `Keyed`.
- **D3 (rejected) A home-grown document-dialect component set**: the intermediate `PageBlock/Section/Notes/Field/Collection/Row/Map/Unavailable` vocabulary — still a new dialect to learn, still adds a built-in surface, violating "minimize built-in special components". Replaced by **the full HTML set + a Markdown mapping**: authors use vocabulary all humans already know; the framework ships zero special components.

## 3. Target Design

### 3.1 Four Principles

1. The component is the PAGE block's single render face (write-once semantics and the §3.10.2 canonical shape unchanged; the header assembly point stays in the framework);
2. The vocabulary is the full HTML set (the native words of the Markdown output domain); the mechanism hides inside the renderer;
3. Full language × zero built-in components;
4. Reuse first: anything cordis already has (effects/events/lifecycle/injection) is never rebuilt.

### 3.2 HTML → Markdown Mapping (the render contract)

| HTML | Markdown | Notes |
| --- | --- | --- |
| `h1`–`h6` | `#`–`######` | |
| `p` | paragraph (blank-line separated) | |
| `ul` / `ol` / `li` | `-` / `1.` (nesting indents) | a `key` on `li` = the splice bookkeeping unit |
| `table` `thead` `tbody` `tr` `th` `td` | GFM table (first row = header) | a `key` on `tr` = the row-level unit |
| `a[href]` | `[text](href)` | in-app hrefs share the map/URL source and are copy-usable |
| `strong`/`b` · `em`/`i` · `del` | `**` · `*` · `~~` | |
| `code` (inline) | backticks | |
| `pre > code` | fenced block ``` | |
| `blockquote` | `>` | |
| `hr` | `---` | |
| `br` | line break | |
| `div` `span` `section` `article` and other containers | transparent | render children only, produce no text |
| any unknown tag | transparent (policy slot) | `script`/`style` contents dropped |

Global rules: text nodes pass through (Markdown special characters escaped); "supports all HTML tags" = a **total function** — every tag has a definite rendering, unknown tags degrade to their children, nothing ever crashes. Text nodes are first-class (Markdown's primary carrier); escaping rules are covered by serializer tests.

### 3.3 PAGE Block Skeleton: the Framework Assembles the Header, the Component Renders the Body

```md
PAGE <app>.<page> <canonical-url>
map:（capability map…）        ← derived by the router from the registry (§3.5): sibling pages, one line each
tools: <dynamically mounted set> (when-to-use phrases)  ← the actual tools on pageCtx after commit (§5.4)
Notes: <meta.instructions>

<the component's rendered Markdown body>
```

The component owns the body; the framework assembles the header (`pageBlock()` narrows to header assembly + Markdown serialization). **No JSON in the header**: params are expressed by the URL itself (map templates name the parameters), and there is no data line — the meta.load result reaches the component via `useSnapshot()` and is rendered into the Markdown body; the body is the component's total-function output and is always present (the old "the data line is always present" invariant is now carried by the body), and when load throws the component receives the failure state and renders it honestly, with a framework-fallback failure blockquote if it does not. `meta.description` serves the app index / capability discovery (outside the session document) and does not enter the body.

### 3.4 Disposition of Each Definition/meta Field

| Field | Disposition | Rationale |
| --- | --- | --- |
| `url` / `description` | keep (registration, index, discovery) | metadata outside the session document |
| `load` | keep | the first screen's only legal data source; the result reaches the component via `useSnapshot()` and is rendered as Markdown (failure states included) |
| `instructions` | keep | assembled into the header by the framework |
| `map` | **removed — derived by the router from the registry** | the registry already holds every url template + description; hand-writing it is yet another dual-channel restatement (§3.5) |
| `tools` (static inventory) | keep in meta | the capability inventory: the market/permissions/discovery need a static face (§5.4 two faces) |
| `tree` / `instanceTitle` / per-page `tools` declaration | removed | replaced by components, `<h1>`, and `ctx.tools.register` |

### 3.5 Integration Face (North-Star Shape — Everything Reuses Existing DSH Service Faces)

Registration, tools, delivery and events are **all existing APIs** (`ctx.apps` registrars, `deliverUrl`, cordis `ctx.effect`/`ctx.on`); this proposal only adds "a page can be a component" as a registration signature plus the render-bookkeeping kernel (§7):

```tsx
export const inject = ['apps', 'pageRegistry'] as const

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps

  // One effect owns the wiring (G13 rule 3): definition → tools → pages, rolled back in reverse on failure
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) the app definition (existing face): id / name / description / entry / instructions
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) the tool catalog (existing face): ToolDefinition registered verbatim
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of collectAppTools(ctx)) done.push(tools.define(tool))
      // 3) page registration (existing entry; this proposal only extends: a page can be a
      //    PageFC component — the adapter wraps it into a PageDefinition; the page-registry
      //    mirroring is unchanged)
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(TaskListPage))
      done.push(pages.register(TaskNewPage))
      done.push(pages.register(TaskDetailPage))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'tasks-app:wire')

  // Data change → idempotent delivery by URL (the existing pageRegistry.deliverUrl path):
  // a live session at that URL gets the message appended and woken; none → a new page session
  // (first-frame rendering, tool mounting and PAGE-PATCH are all the session's own fixed behavior).
  // Notifications for non-page conversations ride the existing taskCenter.send inbox path.
  ctx.on('tasks/changed', async (p: { taskId: string }) => {
    await ctx.pageRegistry.deliverUrl(`/apps/tasks/${p.taskId}`, {
      message: `[tasks] 任务 ${p.taskId} 有更新，请查看最新状态`,
    })
  })
}
```

Decided semantics:

- **Delivery creates-or-wakes; no manual render**: `deliverUrl` appends to and wakes a live session, or creates a session for an absent URL — the new session's first-frame render, `ctx.tools.register` and diff patches are all the page session's fixed behavior. v1's "`{messages, tools}` hand-paired delivery" is withdrawn: injecting into non-page conversations rides the existing `taskCenter.send` inbox path;
- **Snapshot injection ≠ a live page session**: what `deliverUrl` delivers is a write-once message that does not follow updates; for follow-along, keep a live session at that URL;
- **The map is derived by the router; meta no longer has a map field**: the registry already contains every sibling page's url template and description — the framework generates the `map:` header lines at render time (all sibling pages of the app, excluding self, in registration order, `- template → description`), with the output format verbatim unchanged (the real-machine lesson was about the output format — the model needs copy-usable lines — not about hand maintenance). The mutual restatement of a hand-written map.use and descriptions dies with it; §3.10.1 rule 1 (the home page lists all record pages) turns from "a promise checked by lint" into "true by construction". Cross-app navigation goes through body `<a>` links and the host's app catalog, never the map.

## 4. Native Expressions: What Exists and What's Missing

Already supported on current source: `.map()` element arrays (beginWork normalization + Fragment), keyed matching and heterogeneous remount, the open host vocabulary (`HostKind = string`; unknown kinds ignored by the host = the policy slot).

Gaps: **G-A text nodes** (Markdown's primary carrier; bare interpolation `{t.title}` lands in a `text` block); **G-B falsy normalization** (`false`/`null`/`undefined` skipped at the reconcileChildren entrance).

## 5. View Hooks, Effects and Events

### 5.1 The View-Hook Face, and the Pain Each Piece Kills

| API | Purpose | Pain it kills |
| --- | --- | --- |
| `useState(initial)` | component-local state (fetch cache / view state) | a component can own its fetch mirror; re-renders ride the existing scheduler (positioning §5.2) |
| `useMemo(dep, compute)` | pure derivation | the standard answer for view-side derived data |
| `useSnapshot()` | read the render input (meta.load result / latest store state) | the typed channel between component and first screen |
| `useContext(Context)` | read the nearest Provider | host-to-component facts (e.g. URL params) |
| `ctx.effect(run, cleanup?)` | **replaces `useEffect`**: recorded during render (slot + call-order dedup), executed once after commit, cleanup in reverse at teardown. **No deps** (§5.3) | retires the `load`/`onLoad` double-write; registration/teardown with zero new machinery |
| `ctx.on(name, handler)` | **replaces `useEvent`**: recorded during render, cleaned up with the session | reactivity reuses the event bus, same spelling as lifecycle observers |

### 5.2 The Positioning of `useState` (revised 2026-10-21)

The initial "no useState" stance aimed at the wrong target: the typical state a page holds is a **local cache mirror of a ctx service** — a cache is not a second source of fact; the authoritative fact stays in the service layer (the React Query/SWR distinction). Revised: **provide it**, scoped to fetch caches and view state; "inventing facts" (numbers on the page that exist nowhere in the system) is caught by lint and review. Honest cost: manual fetches do not re-render on external changes (`useSnapshot` does). Layering: shared-store data via `useSnapshot`; one-off fetches / local view state via `useState` + `ctx.on` invalidation.

### 5.3 Effects and Events: Direct `ctx.effect` / `ctx.on`, Recorded During Render

No `useEffect`/`useEvent` are introduced. **Mechanism**: during render, calls to the two are recorded, not executed — into fiber slots, deduped by call order + argument identity (re-renders do not re-register); executed once after commit; cleanup in reverse at session teardown (the ctx.effect channel). A callback still in flight must not write state after the session died (unmounted guard).

**Decision: no deps overload** — the second parameter keeps its cordis meaning; "re-run on dependency change" is replaced by **re-mounting by key**, and reactive needs are expressed by `ctx.on` subscriptions (`useState` mirror + `ctx.on('tasks/changed', reload)` = event-driven invalidation).

**Two honest costs**: ① the call-order discipline returns under a new skin (we dropped the name, not the contract); ② lint must tell render-phase (recording) from apply-phase (immediate registration) scopes apart, leaning harder on component naming conventions than a plain hooks list.

**Domain guard**: pages are observe-only — subscribe only to emit/parallel-style notify events; never attach listeners on intercepting events (serial/bail/waterfall): a view must not influence host control flow.

### 5.4 Tools: `ctx.tools.register(defineTool(…))` — Zero New API (revised 2026-10-21)

Tools are generated dynamically by components — by registration time props/ctx are in the closure. **Both the builder and the registration reuse `@deepseek-ai/dsh-tools`**: `defineTool(options)` produces a registry-ready `ToolDefinition` (`InferArgs` derives `execute`'s args type from the parameter spec), and registration goes through `ctx.tools.register`:

```tsx
import { defineTool } from '@deepseek-ai/dsh-tools'

// Registered within the page session's agent scope — "Scoped tools shadow globals" is the
// registrar's documented native semantics
ctx.effect(() => ctx.tools.register(defineTool({
  name: 'task_take',
  description: '接取任务；taskId 取列表行首的编号',
  parameters: { taskId: { type: 'string' } },          // ParameterSchemaSpec → JSON Schema
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: async (args) => {                           // args typed via InferArgs — no `as` narrowing
    await ctx.tasks.take(args.taskId)
    reload()
    return `已接取 ${args.taskId}，责任人变更为当前用户`
  },
})))  // register returns the exact disposer → cleaned up in reverse via the ctx.effect channel
```

Three decisions:

1. **Registration is scoping**: `ctx.tools.register` registers in the calling agent's scope, and "Scoped tools shadow globals" is written in the registrar's docs — tool-scope exclusivity and tool removal on URL reopen (live-host checklist items 4/5) fall out for free; the returned exact disposer is cleaned up in reverse with the session via the ctx.effect channel; `ctx.tools.restrict` / `guard` come along as needed;
2. **Dispatch rides the host's existing `tools/*` pipeline**: `tools/pre-execute` (approvals/gates) → `tools/execute` (timeout/retry/metrics wrappers) → `tools/post-execute` (result policies) → `tools/result` (frozen-result notification) and `tools/change` (tool-set change notification, which the page's tools line exactly subscribes to) all exist;
3. **result → messages is the host pipeline's job**: the canonical value is projected to ContentBlocks via `output.render`, normalized by the registry, and logged by the agent loop — one tool_call maps to exactly one tool result, zero page-layer code.

**The static inventory and the dynamic instance are two faces**: meta declares the capability inventory (collectAppTools — market/permissions/discovery need a static face); what a page registers within its session scope is this session's instance. §3.9 alignment = comparing, after commit, the promise declared in JSX against the fact actually registered in that scope (`tools/change` is the source of fact).

### 5.5 Page Lifecycle Events

Declared on pageCtx via declaration merging as two notify events (`@mode: emit`):

| Event | Fired when | Legitimate observers |
| --- | --- | --- |
| `page:ready` | after meta.load completes and the first frame commits | session/app-level orchestration (delivery pumps, telemetry, notification injection) |
| `page:dispose` | when teardown begins, before cleanups run | same; the framework then runs all cleanups in reverse |

Only two: the patch cadence is internal to the rendering pipeline (no event); a failed load is data, not an event. **Two-layer division**: inside a component, "run once when ready" is written `ctx.effect(run)` (the component spelling of page:ready); the session layer orchestrates via the lifecycle events. Timing: at ready the first frame already has data — it is the live-refresh/orchestration starting point, not a first-screen fetch channel.

## 6. Domain-Specific Decisions (Where This Departs from React DOM)

1. **Change means patch: after a re-render, changed element subtrees become Markdown fragments appended to the session history as a `PAGE-PATCH` block.** React updates individual text nodes because pixels care; here the op count is the token budget. The key does position matching (the model updates its understanding of a row by its leading id) — it is not a patch gate; static content that never changes is naturally never patched. The delivery layer does this automatically, zero author code (§A.6).
2. **Single face**: children = the Markdown view, the only source of fact the model reads; `key` = bookkeeping. No JSON reconciliation line (v1's `data:` line is removed) — the body is the data, failure states included; the model's references to data come from the body it reads (e.g. `**T-1024**` at the head of a row), so the "read the body, cite the data" two-book problem cannot arise.
3. **Context implementation**: the render phase is synchronous, so a module-level stack suffices — none of React's concurrent-safety machinery.

## 7. Implementation Checklist

### prompt-core

- **C1** falsy normalization at the reconcileChildren entrance (G-B);
- **C2** hook slots: call-order-indexed on the fiber, persistent across renders + `ctx.effect`/`ctx.on` recording + a flush queue after commit (cleanup via the pageCtx.effect channel); the component's second `ctx` argument; naming that avoids the existing `Effect` (a document op);
- **C3** memo bailout × slots interaction (bail skips execution but keeps slots);
- **C4** the render-time context stack.

### prompt-page

- **C5** the full HTML host vocabulary + the **Markdown serializer** (the §3.2 table + escaping + text blocks) + the view hooks (`useState/useMemo/useSnapshot/useContext`) + the render-time recording semantics;
- **C6** the call-order lint (render-phase vs apply-phase scope detection via component naming heuristics).

### page-registry

- **C7** `pageBlock()` narrows to header assembly (no params/data JSON lines) + Markdown serialization (the §3.3 skeleton); `firstScreenData`'s failure states are delivered to the component instead (`useSnapshot()` receives them and renders Markdown), no longer assembled into a JSON line; the delivery layer serializes re-render diffs into `PAGE-PATCH` blocks appended to the session history (§A.6);
- **C8** zero new registration face: `apps.register` / `apps.pages(id).register` / `apps.tools(id).define` used as-is; only two additions — the adapter letting pages.register accept PageFC components (wrapped into a PageDefinition internally), and an optional "render snapshot to Markdown text" entry (for non-page-conversation injection; can be deferred, §3.5);
- **C9** dynamic tool registration, zero new API: `ctx.tools.register(defineTool(…))` used as-is (called in the session scope + reverse-order cleanup via the ctx.effect channel); dispatch/approval/result projection all ride the host's existing `tools/*` pipeline (§5.4).

### Test Bar

core concurrency safety ("a spec that only passes when run alone is a defect"), full-tag snapshot tests of the mapping table, memo/keys/HMR paths; the exemplar plugin through the real Loader composition (`packages/test-support/loader-smoke`).

## 8. Migration and Compatibility (Four Phases)

1. **Phase 1 (core machinery)**: C1–C4, zero behavior change;
2. **Phase 2 (vocabulary and integration face)**: C5–C6, C8–C9, old and new coexist;
3. **Phase 3 (exemplar migration)**: the three task-center pages (Appendix A) land, checked against §10;
4. **Phase 4 (retirement)**: `pageBlock()` switches to header assembly + Markdown; `Static/Data/Keyed` retire.

Compatibility promises: legacy `defineAppPage` keeps working during migration; metadata like `description`/`load`/`map` is untouched; §3.9/§3.10 checks keep their semantics.

## 9. Costs and Risks

- Core heart surgery: the reconciler is on the order of a hundred lines and bounded, but tests must land before the code;
- **The Markdown serializer is the new correctness-critical surface**: the mapping table + escaping + unknown-tag degradation need full-tag snapshot tests (the largest new test surface of the HTML-set approach);
- The call-order lint leans on naming conventions (§5.3 cost 2);
- The first-screen discipline (empty-then-filled two frames) must be emphasized repeatedly in the docs.

## 10. Acceptance Criteria

1. **WYSIWYG**: a new reader who has not read this RFC, given only the three components in Appendix A, can accurately restate every line the model sees;
2. **Built-in special components = 0**: the three demo pages use only HTML tags + the four view hooks + `ctx.effect`/`ctx.on`/`ctx.tools.register`;
3. Diff regression: unkeyed static skeletons never patched; keyed elements splice; token output does not degrade;
4. §3.9/§3.10 checks keep working; live-host checklist items 4/5/7 (tool-scope exclusivity, removal on reopen, capability-map citation) pass;
5. The event-driven injection scenario works: `ctx.on` → `await render` → `append(messages/tools)` arriving as a pair; pageCtx cleaned up with the session, no leaks.

## Appendix A: Page Implementation Demos (the three task-center pages)

> Illustrative implementation (not final code). Domain assumptions: `ctx.tasks` provides `list(status?)` / `get(id)` / `publish({title, desc?})` / `take(id)` / `complete(id, report)` / `abandon(id, reason)`; `Task = { id, title, state, assignee?, desc? }`.

### A.1 Task List (entry, `/apps/tasks`)

```tsx
export const TaskListPage: PageFC<{ status?: string }> = (props, ctx) => {
  const [tasks, setTasks] = useState<Task[]>([])
  const reload = () => { ctx.tasks.list(props.status).then(setTasks) }

  ctx.effect(reload)                        // run once when ready (the component spelling of page:ready)
  ctx.on('tasks/changed', reload)           // event-driven invalidation

  // Dynamic tool: registered within the page session's scope — only this page can take (scoped tools shadow globals)
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_take',
    description: '接取任务；taskId 取列表行首的编号',
    parameters: { taskId: { type: 'string' } },        // ParameterSchemaSpec → JSON Schema
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {                         // args typed via InferArgs
      await ctx.tasks.take(args.taskId)
      reload()
      return `已接取 ${args.taskId}，责任人变更为当前用户`
    },
  })))

  return (
    <>
      <h1>任务列表{props.status ? ` · ${props.status}` : ''}</h1>
      <p>共 {tasks.length} 条。接取用 task_take；发布去 <a href="/apps/tasks/new">/apps/tasks/new</a>；详情点行首编号。</p>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <strong>{t.id}</strong> <a href={`/apps/tasks/${t.id}`}>{t.title}</a>
            （{t.state} · {t.assignee ?? '未认领'}）
          </li>
        ))}
      </ul>
      {tasks.length === 0 && <blockquote>当前没有任务——如实告知用户，不要编造。</blockquote>}
    </>
  )
}
```

### A.2 Task Publish (tool page, `/apps/tasks/new`)

```tsx
export const TaskNewPage: PageFC = (_props, ctx) => {
  // An LLM has no "form": publishing is a tool call; this page only teaches the model the parameters
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_publish',
    description: '发布新任务；title 必填、desc 为验收标准（可选），返回任务编号',
    parameters: { title: { type: 'string' }, desc: { type: 'string', required: false } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      const t = await ctx.tasks.publish(args)
      ctx.emit('tasks/changed')
      return `已发布 ${t.id}；详情页 /apps/tasks/${t.id}`
    },
  })))

  return (
    <>
      <h1>发布任务</h1>
      <p>把用户给到的信息整理成参数，调用 task_publish 完成发布。</p>
      <ul>
        <li><strong>title</strong>（必填）：一句话标题</li>
        <li><strong>desc</strong>（可选）：验收标准与上下文</li>
      </ul>
      <blockquote>发布成功后向用户复述任务编号，并建议打开详情页跟进。</blockquote>
    </>
  )
}
```

### A.3 Task Detail (parameterized read-only + action tools, `/apps/tasks/:taskId`)

```tsx
export const TaskDetailPage: PageFC<{ taskId: string }> = (props, ctx) => {
  const task = useSnapshot<Task>()          // the meta.load(params) first screen

  // Action tools registered only in this page's scope (scope exclusivity: the list page never sees complete/abandon)
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_complete',
    description: '完成任务并回报；report 为结果说明',
    parameters: { report: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      await ctx.tasks.complete(props.taskId, args.report)
      return `已完成 ${props.taskId}`
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_abandon',
    description: '放弃任务；reason 为原因',
    parameters: { reason: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      await ctx.tasks.abandon(props.taskId, args.reason)
      return `已放弃 ${props.taskId}`
    },
  })))

  if (!task) return <p>任务 {props.taskId} 不存在或已删除——如实告知，不要编造。</p>

  return (
    <>
      <h1>{task.id} {task.title}</h1>
      <p>状态 <strong>{task.state}</strong> · 负责人 {task.assignee ?? '未认领'}</p>
      <h2>验收标准</h2>
      <blockquote>{task.desc ?? '（未填写）'}</blockquote>
      <h2>可用操作</h2>
      <ul>
        <li>task_complete：完成后回报结果</li>
        <li>task_abandon：放弃并说明原因</li>
      </ul>
      <hr />
      <p><a href="/apps/tasks">← 返回任务列表</a></p>
    </>
  )
}
```

### A.4 Registration (apply — using the existing ctx.apps face)

```tsx
export const inject = ['apps', 'pageRegistry', 'tasks'] as const

// The contract face sits beside the component (merged in when the adapter wraps it into a
// PageDefinition); no hand-written map (derived, §3.5)
const ListMeta = { url: '/apps/tasks', description: '任务列表：浏览/接取任务' }
const NewMeta = { url: '/apps/tasks/new', description: '发布新任务（工具页：挂 task_publish）' }
const DetailMeta = {
  url: '/apps/tasks/:taskId',
  description: '任务详情与操作',
  load: (params: { taskId: string }) => ctx.tasks.get(params.taskId),   // reaches the component via useSnapshot()
}

export const apply = (ctx: Context): void => {
  const apps = ctx.apps
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(apps.register({ id: APP_ID, name: '任务中心', description: '任务的浏览、发布与跟进', entry: 'list' }, ctx))
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(TaskListPage, ListMeta))
      done.push(pages.register(TaskNewPage, NewMeta))
      done.push(pages.register(TaskDetailPage, DetailMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'tasks-app:wire')
}
```

### A.5 The Document the Model Actually Reads (WYSIWYG verification)

The task list page (first frame, `/apps/tasks`):

```md
PAGE tasks.list /apps/tasks
map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）
- /apps/tasks/:taskId → 看任务详情、完成或放弃
- /apps/tasks/new → 发布新任务
tools: task_take（接取任务；taskId 取列表行首的编号）

# 任务列表

共 3 条。接取用 task_take；发布去 [/apps/tasks/new](/apps/tasks/new)；详情点行首编号。

- **T-1024** [修复登录超时](/apps/tasks/T-1024)（open · 未认领）
- **T-1025** [首页骨架](/apps/tasks/T-1025)（doing · imeep）
- **T-1026** [清理构建脚本](/apps/tasks/T-1026)（done · imeep）
```

The task detail page (`/apps/tasks/T-1024`) — note the tools line differs from the list page (scope exclusivity):

```md
PAGE tasks.detail /apps/tasks/T-1024
tools: task_complete（完成任务并回报）、task_abandon（放弃任务）

# T-1024 修复登录超时

状态 **open** · 负责人 未认领

## 验收标准

> 超时时间从 30s 提升到 5s…

## 可用操作

- task_complete：完成后回报结果
- task_abandon：放弃并说明原因

---

[← 返回任务列表](/apps/tasks)
```

### A.6 Data Change → Message Append (Two Paths)

**Path 1: automatic in-session patches (framework behavior; zero author code).** In a live page session, any action that changes the snapshot (a tool call, an external event refreshed via `ctx.on`) → the component re-renders → the reconciler diffs → the delivery layer serializes the **changed element subtrees** into a `PAGE-PATCH` block appended to this session's history. The key does position matching: the model updates its understanding of a row by its leading id.

Take the model calling `task_take { taskId: "T-1024" }` in the list page session; the history gains, in order:

```md
[tool result] 已接取 T-1024，责任人变更为当前用户
```

(`ctx.tasks.take` persists → store updates → re-render → the diff yields one changed `<li key="T-1024">`)

```md
PAGE-PATCH tasks.list
- **T-1024** [修复登录超时](/apps/tasks/T-1024)（doing · imeep）
```

Unchanged rows and paragraphs are not re-sent — the op count is the token budget (§6.1).

**Path 2: cross-session notification (the existing `deliverUrl` delivery path).** When a change matters to other sessions, deliver idempotently by URL — a live session gets the message appended and woken; an absent one gets a new session (which renders, mounts tools and produces its first frame by itself):

```tsx
ctx.on('tasks/changed', async (p: { taskId: string; by: string }) => {
  // pass callerSessionId when dispatched from within a session (chain depth governed by HopLedger);
  // apply-level listeners omit it = human/host
  await ctx.pageRegistry.deliverUrl(`/apps/tasks/${p.taskId}`, {
    message: `[tasks] 任务 ${p.taskId} 已由 ${p.by} 更新，请查看最新状态`,
  })
})
```

Notifications for non-page conversations (plain chat) ride the existing `taskCenter.send` inbox path (the TASK block + inbox text — exactly what live-host checklist item 6 verifies). v1's "manually render the snapshot + messages.append" is withdrawn: if the delivery target is a page, creating-or-waking the session performs the rendering itself.

## Appendix B: API Reconciliation Against the Existing Platform (full audit, 2026-10-21)

Every API in this proposal was checked against the real package faces (app-registry / page-registry / dsh-tools / cordis / prompt-page), in three classes:

### B.1 Used As-Is (zero new)

| API | Source | Notes |
| --- | --- | --- |
| `apps.register(definition, ctx)` / `apps.pages(id).register` / `apps.tools(id).define` | `@veren/app-registry` | the same shape person-agent-app uses today |
| `ctx.tools.register(def)` | `@deepseek-ai/dsh-tools` | returns the exact disposer; **registers in the calling agent's scope — scoped tools shadow globals**, the native implementation of tool-scope exclusivity |
| `defineTool(options): ToolDefinition` | `@deepseek-ai/dsh-tools` | registry-ready; `InferArgs` derives execute's args type |
| `tools/pre-execute` → `execute` → `post-execute` → `result` / `change` | `@deepseek-ai/dsh-tools` | the dispatch/approval pipeline and tool-set change notification all exist |
| `ctx.tools.restrict` / `guard` | `@deepseek-ai/dsh-tools` | scope restrictions and guards, taken as needed |
| `pageRegistry.deliverUrl(url, { message, wake?, callerSessionId? })` | `@veren/page-registry/delivery` | idempotent URL-addressed delivery: append + wake live sessions, create absent ones; HopLedger guards cascades |
| `taskCenter.send` inbox path | existing | notifications for non-page conversations (live-host checklist item 6) |
| `ctx.effect(fn, label)` / `ctx.on` / `ctx.extend` / `ctx.emit` | cordis | wiring, events, sub-scopes |
| `pages.register(page, live?: { store })` | `@veren/app-registry` | the live store binding already exists — `useSnapshot()`'s data channel has a ready hook |
| `PageDefinition` / `ApplicationDefinition` | `@veren/prompt-page` / `@veren/app-registry` | the adapter's target types |

### B.2 Existing + Extended (adapter-level)

| Extension | Base | Content |
| --- | --- | --- |
| `pages.register(PageFC, meta)` | existing registrar | the component adapter: wraps PageFC + meta into a PageDefinition internally |
| `pageBlock()` output format | existing function | drops the params/data JSON lines, derives map from the registry, renders the body as Markdown |
| the `PAGE-PATCH` block | the existing append delivery mechanism | a new block type serializing re-render diffs as Markdown |
| `page:ready` / `page:dispose` | the cordis event system | two new `@mode: emit` event declarations (naming follows host event conventions; precedent `agent/created`) |

### B.3 Genuinely New (framework gaps, nothing to reuse)

| New | Home | Why it cannot be reused |
| --- | --- | --- |
| hook slots + render-time `ctx.effect`/`ctx.on` recording (C1–C4) | prompt-core | prompt-core has no hooks today; render-time recording completes the "React rules port" |
| the HTML → Markdown serializer (C5) | prompt-page | the platform has no server-side HTML→MD facility; the mapping table + escaping is the new correctness-critical surface |
| the render-time context stack (C4) | prompt-core | components need the nearest Provider; cordis's extend is a scope, not a render stack |
| the call-order lint (C6) | tooling | render-phase vs apply-phase call detection, the same heuristics React uses |

Conclusion: the self-built surface converges to **prompt-core's hook/recording kernel + one Markdown serializer + one component adapter** — everything else is as-is reuse or thin extension of the existing platform.
