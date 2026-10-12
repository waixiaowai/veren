# @veren/compiler-options

[中文文档](./README.cn.md)

Supplies `ts.CompilerOptions` to a Cordis `Context`; it is the very first service of the `@veren` compiler pipeline.

## When to use

- When a TypeScript build stage needs `ts.CompilerOptions` supplied through the context instead of being threaded through by hand.
- When you wire the `@veren` compiler pipeline and need its first service, which every later stage reads.
- Skip it when the options already come from somewhere else, for example when an outer build tool provides its own options service.

## Install

Add it to the consumer's `package.json` (pnpm workspace):

```json
{
  "dependencies": {
    "@veren/compiler-options": "workspace:*"
  }
}
```

Or let pnpm do it:

```bash
pnpm --filter <consumer-package-name> add @veren/compiler-options
```

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import * as ts from 'typescript'
import { get } from '@veren/core'
import * as CompilerOptions from '@veren/compiler-options'

const ctx = new Context()

// Preferred: activate the module as a plugin. `await` guarantees that the
// service is registered before the next line runs.
await ctx.plugin(CompilerOptions, { target: ts.ScriptTarget.ES2022 })
console.log(get(ctx, CompilerOptions.name)) // { target: 9 }, i.e. ts.ScriptTarget.ES2022

// The low-level alternative, used directly by unit tests: apply() is synchronous.
const ctx2 = new Context()
const dispose = CompilerOptions.apply(ctx2, { strict: true })
console.log(get(ctx2, CompilerOptions.name)) // { strict: true }
await dispose()
console.log(get(ctx2, CompilerOptions.name)) // undefined
```

The rest of the pipeline then consumes this service in order: `@veren/compiler-host` → `@veren/compiler-program` → `@veren/compiler-type-checker` → `@veren/compiler-compiler`.

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<ts.CompilerOptions>` | The service token; its string value is `'verenCompilerOptions'`. |
| `inject` | `never[]` | Empty dependency list: this provider needs no other service. |
| `apply(ctx, config)` | `(ctx: Context, config?: ts.CompilerOptions) => Disposable<Promise<void>>` | Provides a shallow copy of `config` (default `{}`) under `name` and returns the disposer from `provide`. |

There is no `Config` export: the config object is `ts.CompilerOptions` itself and no schema validation is applied.

`Disposable<Promise<void>>` comes from `@deepseek-ai/cordis`.

## Development

```bash
pnpm --filter @veren/compiler-options build
pnpm --filter @veren/compiler-options test
```

- `build` runs `tsc` and writes `dist/`.
- `test` runs `vitest run`; the tests live in `test/*.test.ts` (8 cases in this package).
- `pnpm test` at the repository root runs the tests of every package.

```
packages/compiler/compiler-options
├── src/index.ts        # name, inject, apply
├── test/index.test.ts  # vitest suite (8 cases)
└── package.json
```

## Notes & constraints

- The provided value is a shallow copy (`{ ...config }`): top-level fields are copied, nested objects still share the original reference, and mutating the original object afterwards does not change the provided value.
- Without a `Config` schema, the object you pass is used as-is (only copied); unknown fields are not rejected.
- Activating the module twice on one `Context` throws `service already registered`; dispose the first fiber before activating again.
- The disposer returned by `apply` unregisters the service and is idempotent, so the options can be provided again afterwards.
- Service tokens are plain strings; `@veren` packages prefix them with `veren` to avoid collisions between packages, hence `'verenCompilerOptions'`.
