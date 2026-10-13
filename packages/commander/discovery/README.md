# @veren/commander-discovery

[涓枃鏂囨。](./README.cn.md)

Workspace unit discovery as a standard Cordis plugin module: the `DiscoveryService` (a `Service` with `list`/`find`) exposes the workspace's units 鈥?`{ name, description, dir }` 鈥?discovered by file convention (`package.json` over `Cargo.toml`), depth-capped, sorted by `dir`; the pure scanning functions ship alongside.

## When to use

- A Cordis plugin needs the workspace's units as structured data (the veren CLI's `list`/`doc` commands inject this service).
- You want the npm-over-Rust precedence, depth cap and skip list (`node_modules`, `dist`, `target`, hidden dirs) applied consistently, tunable through the plugin config.

Skip it when you scan workspaces with other tooling.

## Install

```json
{
  "dependencies": {
    "@veren/commander-discovery": "workspace:*"
  }
}
```

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import { getOrThrow } from '@veren/core'
import { Project } from '@veren/commander-project'
import { Discovery } from '@veren/commander-discovery'
import * as DiscoveryPlugin from '@veren/commander-discovery'

const ctx = new Context()
ctx.provide(Project, { root: '/path/to/project', config: { scanRoots: ['/path/to/project/apps'] } })
await ctx.plugin(DiscoveryPlugin) // inject = [Project]; Config: { maxDepth, skip }

const units = await getOrThrow(ctx, Discovery).list()
// [{ name: '@x/pkg', description: '鈥?, dir: 'apps/pkg' }, 鈥
await getOrThrow(ctx, Discovery).find('@x/pkg') // 鈫?unit | undefined
```

The pure function also remains available for non-plugin callers:

```ts
import { discoverUnits } from '@veren/commander-discovery'

const units = await discoverUnits(fs, path, '/path/to/project', { scanRoots: ['/path/to/project/apps'] })
```

## Tokens subpath (platform-agnostic)

`./tokens` exports only the `Discovery` token and its structural `UnitInventory`/`Unit` interfaces 鈥?no Cordis and no Node built-ins 鈥?so it bundles cleanly into the browser or anywhere else that only needs to name the service:

```ts
import { Discovery } from '@veren/commander-discovery/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin 鈥?install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliDiscovery'`) | Service token (= `Discovery`) and plugin display name. |
| `inject` | `[Project]` | Requires the project service (project root + scan roots). |
| `Config` | schemastery schema | `{ maxDepth: number, skip: string[] }` 鈥?scan depth cap (default `4`) and extra directory names skipped beyond `SKIP_DIRS` (default `[]`). |
| `apply(ctx, config)` | plugin function | Creates a `DiscoveryService` from the context's `Project`. |
| `Discovery` | token, the string `'verenCliDiscovery'` | Token under which the `DiscoveryService` is provided. |
| `DiscoveryService` | class extends `Service` | `list()` (units sorted by `dir`, rescanned per call), `find(name)`, `root` (the project root), `config` (the normalized config). |
| `UnitInventory` | interface | Token-level structural view (from `./tokens`): `root`/`list`/`find` with no Cordis dependency. |
| `discoverUnits(fs, path, root, config, options?)` | async function | Pure scan: every scan root recursively, units sorted by `dir`; `options` = `{ maxDepth?, skip? }`. |
| `ScanConfig` | interface | `{ scanRoots: string[] }` 鈥?the minimal scan shape (structurally compatible with `@veren/commander-project`'s `Config`). |
| `ScanOptions` | interface | `{ maxDepth?, skip? }` 鈥?optional per-scan overrides. |
| `Unit` | interface | `{ name, description, dir }`; `dir` is root-relative with forward slashes. |
| `readNpmUnit(fs, path, ...)` / `readCargoUnit(fs, path, ...)` | async functions | Read one unit from `package.json` / `Cargo.toml`; `null` when not a unit (corrupted manifests warn on stderr). |
| `parseCargoPackageFields` | function | Dependency-free `[package]` `name`/`description` extraction (double-quoted with escapes, single-quoted literal, trailing comments). |
| `MAX_SCAN_DEPTH` / `SKIP_DIRS` | constants | Depth-cap default (4) and the built-in skip list (`node_modules`, `dist`, `target`, `.git`). |

## Development

```bash
pnpm --filter @veren/commander-discovery build
pnpm --filter @veren/commander-discovery test   # 15 cases / 15 涓敤渚?```

```
packages/commander/discovery
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ discovery.ts   # pure scanning + manifest readers / 绾壂鎻忎笌娓呭崟璇诲彇
鈹?  鈹溾攢鈹€ service.ts     # Config schema + DiscoveryService / 閰嶇疆 schema 涓庢湇鍔?鈹?  鈹溾攢鈹€ tokens.ts      # platform-agnostic Discovery token + UnitInventory/Unit / 骞冲彴鏃犲叧浠ょ墝涓庢渶灏忕粨鏋勮鍥?鈹?  鈹斺攢鈹€ index.ts       # plugin module: name/inject/Config/apply + re-exports / 鎻掍欢妯″潡涓庡啀瀵煎嚭
鈹斺攢鈹€ test/index.test.ts
```

## Notes & constraints

- A matched unit is never descended into: a unit is the smallest distributable boundary.
- One corrupted manifest never aborts a scan 鈥?it is warned about on stderr and skipped, so stdout stays clean for JSON consumers.
- `list()` rescans per call: a CLI process is short-lived, so freshness beats caching; the service unloads with its fiber.

