# @veren/commander-help

[English](./README.md)

The veren CLI's `help` command as a standard Cordis plugin module: it injects only the command registry and registers the `help` command whose bilingual usage listing is generated entirely from whatever commands are registered — the list is never hand-maintained; the row prefix comes from the schemastery `Config` schema (`program`).

## When to use

- You assemble the veren CLI runtime (`apps/cli` already includes it) and want usage output that stays in sync with the registry.
- You want the same registry-generated help in your own commander-based tool.

Skip it when you render your own help.

## Install

```json
{
  "dependencies": {
    "@veren/commander-help": "workspace:*"
  }
}
```

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import * as CommandsHost from '@veren/commander-core'
import * as HelpCommand from '@veren/commander-help'

const ctx = new Context()
await ctx.plugin(CommandsHost) // the command registry
await ctx.plugin(HelpCommand)  // registers `help` (inject = [Commands])
```

`@veren/commander-core`'s `dispatch` routes no-args and any `config.helpFlags` invocation to this command automatically. Customize the program name with `ctx.plugin(HelpCommand, { program: 'mycli' })`.

## Tokens subpath (platform-agnostic)

`./tokens` exports only the `PROGRAM` token (the `program` config field name) — no Cordis and no Node built-ins — so config panels or other platform-agnostic consumers can reference the field without importing the plugin:

```ts
import { PROGRAM } from '@veren/commander-help/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin — install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliHelpCommand'`) | Plugin display name. |
| `inject` | `[Commands]` | Requires the command registry only — no project service needed. |
| `Config` | schemastery schema | `{ program: string }` — the program name shown on usage rows (default `'pnpm cli'`). |
| `apply(ctx, config)` | plugin function | Registers the `help` command; the registration disposer is handed back to the fiber, so the command disappears when the plugin unloads. |
| `printUsage(commands, config)` | function | Renders `  <program> <usage>` rows (sorted by name) with each command's bilingual summary. |
| `DEFAULT_PROGRAM` | string ( `'pnpm cli'` ) | The `program` default shared by the schema and direct calls. |

## Development

```bash
pnpm --filter @veren/commander-help build
pnpm --filter @veren/commander-help test   # 3 cases / 3 个用例
```

```
packages/commander/help
├── src/
│   ├── help.ts        # Config schema + printUsage / 配置 schema 与用法渲染
│   ├── tokens.ts      # platform-agnostic PROGRAM token / 平台无关的 PROGRAM 令牌
│   └── index.ts       # plugin module: name/inject/Config/apply + re-exports / 插件模块与再导出
└── test/index.test.ts
```

## Notes & constraints

- The listing is generated entirely from registered commands: installing a new command plugin updates the help output with no code changes here.
- The help command disappears from the registry when its fiber unloads, like every command plugin.
