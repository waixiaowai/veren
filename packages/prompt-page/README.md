# Prompt Page

English | [中文](./README.cn.md)

## What & When to Use

Page runtime over `@veren/prompt-core` — the `react-dom/client` equivalent for LLM page-sessions (the former `@veren/prompt-host-messages` dependency has been removed; the document sync shape is now owned by this package). Use it to declare pages as components, register them in a `PageRegistry`, and mount each resolved page as an isolated page-session. Static faces (system prompt, tools, skills) belong to the DSH preset; this package owns URLs, the component render pipeline, and page lifecycle hooks only.

## Model

- **One page = one session**: own `MessageHost` (own version chain / document baseline); state lives in the shared external store, so closing a session never loses state.
- **Page registry**: pages register `{ name, url, description }`; url patterns are path-only (`/task-detail/:taskId`); `resolve(url)` merges path params + query (path wins) and returns the normalized concrete url.
- **Navigation = resolve → mount**: close the old session, mount the new one; the pointer rides in `session.pointerMessage` (`OPEN /task-detail/t-12 {...}`) as the first user message of the new session. The mounting primitive is `PageLiveBinding.mount(params, scope?)`, used by the page runtime — there is no separate authoring entry like `mountPage` anymore.
- **Component pages are the only path**: the legacy block vocabulary (`Static`/`Data`/`Keyed`), the block-host mounting and the dynamic preset builder are deleted. `definePage` / `defineAppPage` remain as the contract-validation entry (url shape, §3.10.5 rule 3) shared with `defineComponentPage`.
- **Lifecycle hooks**: `meta.load(params, env)` supplies the first-screen data the component reads via `useSnapshot()` (failures included — the error state is rendered honestly in the body). There is no `onComplete` hook — it was removed in the subtraction pass; closing/archiving a session is an explicit consumer action (plugins call `workspaceRegistry.archiveSession`).
- **Page hooks (`ctx.page`)**: a component page gets a host Context **derived from the session's ctx** (`ctx.extend` — the official same-scope child context, so inherent-member registrations land on the session and unwind with it; without a scope — an agentless preview — it derives from the creator context) plus a `ctx.page` face — `ctx.page.effect(run)` / `ctx.page.on(name, handler)` register on the session's `agent.ctx` scope (agent-filtered events, cleanup at agent disposal; without a scope they fall back to the creator context / view teardown), and `ctx.page.tool(def)` records a session-scoped tool for the page runtime to mount. The ctx's inherent members (`ctx.effect` / `ctx.on` / `ctx.tools`) are never rewritten.
- **Live binding (`PageLiveBinding`)**: a page may be registered with an authoritative store (`meta.store`), sealed as `{ mount(params, scope?): PageSession<never> }` — the state type `S` is consumed where the store lives, so the registry and the mounting site never see it. `defineComponentPage(component, meta, ctx?)` returns `{ page, live }`; store changes are fully synchronous into the `MessageHost` version chain and diff into incremental `PAGE-PATCH` blocks at the next model request (§3.10.2/§3.10.3).

## Component pages (`defineComponentPage`)

A page component is a module-level function `PageFC<P> = (props, ctx) => ElementInput`; `props` are the URL params and `ctx` is the host Context **derived from the session's ctx** (declaration-merged services read directly — the same resolution chain tool execution sees via `exec.agent.ctx`). The page's own lifecycle and tool registration live on `ctx.page` — the ctx's inherent `effect` / `on` / `tools` are never rewritten:

- `ctx.page.effect(run)`: runs once on the first frame; the returned cleanup registers on the session's `agent.ctx` scope (when mounted with a scope) and is disposed at agent disposal — or earlier at view teardown.
- `ctx.page.on(name, handler)`: subscribes once; with a scope it goes through `agent.ctx`, so `scopeTarget` admits only that agent's events.
- `ctx.page.tool(definition)`: records a session tool; the page runtime mounts it on the session's agent scope.

`defineComponentPage(component, meta, ctx?)` returns `{ page, live }`; the page runtime mounts `live.mount(params, scope?)` per session. Applications normally register through `ctx.apps.pages(id).register(component, meta)`, which calls this adapter.

## Run

```bash
pnpm --filter @veren/prompt-page test
```
