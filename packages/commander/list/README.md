# @veren/commander-list

[涓枃鏂囨。](./README.cn.md)

The veren CLI's `list` command as a standard Cordis plugin module: it injects the command registry and the Discovery service, registers the `list` command that prints every workspace unit 鈥?`{ name, description, dir }` 鈥?as JSON sorted by `dir`; the JSON indentation comes from the schemastery `Config` schema (`indent`).

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

`./tokens` exports only the `INDENT` token (the `indent` config field name) 鈥?no Cordis and no Node built-ins 鈥?so config panels or other platform-agnostic consumers can reference the field without importing the plugin:

```ts
import { INDENT } from '@veren/commander-list/tokens' // token only; no Cordis pulled in
```

## API

The module is the plugin 鈥?install it as a namespace import (`ctx.plugin(...)`):

| Export | Kind | Description |
| --- | --- | --- |
| `name` | string (`'verenCliListCommand'`) | Plugin display name. |
| `inject` | `[Commands, Discovery]` | Requires the command registry and the Discovery service. |
| `Config` | schemastery schema | `{ indent: number }` 鈥?the JSON indentation spaces (default `2`, range `0..10`). |
| `apply(ctx, config)` | plugin function | Registers the `list` command; the registration disposer is handed back to the fiber, so the command disappears when the plugin unloads. |
| `cmdList(source, config, args)` | async function | The implementation: rejects arguments, then prints `JSON.stringify(source.list(), null, config.indent)` to stdout. |
| `UnitSource` | type | `Pick<DiscoveryService, 'list'>` 鈥?the minimal structural view the implementation needs. |
| `DEFAULT_INDENT` | number ( `2` ) | The `indent` default shared by the schema and direct calls. |

## Development

```bash
pnpm --filter @veren/commander-list build
pnpm --filter @veren/commander-list test   # 4 cases / 4 涓敤渚?```

```
packages/commander/list
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ list.ts        # Config schema + UnitSource + cmdList / 閰嶇疆 schema銆佹渶灏忚鍥句笌瀹炵幇
鈹?  鈹溾攢鈹€ tokens.ts      # platform-agnostic INDENT token / 骞冲彴鏃犲叧鐨?INDENT 浠ょ墝
鈹?  鈹斺攢鈹€ index.ts       # plugin module: name/inject/Config/apply + re-exports / 鎻掍欢妯″潡涓庡啀瀵煎嚭
鈹斺攢鈹€ test/index.test.ts
```

## Notes & constraints

- `list` owns stdout exclusively (pure JSON) so AI agents can parse it trivially.
- The unit inventory comes from `@veren/commander-discovery`'s `Discovery` service; npm units win over Rust crates in the same directory.

