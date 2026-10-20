# @veren/test-support

Shared test infrastructure for application-layer plugin specs. Use it when a
spec needs to mount a Cordis test host with the application services
(`ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter`), wire the
registry-to-page-registry mirror seam, fake per-session agent scopes, or open
a throwaway storage domain — instead of copying that wiring into yet another
spec. It deliberately does **not** start a real DSH profile; use the
`loader-smoke` test infrastructure for that.

Do not use it for domain-level unit tests that need no host, or for specs that
must exercise the real session/tool runtime end to end.

## Minimal example

```ts
import { expectPagesRegisteredOnce, mountAppHost } from '@veren/test-support'

const host = await mountAppHost()          // apps + pageRegistry + mirror, no taskCenter
const fiber = host.ctx.plugin(MyAppPlugin) // your app plugin; host.apps is live
await fiber

if (host.apps === undefined || host.pageRegistry === undefined) throw new Error('no registries')
expectPagesRegisteredOnce(host.apps, host.pageRegistry, MY_APP_ID)
await host.dispose()                       // reverse-order teardown, temp dirs removed
```

## What it provides

- `mountAppHost(options?)` — one path for the "construct + provide + mirror"
  dance: real `AppRegistryPlugin` / `PageRegistryPlugin` activation, the mirror
  seam wired once, minimal `tools` / `agentPresets` stubs. Options
  (`registries`, `storage`, `taskCenter`, `agentPresets`) switch services **off**
  to test degrade paths. `dispose()` tears everything down in reverse order.
- `TempDirs` / `mountStorage(ctx, dirs)` — one temp directory per test under
  the OS temp dir (never inside the repository), strictly paired cleanup.
- `installFakeSessions(ctx)` / `ToolTable` — fake session/agent ports where
  every session's agent scope is a real cordis child context (`isolate('tools')`);
  enough to assert which session a page tool landed in and that it disappears
  when that session's agent is destroyed.
- `expectPagesRegisteredOnce(apps, pageRegistry, appId)` — single-entry
  consistency: catalog pages and page-registry-resolvable pages correspond one
  to one, in both directions.
- `expectAppRemoved(apps, pageRegistry, appId, urls)` — torn-down-clean check.

See `README.cn.md` for the Chinese documentation.
