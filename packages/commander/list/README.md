# @veren/commander-list

[中文文档](./README.cn.md)

The veren CLI's `list` command as a standard Cordis plugin module: it injects the command registry and the Discovery service, registers the `list` command that prints every workspace unit — `{ name, description, dir }` — as JSON sorted by `dir`; the JSON indentation comes from the schemastery `Config` schema (`indent`).

## When to use

- You assemble the veren CLI runtime (`apps/cli` already includes it) and want the unit inventory command available.
- You want the JSON inventory output in your own commander-based tool.

Skip it when you consume `@veren/commander-discovery` directly and render the output yourself.

## Install

```json
{
  "dependencies": {
    "@veren/commander-list": "workspace:*"
  }
}
```

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import * as CommandsHost from '@veren/commander-core'
import * as Discovery from '@veren/commander-discovery'
import * as Project from '@veren/commander-project'
import * as ListCommand from '@veren/commander-list'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(CommandsHost) // the command registry
await ctx.plugin(Project)
await ctx.plugin(Discovery)    // the unit inventory service (inject = [Project])
await ctx.plugin(ListCommand)  // registers `list` (inject = [Commands, Discovery])
```

Config flows through `ctx.plugin(ListCommand, { indent: 4 })`.

## Tokens subpath (platform-agnostic)

`./tokens` exports only the `INDENT` token (the `indent` config field name) — no Cordis and no Node built-ins — so config panels or other platform-agnostic consumers can reference the field without importing the plugin:

```ts
import { INDENT } from '@veren/commander-list/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin — install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliListCommand'`) | Plugin display name. |
| `inject` | `[Commands, Discovery]` | Requires the command registry and the Discovery service. |
| `Config` | schemastery schema | `{ indent: number }` — the JSON indentation spaces (default `2`, range `0..10`). |
| `apply(ctx, config)` | plugin function | Registers the `list` command; the registration disposer is handed back to the fiber, so the command disappears when the plugin unloads. |
| `cmdList(source, config, args)` | async function | The implementation: with no argument prints every unit; with one `<name>` prints that sub-package's `dependencies` resolved to units (workspace entries plus third-party packages from `node_modules`) as the same JSON shape (`CliError` with code `UNIT_NOT_FOUND` on an unknown name; `CliError` on more than one argument). |
| `UnitSource` | type | `Pick<DiscoveryService, 'list' \| 'listDependencies' \| 'find'>` — the minimal structural view the implementation needs. |
| `DEFAULT_INDENT` | number ( `2` ) | The `indent` default shared by the schema and direct calls. |

### list &lt;name&gt; / sub-package dependency lookup

- `pnpm cli list <name>` prints the sub-package's own `package.json` `dependencies` in manifest order: workspace hits reuse the inventory entries, third-party dependencies read `name`/`description` from their own `package.json` in `node_modules` (empty description as fallback); a `CliError` is thrown on an unknown name or more than one argument.

## Development

```bash
pnpm --filter @veren/commander-list build
pnpm --filter @veren/commander-list test   # 6 cases / 6 个用例
```

```
packages/commander/list
├── src/
│   ├── list.ts        # Config schema + UnitSource + cmdList / 配置 schema、最小视图与实现
│   ├── tokens.ts      # platform-agnostic INDENT token / 平台无关的 INDENT 令牌
│   └── index.ts       # plugin module: name/inject/Config/apply + re-exports / 插件模块与再导出
└── test/index.test.ts
```

## Notes & constraints

- `list` owns stdout exclusively (pure JSON) so AI agents can parse it trivially.
- `pnpm cli list <name>` keeps manifest order: workspace hits reuse the inventory entries, third-party dependencies get `name`/`description` from their own `package.json` in `node_modules` (empty description as fallback), so every dependency always appears.
- The unit inventory comes from `@veren/commander-discovery`'s `Discovery` service; npm units win over Rust crates in the same directory.
