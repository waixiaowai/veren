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
- `app_open` tool body built by `createAppOpenTool(port)`; the host assembly (`app-host`) registers it into `ctx.tools` inside its single all-or-nothing wiring effect (G13) — this module no longer opens its own effect.

## Explicit wiring (G13)

This service never probes sibling services at runtime (no `ctx.get(...)` on `apps` / `taskCenter` / `sessions` / `agents` — the real-machine property guard attributes accesses to the accessed context's owner, so probing cannot work). Its declared inject is `['storageDomain']` only. Every runtime capability arrives through `bindPorts(ports, index?)` as **pure parameters** (whole-set replacement, no partial merge):

- required: `sessions` (page session port), `apps` (app-registry `get`), `toolsOf` (app tool catalog);
- optional capabilities: `tasks` (task take), `deliveries` (inbox pump), `releaseLeases` (deprecation lease release).

Before the host assembly (`@veren/app-host`) runs `bindPorts`, `openUrl` / `releaseApp` fail loud with `page/host-unavailable` — never a fake success.

