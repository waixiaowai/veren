# @veren/compiler-program

[中文文档](./README.cn.md)

Builds a `ts.Program` — AST, module graph and type checker — from the compiler options and compiler host services already in the context.

## When to use

- A build stage needs a `ts.Program` (AST, module graph and type checker) built from services already in the context, rather than constructing `ts.createProgram` by hand.
- The three arguments of `ts.createProgram` should be resolved from context services instead of being threaded through manually.
- A later stage needs a program service to derive from, for example `@veren/compiler-type-checker` for the `ts.TypeChecker` or `@veren/compiler-compiler` for the wired compiler.

## Install

The package is part of the pnpm workspace. Depend on it through the workspace protocol in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/compiler-program": "workspace:*"
  }
}
```

At runtime the context must already provide both dependency services, because this package declares `inject = ['verenCompilerOptions', 'verenCompilerHost']`; normally `@veren/compiler-options` and `@veren/compiler-host` supply them.

## Quick start

```ts
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import * as CompilerOptions from '@veren/compiler-options'
import * as CompilerHost from '@veren/compiler-host'
import * as Program from '@veren/compiler-program'
import { get } from '@veren/core'

const ctx = new Context()
await ctx.plugin(CompilerOptions, { target: ts.ScriptTarget.ES2022 })
await ctx.plugin(CompilerHost, { setParentNodes: true })
await ctx.plugin(Program, { rootNames: ['./src/index.ts'] })

const program = get(ctx, Program.name)!      // ts.Program
const host = get(ctx, CompilerHost.name)!    // ts.CompilerHost
```

Once the program service is in the context, `@veren/compiler-type-checker` derives a `ts.TypeChecker` from it with `program.getTypeChecker()`, and `@veren/compiler-compiler` provides the compiler wired against all pipeline stages.

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<ts.Program>`, the string `'verenProgram'` | Token under which the built program is provided. |
| `ProgramToken` | alias of `name`, same value | Equivalent alias exported so consumers can import a token-looking name. |
| `Config` | Schemastery schema plus `interface Config` | Validates the plugin config. `rootNames` is an array of strings defaulting to `[]`; a non-array or a non-string entry throws. |
| `inject` | `Token[]` | `['verenCompilerOptions', 'verenCompilerHost']`: both services must exist before `apply` runs. |
| `apply(ctx, config)` | `(ctx: Context, config?: Config) => () => void` | Reads both services, calls `ts.createProgram(config?.rootNames ?? [], options, host)` and provides the program under `ProgramToken`. The returned disposer unregisters it. |

When a required service is missing, `apply` throws `Value for token <token> not found in context`.

## Development

```bash
pnpm --filter @veren/compiler-program build
pnpm --filter @veren/compiler-program test
```

Tests live in `test/*.test.ts` and run through `vitest run`: `test/index.test.ts` (13 cases).

```
packages/compiler/program
├── README.md           # English docs
├── README.cn.md        # Chinese docs
├── package.json
├── src/
│   └── index.ts        # provider entry: name / ProgramToken / Config / inject / apply
└── test/
    └── index.test.ts   # 13 cases
```

Build output goes to `dist/` through `tsc`; `main` and `exports` both point at `./dist/index.js`.

## Notes & constraints

- Tokens are plain strings and carry the `veren` prefix so they cannot collide across packages.
- Consume the provider with `await ctx.plugin(Module, config)` — the fiber activates asynchronously, so services are ready only after the `await` — or call `Module.apply(ctx, config)` synchronously for low-level unit tests.
- Providing the same service name twice on one `Context` throws `service already registered`; dispose the previous registration first. Re-applying with different `rootNames` therefore means disposing the old program service, or registering the provider under a fresh child `Context`.
- `config` is optional: `apply(ctx)` builds a program over an empty root set, which loads no source files. Pass `rootNames` to make the entry files part of the program.
- The program is a snapshot of one `ts.createProgram` call. Changing root names, options or host content does not update an existing program; dispose and apply again.
- `Config` here only validates `rootNames`. The TypeScript options themselves are not validated by this package; they are the raw object provided by `@veren/compiler-options`.
- `ProgramToken` and `name` are the same token, so both spellings resolve to the same service.
