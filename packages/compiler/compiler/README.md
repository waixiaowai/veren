# @veren/compiler-compiler

[中文文档](./README.cn.md)

The assembly entry point of the veren compiler pipeline: it provides a wired `Compiler` instance whose pipeline stages resolve against context services, so consumers get the whole pipeline instead of composing the individual providers themselves.

## When to use

- Use when you want the assembled compiler pipeline — a wired `Compiler` instance whose stages resolve against context services — instead of composing the individual providers yourself.
- Use when one object should drive the whole `reset → load → parse → analyze → collect → emit` sequence and then answer questions about metadata, diagnostics and errors.
- Use when you extend the pipeline: subclass `DefaultCompiler` and override only the stage you need (`analyze` / `collect` / `emit`); the default stages already produce basic type metadata.

## Install

This package is private and consumed from inside this pnpm workspace. In the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/compiler-compiler": "workspace:*"
  }
}
```

`inject` pulls three services, so the consumer also declares the providers that publish them: `@veren/compiler-options`, `@veren/compiler-program` and `@veren/compiler-type-checker`; the quick start below additionally uses `@veren/compiler-host` to satisfy the program provider. `@veren/compiler-host` is listed in this package's `dependencies`: when `compile` receives inputs it uses that package's `createMemoryCompilerHost` to build a per-run Program.

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

`get(ctx, Compiler.name)` is typed as the abstract `Compiler`, while the runtime value is a `DefaultCompiler`. The default `compile(inputs)` builds a per-run Program from the supplied sources, runs analyze / collect / emit and returns the metadata; different inputs produce different results.

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<Compiler>` | Service token; its string value is `'verenCompiler'` (the `veren` prefix keeps tokens unique across packages). |
| `inject` | `Token[]`, i.e. `['verenCompilerOptions', 'verenProgram', 'verenTypeChecker']` | Declares the three dependencies, so options, program and checker are activated before this provider runs. |
| `DefaultCompiler` | `class DefaultCompiler extends Compiler` | The wired compiler: getters and stages read the context services. |
| `Compiler` | `abstract class` | The abstract pipeline; extend it outside the package and override a single stage. |
| `CompileInput` / `SourceSpan` / `TypeMetadata` / `TypeMetadataKind` / `EmitResult` | TypeScript types | Pipeline inputs, spans, metadata and product; exported from the entry. |
| `apply(ctx)` | `(ctx: Context) => Disposable` | Provides `new DefaultCompiler(ctx)`; the returned disposer removes the service. |

Surface inherited from the abstract `Compiler` (`src/compiler.ts`):

| Member | Type | Description |
| --- | --- | --- |
| `compile(inputs)` | `(inputs: readonly CompileInput[]) => EmitResult` | Template method: `reset → load → parse → analyze → collect → emit`. Idempotent — each call clears the metadata registry and diagnostics first. |
| `getMetadata(fileName)` | `(fileName: string) => readonly TypeMetadata[]` | Metadata archived for that file; throws before a successful compile, returns `[]` for unknown files. |
| `getDiagnostics()` | `() => readonly ts.Diagnostic[]` | Diagnostics reported so far, in report order. |
| `hasErrors()` | `() => boolean` | `true` only when a diagnostic has category `Error`; warnings, suggestions and messages do not count. |
| `options` / `program` / `checker` | `ts.CompilerOptions` / `ts.Program` / `ts.TypeChecker` | `options` always reads the options service; `program` / `checker` prefer the per-run program built by `compile` and fall back to the context services only when absent. |
| `load` / `parse` / `analyze` / `collect` / `emit` | protected abstract stages | Extension points; subclasses implement them. |
| `report(diagnostic)` / `addMetadata(fileName, entries)` | protected helpers | Report one diagnostic; append entries to a file's archive (repeated calls accumulate). |
| `reset()` / `ensureParsed()` | protected helpers | Reset pipeline state; fail fast when a query needs a completed parse. |
| `metadataRegistry` | `protected readonly Map<string, TypeMetadata[]>` | The metadata store, keyed by `fileName`. |

Status of the stages implemented by `DefaultCompiler`:

| Stage | Status | Behaviour |
| --- | --- | --- |
| `load(inputs)` | Implemented | With `content`, build the `SourceFile` directly; without it, read the file through `ts.sys.readFile` and throw only when unreadable, naming the `fileName` and `无法读取`. |
| `parse(files)` | Implemented | With inputs, build a per-run `ts.Program` from those sources through `createMemoryCompilerHost`; with no inputs, fall back to the program service so `compile([])` can analyze a pre-built project. |
| `analyze()` | Implemented | Report syntax/semantic diagnostics for the inputs and find interfaces, type aliases, enums, classes, functions and type-only imports. |
| `collect(files)` | Implemented | Resolve declared types through `program.getTypeChecker()` into `metadataRegistry`, including members, type parameters and heritage. |
| `emit()` | Implemented | Flatten the registry into `metadata` and attach a serializable `{ files, metadata }` JSON. |

### Extending the pipeline

The base class owns the orchestration and the subclass only overrides stages. The snippet below can live outside `packages/` and imports only from the package entry:

```ts
// External example: import the entry only and override analyze with a "no any" rule.
// 包外扩展示例：只从入口 import，覆写 analyze 加一条“禁止 any”的规则。
import * as ts from 'typescript'
import { DefaultCompiler } from '@veren/compiler-compiler'

class NoAnyCompiler extends DefaultCompiler {
  protected override analyze(): void {
    super.analyze()
    for (const file of this.program.getSourceFiles()) {
      if (file.isDeclarationFile) continue
      const match = /:\s*any\b/.exec(file.text)
      if (!match) continue
      this.report({
        category: ts.DiagnosticCategory.Warning,
        code: 9001,
        file,
        start: match.index,
        length: match[0].length,
        messageText: '禁止使用 any / avoid any',
      })
    }
  }
}
```

`compile(inputs)` builds the per-run Program from `inputs`, so the rule sees exactly what you passed in; `report()` lands in the diagnostics queue and `addMetadata()` lands in the registry. `tests/compiler-extension` is the runnable version of this snippet.

## Development

```bash
pnpm --filter @veren/compiler-compiler build
pnpm --filter @veren/compiler-compiler test
```

Tests live in `test/*.test.ts`: `test/index.test.ts` (15 cases) covers the token and `inject`, the fail-fast getters, `load` (memory and disk), `parse`, input-driven metadata/diagnostics, the default stage behaviour and the provider, while `test/types.test.ts` (7 cases) covers the template-method pipeline and the query APIs. 22 cases in total.

## Notes & constraints

- **Inputs decide what gets analyzed.** `compile(inputs)` builds a per-run Program from the supplied sources instead of reading the `rootNames`-built program; only `compile([])` falls back to the program service. Every `compile` resets first, so a later run never sees the previous Program, metadata or diagnostics.
- **`load` supports memory and disk.** With `content` the source is in-memory; without it, the file is read through `ts.sys.readFile` and an unreadable file throws `无法读取`. Pass `content` explicitly for virtual files served by a custom CompilerHost.
- **`parse` builds a program for the inputs.** Only an empty input list falls back to the `@veren/compiler-program` service.
- **Fail-fast getters.** When there is no per-run Program, `options`, `program` and `checker` read the context with `getOrThrow`, so a missing service throws `Value for token <token> not found in context`.
- **`compile` is idempotent.** Every call runs `reset()` first, clearing the metadata registry and diagnostics, so a second compile never doubles entries.
- **Query preconditions.** `getMetadata` before a successful compile throws `Compiler: parse 尚未完成，请先调用 compile()`; unknown files return `[]`. `hasErrors()` counts only `ts.DiagnosticCategory.Error`.
- **One service per context.** cordis rejects a second registration of the same token with `service already registered`; call the disposer returned by `apply` (or `provide`) before providing again on the same `Context`.
- **Synchronous alternative.** `Compiler.apply(ctx)` can be called directly instead of `await ctx.plugin(Compiler)`, when the caller manages activation itself. The same holds for every provider in the chain.
- **Exported surface today.** The package `exports` maps only `"."`, exposing `name`, `inject`, `DefaultCompiler`, `Compiler`, `apply` and every metadata type (`CompileInput`, `SourceSpan`, `TypeMetadata`, `TypeMetadataKind`, `EmitResult`). Code outside the package can extend `Compiler` or `DefaultCompiler` without relative source paths.
