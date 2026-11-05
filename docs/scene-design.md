# Scene: The Situation Axis of DSH

English | [中文](scene-design.cn.md)

> **Superseded by the chaptered set**: the more readable, chapter-navigated version lives at [`docs/scene/`](./scene/) (cover entry `docs/scene/index.md`, with architecture diagrams, per-module designs, acceptance and traceability). This file remains as the single-file technical record (v2, 2026-11-05); future updates happen in `docs/scene/`.
>
> **本文已升级为分章方案**：更易读、按章导航的版本在 `docs/scene/`。本文件保留为单文件技术底稿（v2，2026-11-05），后续更新以 `docs/scene/` 为准。

## Summary

**One sentence: a scene is DSH's first-class concept for situations — the same person (preset) walks into a different setting, and the right tools, skills, and memory slices are swapped in automatically.**

Scene follows a person–setting model: the preset defines who you are (persona and the subject of the memory store), while the scene defines where you are and what you are doing — working in the office, being with the kids at home, driving, chatting in a café, taking a walk, coding, reading. The person stays, the setting changes, and the whole capability face re-dresses: the mounted tool set, the activated skill set, and the recallable memory slices all switch with the scene, like the same actor carrying different props and lines in different acts. Scene is therefore not an alias for tool, skill, or preset — it is the **combination key and switch** that stands above them: the plugin delivers the scene, and a session is one instance of "a person × a scene × a span of time". Scenes support explicit enter/leave as well as automatic resolution of which scene to enter, like a camera's automatic scene detection.

## 1 The problem: mount logic is reinvented everywhere

Today tool and skill mounting is static and local. The task workbench (task-workbench) already practices "different pages mount different tools" (the list page sees only task-taking tools, the detail page only task-handling tools), but that mutually exclusive mounting logic is hand-written by each page plugin. The more general need — swap capabilities when the occasion changes: translating, writing weekly reports, coding, being with the kids — makes every plugin re-implement mount/unmount code; and memory recall ignores the occasion entirely: at work it surfaces notes about the kids, with the kids it surfaces code snippets.

What is missing is a first-class concept that gathers "when, mount what, remember what" into one declarative contract.

## 2 Concept definition and layering

```
plugin   delivery unit    who provides it
preset   identity axis    who you are: persona, model, memory-store subject
scene    situation axis   where you are: which tool/skill to mount, which memory to recall   ← this proposal
session  lived instance   a person × a scene × a span of time
tool     capability atom  an action the agent can call
skill    knowledge atom   procedural knowledge the agent loads on demand
```

Scene is the combination key and switch for tool / skill / memory; it stands above the atom concepts and replaces none of them. Under one preset, switching the scene re-dresses all three faces (tools, skills, memory recall) at once.

**One-line placement (v2 revision)**: a scene is a **preset fragment switchable mid-run**. Presets resolve at session creation and a live agent retains its composition (verified, see §5); scene fills exactly the gap of "runtime switching inside one live session". It invents no new mounting machinery — it reuses scope/shadowing, `tools.restrict`, and `system-prompt/assemble` directly.

## 3 The analogy models

**Actor and acts**: the same actor (preset) is in the office in act one and at home in act two; each act carries only its own props (tools) and lines (skills), and remembers only what that act should remember (memory slices).

**Camera scene modes**: the same camera switches processing parameters across portrait / night / sport modes, and the camera world already has "automatic scene detection" — automatic switching even has a ready-made name.

## 4 Naming verdict

- **Semantics**: the candidate examples are all situational states, not story arcs. scenario means a what-if storyline (test scenario, user journey); scene means the situation a person is in — and "场景" translates to scene first of all.
- **Precedent**: theater acts and camera scene modes, double-confirmed.
- **No in-domain collision**: the DSH vocabulary (tool/skill/preset/plugin/agent/session/page/profile/workspace) has no scene occupying it.
- **Deliberately avoided**: `context` (cordis Context), `profile` (DSH profile), `mode` (mutually-exclusive global toggle semantics, cannot express memory slices), `focus` (means keyboard focus on the desktop).
- **Out-of-domain collision**: three.js Scene belongs to graphics; the misreading risk for an agent framework is low and accepted.

## 5 Cross-validation against existing mechanisms (all verified)

| Existing mechanism | Verified state of the world (source) | How scene reuses it |
|---|---|---|
| preset | `packages/preset/agent-preset-registry/README.md`: presets are ordinary plugin rows (declarative child-plugin compositions), resolved at session creation, and **"existing Agents retain the composition they already use"**; the `selectedDefault` revision affects only **new** sessions | Scene definitions reuse the same declarative row format; scene fills "switch mid-run" and does not overlap preset |
| scope / shadowing | `docs/dsh-concepts.md` §3: a live agent is the key of its own scope; registrations through `agent.ctx` share the agent's lifetime; same-name nearest layer wins outright | **Entering a scene mounts one composition layer into the agent scope; leaving disposes that layer**. Unmount rollback comes free from cordis effect semantics — no bespoke mount handles |
| `tools.restrict` | `packages/core/tools/src`: restrictions compiled at registration, repeatedly live-global lookup, visible definitions = after restrictions + shadowing; scoped restriction changes emit events | In-scene tool narrowing uses restrict directly (intersection filter, absent from prompt and execution alike); scene-specific tools register in the scope layer (as task-workbench does today) |
| `system-prompt/assemble` | `packages/core/system-prompt/src`: per-step cooperative waterfall; tools / contexts / variables participate by scope | Scene prompt sections live and die with the scope layer; each step's assembly naturally reflects the current scene |
| skill registry | `docs/dsh-concepts.md` §4: layered merge, nearest layer wins; the catalog keeps one summary line, bodies load on demand | Scene skills register their catalog in the scope layer; bodies stay out of context until loaded |
| session invariant | `docs/dsh-concepts.md` §6: **model-visible ⟺ logged**; message changes happen through registered projections, never by rewriting logged events | Whatever the model can see about a scene switch must reach the session log (see §7); memory "filter on read" rides projections or prompt sections, never log rewrites |
| compaction | `docs/subsystems/compaction.md`: triggers `pressure` / `context-overflow`; automatic policy runs at `agent/pre-step` and `agent/request`; `compactNow` performs maintenance between turns; the surface replacement is one `user/message` + `surfaceOp replace`, bookkeeping rides log-only events, and `SurfaceEventType` is deliberately not extended | Scene switching runs **at the same position** (turn boundaries); event shape follows compaction (log-only bookkeeping + message carriers for the model-visible face); scene **piggybacks on compaction** (see §8) |
| llm wire contract | `packages/llm/llm/src/types.ts`: `SystemPromptUpdate('in-history')`, `ToolUpdate('in-history' / 'addition-only')`, `deferLoading`, `LlmModelContext.contextWindow`, `cacheReadTokens/cacheWriteTokens` | A cache-friendly mid-session re-dressing **wire protocol already exists**; scene maps onto it directly (see §8) and invents no new caching mechanism |
| tokenMeter | compaction docs: `ctx.tokenMeter` directly owns estimation and replay | Scene-face costs (declaration tokens, switch-induced cache invalidation) are booked there |
| projection | `docs/dsh-concepts.md` §6: `ctx.sessionProjections` units fold committed events; domains read snapshots | Memory "filter on read" and cross-scene derived views ride the projection seam |

**v2 correction record** (two substantive fixes over the first draft):
1. The first draft made `scene/entered`/`scene/left` pure runtime `emit`s — **violating the session invariant** (model-visible ⟺ logged). Whatever changes the model-visible face must reach the session log.
2. The first draft invented `MountHandle` disposal receipts — **reinventing the wheel**. The scope layer + `tools.restrict` + effect unmount semantics already cover the entire need.

## 6 Data model (draft v2)

```ts
// src/types.ts 只放类型。跨边界 id 用 brand，零运行时开销
// types only in src/types.ts. Cross-boundary ids use brand, zero runtime cost
export type SceneId = Branded<'sceneId'>

export interface SceneDefinition {
  id: SceneId
  label: LocaleString            // 中英双语显示名 / bilingual display name
  enter: SceneEnterCondition     // 显式进入 / 自动判定条件 / explicit or auto-resolved entry
  composition: PluginRow[]       // 声明式子插件行，学 preset 格式 / declarative rows, preset-style
  restrictTools?: ToolRef[]      // 全局工具面收窄为该集合 / narrow global tools to this set
  memory?: MemoryScope           // 记忆召回切片 / memory recall scope
  page?: PageRef                 // 常见载体：场景绑定到某页面 / scene bound to a page
  coexistWith?: SceneId[]        // 默认互斥；显式声明可并存 / mutually exclusive unless declared
}

export interface SceneState {
  sceneId: SceneId
  sessionId: SessionId
  enteredAt: number
  scope: Scope                   // 场景层本体；离开 = dispose 该 scope / the layer itself; leave = dispose it
}
```

The tool face splits in two: **narrowing** (restrict the global set) and **adding** (scene-specific tools register in the scope layer, like `take_task`) each ride their own existing mechanism; `SceneState.scope` is the entire disposal receipt.

## 7 Runtime behavior (design intent v2)

Lifecycle: `resolve → enter → (switch) → leave`; **switching happens only at turn boundaries** (the same agent-maintenance position as `compactNow`, never mid-turn).

- **Explicit enter/leave**: called through the API; requests queue and take effect at the next turn boundary.
- **Automatic resolution**: `scene/resolve` runs as **bail** — listeners propose a verdict from context (page URL, time, conversation content), the first decisive result wins and short-circuits; with no verdict the current state stands.
- **Ledger shape of enter/leave (compaction precedent)**: bookkeeping (who resolved, when, receipts) rides **log-only** session events (`scene/entered`, `scene/left` join via declaration merging, not `SurfaceEventType`); the model-visible face (tool additions/removals, scene prompt) rides message carriers — models with `ToolUpdate` take `tool-addition`/`tool-removal` blocks, and the scene prompt rides the latest system message. **Each step's request header snapshots the sceneId** (same method as model-selection snapshots), preserving "model-visible ⟺ reconstructable".
- **Mutual exclusion**: one session sits in one scene at a time by default; the `coexistWith` whitelist is the explicit exception (driving + chatting is a real need).
- **Resume**: on resume the current scene rebuilds by replaying the header snapshot chain, consistent across restarts.
- **Cleanup rule**: leaving disposes the scene scope; cordis effects unwind in reverse; registry contributions carry dispose/HMR safety tests.

## 8 Cache hits, context budget, and compaction timing

### 8.1 Cache hits: the switching wire protocol already exists; scene degrades by model capability

The request prefix = system prompt (including the tool declaration face) + history. A scene switch that touches either busts the provider prefix cache. The llm contract already grades model capability in three tiers, and scene degrades accordingly:

| Model capability (llm contract fields) | Cache cost of a scene switch | Scene behavior |
|---|---|---|
| `systemPromptUpdate: 'in-history'` + `toolUpdate: 'in-history'` | Near zero: additions, removals, and prompts **append after the cached history**; message 0 is never rewritten | Preferred path; `deferLoading` tools activate via a `tool-addition` block, leave via `tool-removal`, and the scene prompt appends as the latest system message |
| `toolUpdate: 'addition-only'` (no removal) | Additions near zero; removals can only keep the declaration | On scene leave, keep the declaration and mark it unavailable (execution-layer refusal), explained to the model via prompt |
| Neither (full re-declaration per request) | Every switch = full prefix cache invalidation | Accepted but **booked**: `cacheReadTokens/cacheWriteTokens` already exist in token accounting; the ledger delta around a switch is its cost, and the auto-resolution policy raises the switching threshold for such models |

### 8.2 Context length: scene is a budgeting mechanism, not a budget burden

- **Narrowing saves**: restricted tools stop occupying the declaration face and catalog summaries; requests shrink → `pressure` compaction is delayed. Scenes slim long sessions by occasion — the same direction as compaction, not a competitor.
- **Scene declarations stay catalog-sized**: the parts of a scene definition that reach the prompt (scene description, skill catalog) follow the skill-catalog pattern — one summary line, body loaded on demand. Scenes must not carry large resident prompt prose.
- **Anti-flip-flop (hysteresis) is mandatory**: every switch leaves a trace in history (tool-addition/removal blocks, system messages), so oscillation fattens history linearly. Auto-resolution needs switching hysteresis: a new scene takes effect only after N consecutive consistent resolves (or M sustained conversation rounds); explicit switching is not throttled.

### 8.3 Compaction timing: piggyback on compaction

- Compaction triggers are `pressure` / `context-overflow`; automatic policy runs at `agent/pre-step`; after a surface replacement **the prefix cache goes cold anyway** — exactly a zero-cost window for switching scenes. Policy: if compaction and a scene switch are queued in the same round, apply the switch with the compaction so the cache goes cold only once.
- Scene state survives compaction: compaction folds only a surface span; the scene's log-only events and header snapshots are outside its reach; summary messages can carry a sceneId tag per `MemoryScope` (first landing of "tag on write").
- Scene switching **never triggers** compaction: switching only changes faces; token-pressure assessment stays compaction's sole responsibility (no boundary crossing).

## 9 Events and API face (draft v2)

```ts
export const SceneToken = defineToken<SceneService>(`sceneService`)

// 会话事件经 declaration merging 挂进 SessionEventMap，log-only（学 compaction）
// session events join SessionEventMap via declaration merging, log-only (compaction precedent)
// scene/entered { sceneId, receipts }  – 谁判定、何时进、scope 层凭证
// scene/left    { sceneId, reason }    – 离开缘由：explicit | resolve | dispose

// 运行时判定走 bail（第一个决定性结果生效即短路）
ctx.on('scene/resolve', ...)    // @mode bail  自动判定该进哪个场景 / resolve the scene to enter

class SceneService extends Service {
  current(sessionId: SessionId): SceneState | undefined
  enter(sessionId: SessionId, sceneId: SceneId): Promise<SceneState>   // 排队至 turn 边界
  leave(sessionId: SessionId): Promise<void>
  register(def: SceneDefinition): Disposable   // 注册即返凭证 / registration receipt
}
// 经 declaration merging 暴露 / exposed via declaration merging: ctx.scenes / ctx.scene
```

Structured errors: `SCENE_CONFLICT` (exclusivity conflict), `SCENE_NOT_FOUND`, `SCENE_PENDING` (a switch is queued), and siblings — stable codes plus machine-readable fields; misconfiguration fails loud.

## 10 Boundaries and decision points

1. **Coexistence**: mutually exclusive by default; `coexistWith` opens it explicitly (driving + chatting is a real need).
2. **Resolution priority**: explicit enter > resolve verdict; no resolve result means the current state stands.
3. **Memory slices**: tag on write (memory produced in a scene carries its sceneId; compaction summaries are the first landing), filter on read (recall filtered by the current scene, riding projections or prompt sections) — one write, two sides benefit.
4. **No dual tracks**: absorb hand-written mounting logic such as the task workbench's; replace old paths by deletion, no compatibility layer.
5. **Auto-switching on models without ToolUpdate**: default to a higher threshold (more hysteresis); full disablement stays a configuration choice.

## 11 Roadmap

- **M1** explicit enter/leave: scope-layer mounting + restrict tool face + session-event ledger + sceneId in the header snapshot
- **M2** `scene/resolve` bail auto-resolution + turn-boundary switching + re-mount on resume
- **M3** cache-capability degradation (SystemPromptUpdate/ToolUpdate mapping) + tokenMeter switch accounting + anti-flip-flop
- **M4** memory slices (tag on write; filter on read via projections)
- **M5** absorb existing hand-written mounting implementations (task workbench and friends)

## 12 Glossary

| 中文 | 英文 |
|---|---|
| 场景 | scene |
| 预设（人） | preset |
| 进入 / 离开场景 | enter / leave scene |
| 场景判定 | scene resolve |
| 记忆切片 | memory scope |
| 并存 | coexist |
| 切换迟滞 | switch hysteresis |
