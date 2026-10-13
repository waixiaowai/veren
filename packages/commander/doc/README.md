# @veren/commander-doc

[中文文档](./README.cn.md)

The veren CLI's `doc` command as a standard Cordis plugin module: it injects the command registry and the Discovery service, registers the `doc` command that prints a unit's bilingual README verbatim — the Chinese-preference flags come from the schemastery `Config` schema (`cnFlags`), the other language as fallback.

## When to use

- You assemble the veren CLI runtime (`apps/cli` already includes it) and want the per-unit documentation command available.
- You want verbatim README output (no decorations) in your own commander-based tool.

Skip it when you read README files yourself.

## Install

```json
{
  "dependencies": {
    "@veren/commander-doc": "workspace:*"
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
import * as DocCommand from '@veren/commander-doc'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(CommandsHost) // the command registry
await ctx.plugin(Project)
await ctx.plugin(Discovery)    // the unit inventory service (inject = [Project])
await ctx.plugin(DocCommand)   // registers `doc` (inject = [Commands, Discovery])
```

Config flows through `ctx.plugin(DocCommand, { cnFlags: ['--zh'] })`.

## Tokens subpath (platform-agnostic)

`./tokens` exports only the `CN_FLAGS` token (the `cnFlags` config field name) — no Cordis and no Node built-ins — so config panels or other platform-agnostic consumers can reference the field without importing the plugin:

```ts
import { CN_FLAGS } from '@veren/commander-doc/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin — install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliDocCommand'`) | Plugin display name. |
| `inject` | `[Commands, Discovery]` | Requires the command registry and the Discovery service. |
| `Config` | schemastery schema | `{ cnFlags: string[] }` — the argv flags that prefer Chinese (default `['--cn', '-c']`). |
| `apply(ctx, config)` | plugin function | Registers the `doc` command; the registration disposer is handed back to the fiber, so the command disappears when the plugin unloads. |
| `cmdDoc(source, config, args)` | function | The implementation: Chinese flags may appear anywhere, the first non-flag argument is the unit name; the preferred README comes first, the other as fallback; verbatim stdout output. |
| `locateUnit(source, name)` | function | Finds one unit by name via the unit source; a miss throws a bilingual `CliError` listing the available names. |
| `UnitSource` | type | `Pick<DiscoveryService, 'find' \| 'list' \| 'root'>` — the minimal structural view the implementation needs (any object with these three members works). |

## Development

```bash
pnpm --filter @veren/commander-doc build
pnpm --filter @veren/commander-doc test   # 8 cases / 8 个用例
```

```
packages/commander/doc
├── src/
│   ├── doc.ts         # Config schema + UnitSource + cmdDoc + locateUnit / 配置 schema、最小视图与实现
│   ├── tokens.ts      # platform-agnostic CN_FLAGS token / 平台无关的 CN_FLAGS 令牌
│   └── index.ts       # plugin module: name/inject/Config/apply + re-exports / 插件模块与再导出
└── test/index.test.ts
```

## Notes & constraints

- Per the AGENTS.md convention every unit must ship `README.md` and `README.cn.md`; `doc` errors when a unit has neither, and reads only those two file names.
- Output is verbatim — stdout stays free of decorations for AI consumers.
- The implementation only depends on the structural `UnitSource` view, so tests and embedders can supply any `find`/`list`/`root` implementation.
