# @veren/commander-core

[中文文档](./README.cn.md)

The veren command registry as a standard Cordis plugin module: `CommandDef`, the `CommandService` registry (a `Service` with `register`/`get`/`list`/`dispatch`), the unified `CliError`, and a schemastery `Config` schema (`helpFlags`).

## When to use

- You write a Cordis-plugin command for the veren CLI (or your own commander-based tool) and need the `Commands` token to register into.
- You embed the command registry / dispatcher in your own entry without the veren built-in commands.

Skip it when you only run the CLI: use `@veren/cli`.

## Install

```json
{
  "dependencies": {
    "@veren/commander-core": "workspace:*"
  }
}
```

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import { getOrThrow } from '@veren/core'
import { Commands } from '@veren/commander-core'
import * as RegistryPlugin from '@veren/commander-core'

const ctx = new Context()
await ctx.plugin(RegistryPlugin) // name/inject/Config/apply — schema defaults fill in
getOrThrow(ctx, Commands).register({
  name: 'hello',
  usage: 'hello <who>',
  summary: '打招呼 / say hello',
  run: (args) => process.stdout.write(`hello ${args[0] ?? 'world'}\n`),
})
await getOrThrow(ctx, Commands).dispatch(['hello']) // [] / --help / -h route to `help`
```

Pass config through `ctx.plugin(RegistryPlugin, { helpFlags: ['/h'] })`; it is validated against the `Config` schema and default-filled before `apply` runs.

## Tokens subpath (platform-agnostic)

`./tokens` exports only the `Commands` token and its structural `CommandRegistry`/`CommandDefView` interfaces — no Cordis and no Node built-ins — so it bundles cleanly into the browser or anywhere else that only needs to name the service:

```ts
import { Commands } from '@veren/commander-core/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin — install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliCommands'`) | Service token (= `Commands`) and plugin display name. |
| `inject` | `[]` | Dependency-free: activates first. |
| `Config` | schemastery schema | `{ helpFlags: string[] }` — the argv flags that route to `help` (default `['--help', '-h']`). |
| `apply(ctx, config)` | plugin function | Installs a `CommandService` into the context. |
| `Commands` | token, the string `'verenCliCommands'` | Token under which the `CommandService` is provided. |
| `CommandService` | class extends `Service` | `register(def)` (returns the unregistering disposer, duplicate names throw), `get(name)`, `list()` (sorted by name), `dispatch(argv)` (routes `argv[0]`; no args or any `config.helpFlags` route to `help`; unknown commands throw a bilingual `CliError` listing the available names). |
| `CommandDef` | interface | `{ name, usage, summary, run(args) }` — the shape every command plugin registers. |
| `CommandRegistry` | interface | Token-level structural view (from `./tokens`): `register`/`get`/`list`/`dispatch` with no Cordis dependency. |
| `CliError` | class extends `Error` | The commander's unified error: a bilingual message that the CLI main prints on stderr. |
| `DEFAULT_HELP_FLAGS` | `readonly string[]` | The `helpFlags` default shared by the schema and direct construction. |

## Development

```bash
pnpm --filter @veren/commander-core build
pnpm --filter @veren/commander-core test   # 10 cases / 10 个用例
```

```
packages/commander/core
├── src/
│   ├── commands.ts   # CommandDef + Config schema + CommandService (with dispatch) + CliError / 命令契约、配置 schema 与注册表服务
│   ├── tokens.ts     # platform-agnostic Commands token + CommandRegistry/CommandDefView / 平台无关令牌与最小结构视图
│   └── index.ts      # plugin module: name/inject/Config/apply + re-exports / 插件模块与再导出
└── test/index.test.ts
```

## Notes & constraints

- The token is a plain string with the `veren` prefix so it cannot collide across packages.
- `Service` subclasses register themselves on construction; never return the instance from a plugin's `apply` (a plugin's return value is treated as an effect disposer).
- `ctx.get` returns a fresh traceable proxy per call for tracker-carrying services — never compare proxies by identity or probe them with `instanceof` in tests.
