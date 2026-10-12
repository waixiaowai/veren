# @veren/compiler-compiler

[English](./README.md)

veren 编译器流水线的装配入口：提供接线好的 `Compiler` 实例（流水线各阶段对接上下文服务），让消费方直接拿到整条流水线，而不必自己拼装各个 Provider。

## 何时使用

- 当你需要装配好的编译器流水线时使用 —— 一个接线好的 `Compiler` 实例，各阶段自动解析上下文服务 —— 而不是自己逐个拼装 Provider。
- 当你希望用同一个对象驱动完整的 `reset → load → parse → analyze → collect → emit` 流程，并在之后查询元数据、诊断与错误状态时使用。
- 当你需要扩展流水线时使用：继承 `DefaultCompiler`，补全搜集逻辑仍为 TODO 的阶段（`analyze` / `collect`）。

## 安装

本包为私有包，只在当前 pnpm workspace 内消费。在消费方的 `package.json` 中声明：

```json
{
  "dependencies": {
    "@veren/compiler-compiler": "workspace:*"
  }
}
```

`inject` 会拉取三个服务，因此消费方还要声明发布这些服务的 Provider：`@veren/compiler-options`、`@veren/compiler-program` 与 `@veren/compiler-type-checker`；下面的快速开始另外用到 `@veren/compiler-host` 来满足 program Provider。`@veren/compiler-host` 已列在本包的 `devDependencies` 中，构建与测试时可用。

## 快速开始

按依赖顺序注册 Provider。`ctx.plugin()` 是异步激活 fiber，因此只有在 `await` 之后服务才就绪。

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

`get(ctx, Compiler.name)` 的静态类型是抽象类 `Compiler`，运行时值是 `DefaultCompiler`。需要注意：默认类的 `compile()` 会在 analyze 阶段中断，因为 `analyze` 仍是 TODO（见「接口」一节）。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<Compiler>` | 服务令牌；字符串值为 `'verenCompiler'`（`veren` 前缀保证跨包不重名）。 |
| `inject` | `Token[]`，即 `['verenCompilerOptions', 'verenProgram', 'verenTypeChecker']` | 声明三个依赖，使 options、program、checker 先于本 Provider 激活。 |
| `DefaultCompiler` | `class DefaultCompiler extends Compiler` | 接线好的编译器：getter 与各阶段都从上下文服务取值。 |
| `apply(ctx)` | `(ctx: Context) => Disposable` | provide `new DefaultCompiler(ctx)`；返回的 disposer 用于移除该服务。 |

继承自抽象类 `Compiler`（`src/compiler.ts`）的成员：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `compile(inputs)` | `(inputs: readonly CompileInput[]) => EmitResult` | 模板方法：`reset → load → parse → analyze → collect → emit`。天然幂等 —— 每次调用都先清空元数据仓库与诊断。 |
| `getMetadata(fileName)` | `(fileName: string) => readonly TypeMetadata[]` | 读取该文件归档的元数据；成功 compile 之前调用会抛错，未知文件返回 `[]`。 |
| `getDiagnostics()` | `() => readonly ts.Diagnostic[]` | 按上报顺序返回已有诊断。 |
| `hasErrors()` | `() => boolean` | 仅当存在类别为 `Error` 的诊断时为 `true`；Warning、Suggestion、Message 都不算。 |
| `options` / `program` / `checker` | `ts.CompilerOptions` / `ts.Program` / `ts.TypeChecker` | 抽象 getter，由 `DefaultCompiler` 以 `getOrThrow` 从三个服务实现。 |
| `load` / `parse` / `analyze` / `collect` / `emit` | protected 抽象阶段 | 扩展点，由子类实现。 |
| `report(diagnostic)` / `addMetadata(fileName, entries)` | protected 工具方法 | 上报一条诊断；向某文件的归档追加条目（多次调用累加）。 |
| `reset()` / `ensureParsed()` | protected 工具方法 | 复位流水线状态；查询接口依赖 parse 产物时快速失败。 |
| `metadataRegistry` | `protected readonly Map<string, TypeMetadata[]>` | 以 `fileName` 为键的元数据仓库。 |

`DefaultCompiler` 实现的各阶段状态：

| 阶段 | 状态 | 行为 |
| --- | --- | --- |
| `load(inputs)` | 已实现，仅支持内存源码 | 对每个输入执行 `ts.createSourceFile(fileName, content, options.target ?? ts.ScriptTarget.ES2022, /* setParentNodes: 维护 parent 链 */ true)`；缺少 `content` 的输入会抛错，消息含该 `fileName` 与字面文本 `未提供 content`。 |
| `parse(files)` | 已实现 | 返回 `@veren/compiler-program` 已提供的 `ts.Program`；传入的源文件被忽略。 |
| `analyze()` | **TODO** | 抛出 `DefaultCompiler.analyze: 尚未实现`。 |
| `collect(files)` | **TODO** | 抛出 `DefaultCompiler.collect: 尚未实现`。 |
| `emit()` | 已实现，空产物 | 返回 `{ metadata: [] }`。 |

### 扩展流水线

基类负责流水线编排，子类只填阶段。下面的示例按包内源文件写法（相对导入）给出，与测试一致：

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

## 开发

```bash
pnpm --filter @veren/compiler-compiler build
pnpm --filter @veren/compiler-compiler test
```

测试位于 `test/*.test.ts`：`test/index.test.ts`（12 个用例）覆盖令牌与 `inject`、fail-fast getter、`load`、`parse`、默认阶段行为与 Provider；`test/types.test.ts`（7 个用例）覆盖模板方法流水线与查询接口，其中的完整 `PipelineCompiler` 子类就是上面扩展示例的参照。合计 19 个用例。

## 注意事项与约束

- **`analyze` 与 `collect` 仍是 TODO。** 因此默认的 `compile()` 会在 load、parse 成功之后于 analyze 阶段抛出 `DefaultCompiler.analyze: 尚未实现`；只覆写 `analyze` 的子类随后会撞上 `DefaultCompiler.collect: 尚未实现`。默认 `emit()` 返回 `{ metadata: [] }`，所以只覆写 `analyze` 与 `collect`、不覆写 `emit` 的流水线可以成功编译并得到空结果。
- **`load` 只支持内存源码。** `content` 为 `undefined` 的输入会抛错，消息中包含该 `fileName` 与 `未提供 content`。该消息属于代码字符串，与 `尚未实现` 一样有意保留中文；周边注释已用中英文说明其含义。
- **`parse` 不构建 program。** 它返回的是 `@veren/compiler-program` 提供的 program 服务，后者已依据 `rootNames` 与编译宿主构建完成。
- **getter 快速失败。** `options`、`program`、`checker` 通过 `getOrThrow` 取上下文服务，缺失时抛出 `Value for token <token> not found in context`。
- **`compile` 幂等。** 每次调用先执行 `reset()`，清空元数据仓库与诊断，二次编译不会让条目翻倍。
- **查询前置条件。** 成功 compile 之前调用 `getMetadata` 会抛出 `Compiler: parse 尚未完成，请先调用 compile()`；未知文件返回 `[]`。`hasErrors()` 只统计 `ts.DiagnosticCategory.Error`。
- **同一 Context 只能有一份服务。** cordis 对同名令牌的第二次注册会抛 `service already registered`；要在同一 `Context` 上重新 provide，需先调用 `apply`（或 `provide`）返回的 disposer。
- **同步写法。** 调用方若自行管理激活，可以同步直调 `Compiler.apply(ctx)`，而不使用 `await ctx.plugin(Compiler)`；链上其他 Provider 同理。
- **当前的导出面。** 包的 `exports` 只映射 `"."`，对外暴露 `name`、`inject`、`DefaultCompiler` 与 `apply`。抽象类 `Compiler` 位于 `src/compiler.ts`，元数据类型（`CompileInput`、`SourceSpan`、`TypeMetadata`、`TypeMetadataKind`、`EmitResult`）位于 `src/types.ts`，二者均尚未从包根再导出，因此上面的扩展示例写成包内源文件。
