# Page Registry

English | [中文](./README.cn.md)

## What & When to Use

Host-level **Service plugin** owning the page registry for LLM page-sessions — the Service Provider of the capability seam whose contract is `PageRegistryService`. Use it when page plugins must register declarative pages (`{ name, url, description }`, url patterns like `/task-detail/:taskId`) into one deployment-wide registry, and when navigation entries, catalogs, or model tools need to resolve URLs (path params + query, path wins). Skip it when there are no declarative pages.

## Roles

- **Service Definition** (`src/service.ts`): `register` (disposer-returning, HMR-safe) / `resolve<S>(url)` / `get<S>(name)` / `catalog()` / `format(pattern, params)`.
- **Service Provider** (default export): mounts once at deployment scope; session child scopes resolve the same instance through `inject: ['pageRegistry']`.
- **Consumers**: page plugins (`registry.register(page)`), navigation tools (`registry.resolve(url)` → close old session + mount), catalog panels (`registry.catalog()`).

## Contract

- Duplicate names / duplicate url patterns throw at registration (misconfiguration fails loud).
- `resolve` returns `null` for no match; merged params are `{ ...query, ...pathParams }` (path wins).
- The kernel (`@veren/prompt-page`) stays cordis-free; this plugin is the only place where the registry meets the host.

## Run

```bash
pnpm --filter @veren/page-registry test
```

## Instance index & page runtime (phase 1)

- `service.instances`: persistent `PageInstanceIndex` (`app_pages` storage domain, two-phase reserve/commit, survives restart, invalidates rows whose session is gone).
- `service.openUrl(url, { taskId })`: canonicalize -> app check -> open a fresh page session (same-URL predecessor deprecated first) -> mount `<toolPrefix>__<local>` tools -> one PAGE block -> commit -> focus; task flow takes first, then appends a TASK block. Stable codes: app/not-found, app/disabled, page/not-found, task/expired, page/session-create-failed, page/tool-conflict, page/index-unavailable, page/host-unavailable.
- `registerAppPage(appId, page)`: app-scoped registration (pairs with app-registry's `ctx.apps.pages(id)`); the `page.<name>` preset path stays deprecated. Pages register under their **pageKey** (`<appId>/<localName>`) — local names collide across apps, bare names would make the second app fail on duplicate-name.
- `service.mountPreview(sessionId, url)` / `releasePreview(sessionId)`: the staged-pick face — render the page once (first-screen load included), collect the catalog + dynamic tools and mount them on that session's agent scope, with **no** instance, index row, or PAGE block. The later `openUrl(url, { reuseSessionId })` re-mounts the same definitions (both share one collector), so the model's first step already sees the final tool face; mounting inside `agent/pre-step` misses that step's tool collection. `releasePreview` strips the face when the pick is cancelled or promotion fails.
- `app_open` tool body built by `createAppOpenTool(port)`; the host assembly (`app-host`) registers it into `ctx.tools` inside its single all-or-nothing wiring effect (G13) — this module no longer opens its own effect.

## URL-addressed delivery (`page_send`, §3.9)

- `service.deliverUrl(url, { message, wake?, callerSessionId? })`: idempotent delivery — append to the url's live session, or create one first (the `openUrl` path, but **no GUI focus**: delivery is not navigation). Returns `{ sessionId, url, created, redirected }`.
- Cascade gate: a hop ledger caps any delivery chain at `MAX_DELIVERY_HOPS` (4); past it the call fails with `page/hop-limit` — one structural gate, no caller discipline involved.
- Deprecation race: after appending, the index is re-consulted; if the pointer moved (a human reopened the url), the message is re-delivered to the current live session (≤ `MAX_DELIVERY_ATTEMPTS` = 3) and `redirected: true` is reported.
- Wake policy: default wakes the target (one model round); `wake: false` only lands in the session log for the next wake.
- The `page_send` tool body is built by `createPageSendTool(port)` and registered by the host assembly; page agents hold it (it is not in the page-session deny list).

## Explicit wiring (G13)

This service never probes sibling services at runtime (no `ctx.get(...)` on `apps` / `taskCenter` / `sessions` / `agents` — the real-machine property guard attributes accesses to the accessed context's owner, so probing cannot work). Its declared inject is `['storageDomain']` only. Every runtime capability arrives through `bindPorts(ports, index?)` as **pure parameters** (whole-set replacement, no partial merge):

- required: `sessions` (page session port), `apps` (app-registry `get`), `toolsOf` (app tool catalog);
- optional capabilities: `tasks` (task take), `deliveries` (inbox pump), `releaseLeases` (deprecation lease release).

Before the host assembly (`@veren/app-host`) runs `bindPorts`, `openUrl` / `releaseApp` fail loud with `page/host-unavailable` — never a fake success.

## Live views (`pageData` port, §3.10.3)

- `registerAppPage(appId, page, live?)` accepts a `PageLiveBinding` (built by app-registry from the store the app declared): `live.mount(params)` returns the session's store-subscribed view.
- `openUrl` binds that view through the optional `pageData` port **before** `index.commit` — a mount failure rides the existing two-phase rollback instead of leaving a live session with a dead view. The initial cursor is the version the PAGE block already covers, so first-frame/snapshot content is never re-sent as a PAGE-PATCH. Deprecating the predecessor (same-url reopen) and the rollback path both call `pageData.unbind(sessionId)`.
- Without a `pageData` port or a `live` binding the page stays static; nothing else changes. Rendering, caps, and context delivery belong to the binder (`@veren/app-host`'s `createPageDataSync`).

