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
- `service.openUrl(url, { taskId })`: canonicalize -> app check -> index hit = resume & focus, miss = reserve -> create session -> mount `<toolPrefix>__<local>` tools -> one PAGE block -> commit -> focus; task flow takes first, then appends a TASK block. Stable codes: app/not-found, app/disabled, page/stale, page/not-found, task/expired, page/session-create-failed, page/tool-conflict, page/index-unavailable.
- `registerAppPage(appId, page)`: app-scoped registration (pairs with app-registry's `ctx.apps.pages(id)`); the `page.<name>` preset path stays deprecated.
- `app_open` host tool registered via `registerAppOpenTool`.

