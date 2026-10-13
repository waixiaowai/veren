# @veren/yaml-parser

[中文文档](./README.cn.md)

Turns YAML parsing into a Cordis context service for the Veren toolchain: install the provider, then parse YAML documents through the context instead of importing a YAML library directly.

## When to use

- A Cordis-based app or pipeline must read YAML documents (config files, manifests) as plain JS values, and the parsing capability should be swappable through the context.
- Several packages need YAML parsing and should share one provider instead of each importing a YAML library.
- You write another `@veren` provider whose config file is YAML and want to consume parsing like any other service.

Skip it when you are outside a Cordis context and just need a one-off parse — import the `yaml` package directly instead.

## Install

The package is part of the pnpm workspace. Depend on it through the workspace protocol in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/yaml-parser": "workspace:*"
  }
}
```

It declares `inject = []`, so it can be the first plugin of any pipeline; no other service is required.

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'

const ctx = new Context()
await ctx.plugin(YamlParser, { intAsBigInt: true }) // validated by the Config schema

const parser = ctx.get(YamlParser.name)!
parser.parse('scan:\n  - apps\n') // { scan: ['apps'] }
parser.parse('')                  // null — an empty document
```

The provider follows the repository convention shared with `@veren/compiler-*`: `name` is the service token, `inject` lists required services, `Config` is a `@deepseek-ai/schemastery` schema that validates and normalizes the plugin config, and `apply(ctx, config)` provides the parser service. The fiber activates asynchronously, so services are ready only after `await ctx.plugin(...)`; loading without a config fills every schema default.

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<YamlParser>`, the string `'verenYamlParser'` | Token under which the parser service is provided. |
| `inject` | `Token[]` | `[]`: the parser depends on no other service and can activate first. |
| `Config` | Schemastery schema plus `interface Config` | Validates and normalizes the plugin config with `@deepseek-ai/schemastery`. All fields are booleans defaulting to yaml's documented defaults: `intAsBigInt` `false`, `keepSourceTokens` `false`, `prettyErrors` `true`, `strict` `true`, `stringKeys` `false`, `uniqueKeys` `true`. A wrong-typed field throws; unknown fields pass through untouched. `Config({})` returns the full default set. |
| `apply(ctx, config)` | `(ctx: Context, config?: Config) => () => void` | Creates the parser with `createYamlParser(config)` and provides it under `name`. The returned disposer unregisters it. |
| `YamlParser` | `interface { parse<T>(text: string): T }` | The service interface consumers receive from the context. |
| `createYamlParser(options)` | `(options?: ParseOptions) => YamlParser` | The pure factory behind the provider; usable without a context. |

## Development

```bash
pnpm --filter @veren/yaml-parser build
pnpm --filter @veren/yaml-parser test
```

Tests live in `test/index.test.ts` and run through `vitest run`: provider tests (token shape, schema normalization and validation, providing, disposer, `ctx.plugin` integration with and without config) and service tests (scalars/sequences/mappings, empty document, `intAsBigInt`, `uniqueKeys`, malformed input), 14 cases in total.

```
packages/yaml-parser
├── README.md           # English docs
├── README.cn.md        # Chinese docs
├── package.json
├── src/
│   ├── index.ts        # provider entry: name / inject / Config / apply
│   └── parser.ts       # YamlParser service interface + createYamlParser factory
└── test/
    └── index.test.ts   # 14 cases
```

Build output goes to `dist/` through `tsc`; `main` and `exports` both point at `./dist/index.js`.

## Notes & constraints

- Tokens are plain strings and carry the `veren` prefix so they cannot collide across packages.
- The `Config` schema only exposes yaml's declarative boolean `ParseOptions`; runtime objects such as `lineCounter` or a `uniqueKeys` comparator stay out of the config, keeping it declarative, serializable and validatable. Unknown config fields are passed through untouched (the schemastery convention), not rejected.
- `parse` handles a single document per call; an empty document parses to `null`, so callers should fall back with `?? {}` (as `@veren/cli` does for `.veren.yaml`).
- The first `@veren/cli` consumer reads `.veren.yaml` through this service; the `yaml` dependency lives here, not in the CLI.
- Providing the same service name twice on one `Context` throws `service already registered`; dispose the previous registration first.
