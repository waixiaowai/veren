# Prompt Page

English | [中文](./README.cn.md)

## What & When to Use

Page runtime over `@veren/prompt-core` + `@veren/prompt-host-messages` — the `react-dom/client` equivalent for LLM page-sessions. Use it to declare pages with unique URLs, register them in a `PageRegistry`, and mount each resolved page as an isolated page-session. Static faces (system prompt, tools, skills) belong to the DSH preset; this package owns URLs, dynamic context, and lifecycle hooks only.

## Model

- **One page = one session**: own `MessageHost` (own version chain / snapshot baseline); state lives in the shared external store, so closing a session never loses state.
- **Page registry**: pages register `{ name, url, description }`; url patterns are path-only (`/task-detail/:taskId`); `resolve(url)` merges path params + query (path wins) and returns the normalized concrete url.
- **Navigation = resolve → mount**: close the old session, `mountPage` the new one; the pointer rides in `session.pointerMessage` (`OPEN /task-detail/t-12 {...}`) as the first user message of the new session.
- **definePage fails loud**: empty name/description, non-path or duplicate-`:param` urls, non-function tree.
- **Lifecycle hooks (reserved)**: `onLoad(params)` after mount; `onComplete(params)` consulted to decide session archive (plugins close sessions via `workspaceRegistry.archiveSession`).
- **Optional policy assembly**: pass `assembly: { systemPrompt, provider?, policy?, budget? }` to `mountPage` and the session gains `assemble()` — budget-driven remount plus provider-planned cache breakpoints from `@veren/prompt-host-messages` (unknown providers default to deepseek semantics; see that package's README). Without `assembly`, behavior is unchanged.
- **Live binding (`PageLiveBinding`)**: a page may be registered with an authoritative store, sealed as `{ mount(params, scope?): PageSession<never> }` — the state type `S` is consumed where the store lives, so the registry and the mounting site never see it. `scope` is the session's `agent.ctx`: a component page's `ctx.effect`/`ctx.on` register through it (the DSH scope model), so agent-subject events are filtered to that agent and cleanup follows the session scope; without a scope (an agentless preview) they fall back to the creator context / view teardown. `mountPage` is the mounting primitive either path uses; store changes are fully synchronous into the `MessageHost` version chain, which is what lets the host inject the latest snapshot at the next model request (§3.10.2/§3.10.3).

## Run

```bash
pnpm --filter @veren/prompt-page test
```
