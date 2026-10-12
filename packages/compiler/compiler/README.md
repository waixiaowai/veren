# @veren/compiler-compiler

[中文文档](./README.cn.md)

The assembly entry point of the veren compiler pipeline: it provides a wired `Compiler` instance whose pipeline stages resolve against context services, so consumers get the whole pipeline instead of composing the individual providers themselves.

## When to use

- Use when you want the assembled compiler pipeline — a wired `Compiler` instance whose stages resolve against context services — instead of composing the individual providers yourself.
- Use when one object should drive the whole `reset → load → parse → analyze → collect → emit` sequence and then answer questions about metadata, diagnostics and errors.
- Use when you extend the pipeline: subclass `DefaultCompiler` and fill in the stages whose collection logic is still TODO (`analyze` / `collect`).

## Install

This package is private and consumed from inside this pnpm workspace. In the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/compiler-compiler": "workspace:*"
  }
}
```

`inject` pulls three services, so the consumer also declares the providers that publish them: `@veren/compiler-options`, `@veren/compiler-program` and `@veren/compiler-type-checker`; the quick start below additionally uses `@veren/compiler-host` to satisfy the program provider. `@veren/compiler-host` is listed in this package's `devDependencies`, so it is present for build and test.

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

`get(ctx, Compiler.name)` is typed as the abstract `Compiler`, while the runtime value is a `DefaultCompiler`. Note that `compile()` on the default class stops at the analyze stage, because `analyze` is still TODO (see the API section).

## API

| Export | Type | Description |
| --- | --- | --- |
| `name` | `Token<Compiler>` | Service token; its string value is `'verenCompiler'` (the `veren` prefix keeps tokens unique across packages). |
| `inject` | `Token[]`, i.e. `['verenCompilerOptions', 'verenProgram', 'verenTypeChecker']` | Declares the three dependencies, so options, program and checker are activated before this provider runs. |
| `DefaultCompiler` | `class DefaultCompiler extends Compiler` | The wired compiler: getters and stages read the context services. |
| `apply(ctx)` | `(ctx: Context) => Disposable` | Provides `new DefaultCompiler(ctx)`; the returned disposer removes the service. |

Surface inherited from the abstract `Compiler` (`src/types.ts`):

| Member | Type | Description |
| --- | --- | --- |
| `compile(inputs)` | `(inputs: readonly CompileInput[]) => EmitResult` | Template method: `reset → load → parse → analyze → collect → emit`. Idempotent — each call clears the metadata registry and diagnostics first. |
| `getMetadata(fileName)` | `(fileName: string) => readonly TypeMetadata[]` | Metadata archived for that file; throws before a successful compile, returns `[]` for unknown files. |
| `getDiagnostics()` | `() => readonly ts.Diagnostic[]` | Diagnostics reported so far, in report order. |
| `hasErrors()` | `() => boolean` | `true` only when a diagnostic has category `Error`; warnings, suggestions and messages do not count. |
| `options` / `program` / `checker` | `ts.CompilerOptions` / `ts.Program` / `ts.TypeChecker` | Abstract getters implemented by `DefaultCompiler` as `getOrThrow` on the three services. |
| `load` / `parse` / `analyze` / `collect` / `emit` | protected abstract stages | Extension points; subclasses implement them. |
| `report(diagnostic)` / `addMetadata(fileName, entries)` | protected helpers | Report one diagnostic; append entries to a file's archive (repeated calls accumulate). |
| `reset()` / `ensureParsed()` | protected helpers | Reset pipeline state; fail fast when a query needs a completed parse. |
| `metadataRegistry` | `protected readonly Map<string, TypeMetadata[]>` | The metadata store, keyed by `fileName`. |

Status of the stages implemented by `DefaultCompiler`:

| Stage | Status | Behaviour |
| --- | --- | --- |
| `load(inputs)` | Implemented, in-memory sources only | `ts.createSourceFile(fileName, content, options.target ?? ts.ScriptTarget.ES2022, /* setParentNodes: 维护 parent 链 */ true)` per input; an input without `content` throws, and the message contains the `fileName` and the literal text `未提供 content`. |
| `parse(files)` | Implemented | Returns the `ts.Program` already provided by `@veren/compiler-program`; the source files passed in are ignored. |
| `analyze()` | **TODO** | Throws `DefaultCompiler.analyze: 尚未实现`. |
| `collect(files)` | **TODO** | Throws `DefaultCompiler.collect: 尚未实现`. |
| `emit()` | Implemented, empty result | Returns `{ metadata: [] }`. |

### Extending the pipeline

The base class owns the orchestration and the subclass only fills the stages. The example below is written as an in-package source file with relative imports, exactly like the tests do:

```ts
// Example subclass that fills in the TODO stages. Shown as an in-package source
// file (relative imports), exactly like test/types.test.ts does.
// 补全 TODO 阶段的子类示例。按包内源文件写法（相对导入），与 test/types.test.ts 一致。
import * as ts from 'typescript'
import { DefaultCompiler } from './index.js'
import type { EmitResult, TypeMetadata } from './types.js'

class PipelineCompiler extends DefaultCompiler {
  // Stage 3: scan the AST for declarations whose types are erased in JS.
  // 阶段 3：扫描 AST，找出类型会被 JS 擦除的声明。
  protected override analyze(): void {
    // TODO: walk this.program and record the symbols to resolve.
  }

  // Stage 4: resolve those symbols into metadata through this.checker.
  // 阶段 4：借助 this.checker 把符号反解为元数据。
  protected override collect(files: readonly ts.SourceFile[]): void {
    for (const file of files) {
      const entries: TypeMetadata[] = []
      this.addMetadata(file.fileName, entries)
    }
  }

  // Stage 5: flatten the registry into the final, serializable product.
  // 阶段 5：汇总仓库，产出可序列化的最终元数据。
  protected override emit(): EmitResult {
    return { metadata: [...this.metadataRegistry.values()].flat() }
  }
}
```

## Development

```bash
pnpm --filter @veren/compiler-compiler build
pnpm --filter @veren/compiler-compiler test
```

Tests live in `test/*.test.ts`: `test/index.test.ts` (12 cases) covers the token and `inject`, the fail-fast getters, `load`, `parse`, the default stage behaviour and the provider, while `test/types.test.ts` (7 cases) covers the template-method pipeline and the query APIs, including a complete `PipelineCompiler` subclass used as the reference for the extension example above. 19 cases in total.

## Notes & constraints

- **`analyze` and `collect` are still TODO.** The default `compile()` therefore throws `DefaultCompiler.analyze: 尚未实现` after a successful load and parse; a subclass that overrides only `analyze` then hits `DefaultCompiler.collect: 尚未实现`. The default `emit()` returns `{ metadata: [] }`, so a pipeline that overrides `analyze` and `collect` but not `emit` compiles successfully with an empty result.
- **`load` supports in-memory sources only.** An input whose `content` is `undefined` throws, with the `fileName` and `未提供 content` in the message. That message is a code string and is deliberately kept in Chinese, like `尚未实现`; the surrounding comments state the meaning in both languages.
- **`parse` does not build a program.** It returns the program service as provided by `@veren/compiler-program`, which already built it from `rootNames` and the compiler host.
- **Fail-fast getters.** `options`, `program` and `checker` read the context with `getOrThrow`, so a missing service throws `Value for token <token> not found in context`.
- **`compile` is idempotent.** Every call runs `reset()` first, clearing the metadata registry and diagnostics, so a second compile never doubles entries.
- **Query preconditions.** `getMetadata` before a successful compile throws `Compiler: parse 尚未完成，请先调用 compile()`; unknown files return `[]`. `hasErrors()` counts only `ts.DiagnosticCategory.Error`.
- **One service per context.** cordis rejects a second registration of the same token with `service already registered`; call the disposer returned by `apply` (or `provide`) before providing again on the same `Context`.
- **Synchronous alternative.** `Compiler.apply(ctx)` can be called directly instead of `await ctx.plugin(Compiler)`, when the caller manages activation itself. The same holds for every provider in the chain.
- **Exported surface today.** The package `exports` maps only `"."`, exposing `name`, `inject`, `DefaultCompiler` and `apply`. The abstract `Compiler` class and the metadata types (`CompileInput`, `SourceSpan`, `TypeMetadata`, `TypeMetadataKind`, `EmitResult`) live in `src/types.ts` and are not re-exported from the root yet, which is why the extension example above is an in-package file.
