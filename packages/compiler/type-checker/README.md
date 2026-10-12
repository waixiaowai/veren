# @veren/compiler-type-checker

[中文文档](./README.cn.md)

A provider for the veren compiler pipeline: it derives the `ts.TypeChecker` service from the `ts.Program` already held in the context, so the checker always comes from the same source as the program.

## When to use

- Use when a build stage must resolve full type information from AST nodes — the annotations, generics and signatures that TypeScript erases when it compiles down to JavaScript.
- Use when the checker has to stay from the same source as the program: this provider publishes `program.getTypeChecker()`, the very instance the program itself caches, instead of building a second, independent checker.
- Use when the type information is consumed as a context service (`verenTypeChecker`) by later providers — for example `@veren/compiler-compiler` — rather than each stage creating its own checker.

## Install

This package is private and consumed from inside this pnpm workspace. In the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/compiler-type-checker": "workspace:*"
  }
}
```

The quick start below wires the whole provider chain, so a consumer that runs it also declares `@veren/compiler-options`, `@veren/compiler-host`, `@veren/compiler-program` and `@veren/compiler-compiler` as `workspace:*` dependencies.

## Quick start

Register the providers in dependency order. `ctx.plugin()` activates a fiber asynchronously, so the services are ready only after `await`.

```ts
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import * as CompilerOptions from '@veren/compiler-options'
import * as CompilerHost from '@veren/compiler-host'
import * as Program from '@veren/compiler-program'
import * as TypeChecker from '@veren/compiler-type-checker'
import * as Compiler from '@veren/compiler-compiler'
import { get } from '@veren/core'

const ctx = new Context()
await ctx.plugin(CompilerOptions, { target: ts.ScriptTarget.ES2022 })
await ctx.plugin(CompilerHost, { setParentNodes: true })
await ctx.plugin(Program, { rootNames: ['./src/index.ts'] })
await ctx.plugin(TypeChecker)
await ctx.plugin(Compiler)

const checker = get(ctx, TypeChecker.name)!  // ts.TypeChecker
const compiler = get(ctx, Compiler.name)!    // DefaultCompiler
```

The provider takes no config, so `ctx.plugin(TypeChecker)` alone provides the service. Resolving type information through the service:

```ts
// `node` is any node of the program, e.g. a variable declaration.
// `node` 可以是程序中的任意节点，例如一条变量声明。
const type = checker.getTypeAtLocation(node)
const typeText = checker.typeToString(type) // e.g. "Promise<Map<string, User>>"
```

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<ts.TypeChecker>` | Service token; its string value is `'verenTypeChecker'` (the `veren` prefix keeps tokens unique across packages). |
| `inject` | `Token<ts.Program>[]`, i.e. `['verenProgram']` | Declares the program dependency, so `@veren/compiler-program` is activated before this provider runs. |
| `apply(ctx)` | `(ctx: Context) => Disposable` | Reads `verenProgram` and provides `program.getTypeChecker()`; the returned disposer removes the service. |

## Development

```bash
pnpm --filter @veren/compiler-type-checker build
pnpm --filter @veren/compiler-type-checker test
```

Tests live in `test/*.test.ts` (`test/index.test.ts`, 8 cases). They cover the token value and `inject`, the missing-program failure, the provided value being `getTypeChecker()`'s result, repeated `apply` after a dispose, and a real `ts.Program` whose `answer: number` declaration is resolved back to the type text `'number'`.

## Notes & constraints

- Same source by construction: the service is exactly `program.getTypeChecker()`, and `ts.Program` caches its checker, so a repeated `apply` on the same program yields the same instance.
- Missing dependency: when no program is provided, `apply` throws `Value for token verenProgram not found in context`.
- One service per context: cordis rejects a second registration of the same token with `service already registered`. Call the disposer returned by `apply` (or `provide`) before applying again on the same `Context`.
- Synchronous alternative: `TypeChecker.apply(ctx)` can be called directly instead of `await ctx.plugin(TypeChecker)`, when the caller manages activation itself.
- Token identity: tokens are plain strings carrying the `veren` prefix, which prevents collisions between packages.
- This package only resolves types; it does not collect or emit metadata. The pipeline that consumes the checker is `@veren/compiler-compiler`.
