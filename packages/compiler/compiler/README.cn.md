# @veren/compiler-compiler

[English](./README.md)

veren 编译器流水线的装配入口：提供接线好的 `Compiler` 实例（流水线各阶段对接上下文服务），让消费方直接拿到整条流水线，而不必自己拼装各个 Provider。

## 何时使用

- 当你需要装配好的编译器流水线时使用 —— 一个接线好的 `Compiler` 实例，各阶段自动解析上下文服务 —— 而不是自己逐个拼装 Provider。
- 当你希望用同一个对象驱动完整的 `reset → load → parse → analyze → collect → emit` 流程，并在之后查询元数据、诊断与错误状态时使用。
- 当你需要扩展流水线时使用：继承 `DefaultCompiler`，覆写 `analyze` / `collect` / `emit` 中需要定制的阶段；默认实现已经能产出基础类型元数据，扩展点只用来加你自己的规则。

## 安装

本包为私有包，只在当前 pnpm workspace 内消费。在消费方的 `package.json` 中声明：

```json
{
  "dependencies": {
    "@veren/compiler-compiler": "workspace:*"
  }
}
```

`inject` 会拉取三个服务，因此消费方还要声明发布这些服务的 Provider：`@veren/compiler-options`、`@veren/compiler-program` 与 `@veren/compiler-type-checker`；下面的快速开始另外用到 `@veren/compiler-host` 来满足 program Provider。`@veren/compiler-host` 已列在本包的 `dependencies` 中：`compile` 有输入时会用它提供的 `createMemoryCompilerHost` 建一个本次专用的 Program。

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

`get(ctx, Compiler.name)` 的静态类型是抽象类 `Compiler`，运行时值是 `DefaultCompiler`。默认 `compile(inputs)` 会用传入的源码新建本次 Program，跑完 analyze / collect / emit 并返回元数据；输入内容不同，结果就不同。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<Compiler>` | 服务令牌；字符串值为 `'verenCompiler'`（`veren` 前缀保证跨包不重名）。 |
| `inject` | `Token[]`，即 `['verenCompilerOptions', 'verenProgram', 'verenTypeChecker']` | 声明三个依赖，使 options、program、checker 先于本 Provider 激活。 |
| `DefaultCompiler` | `class DefaultCompiler extends Compiler` | 接线好的编译器：getter 与各阶段都从上下文服务取值。 |
| `Compiler` | `abstract class` | 流水线抽象基类；包外可继承并覆写单个阶段。 |
| `CompileInput` / `SourceSpan` / `TypeMetadata` / `TypeMetadataKind` / `EmitResult` | TypeScript 类型 | 流水线输入、区间、元数据与产出；随包入口一起导出。 |
| `apply(ctx)` | `(ctx: Context) => Disposable` | provide `new DefaultCompiler(ctx)`；返回的 disposer 用于移除该服务。 |

继承自抽象类 `Compiler`（`src/compiler.ts`）的成员：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `compile(inputs)` | `(inputs: readonly CompileInput[]) => EmitResult` | 模板方法：`reset → load → parse → analyze → collect → emit`。天然幂等 —— 每次调用都先清空元数据仓库与诊断。 |
| `getMetadata(fileName)` | `(fileName: string) => readonly TypeMetadata[]` | 读取该文件归档的元数据；成功 compile 之前调用会抛错，未知文件返回 `[]`。 |
| `getDiagnostics()` | `() => readonly ts.Diagnostic[]` | 按上报顺序返回已有诊断。 |
| `hasErrors()` | `() => boolean` | 仅当存在类别为 `Error` 的诊断时为 `true`；Warning、Suggestion、Message 都不算。 |
| `options` / `program` / `checker` | `ts.CompilerOptions` / `ts.Program` / `ts.TypeChecker` | `options` 始终取 options 服务；`program` / `checker` 优先用本次 `compile` 建的程序，没有时才回退到上下文服务。 |
| `load` / `parse` / `analyze` / `collect` / `emit` | protected 抽象阶段 | 扩展点，由子类实现。 |
| `report(diagnostic)` / `addMetadata(fileName, entries)` | protected 工具方法 | 上报一条诊断；向某文件的归档追加条目（多次调用累加）。 |
| `reset()` / `ensureParsed()` | protected 工具方法 | 复位流水线状态；查询接口依赖 parse 产物时快速失败。 |
| `metadataRegistry` | `protected readonly Map<string, TypeMetadata[]>` | 以 `fileName` 为键的元数据仓库。 |

`DefaultCompiler` 实现的各阶段状态：

| 阶段 | 状态 | 行为 |
| --- | --- | --- |
| `load(inputs)` | 已实现 | 有 `content` 时直接建 `SourceFile`；没有时按 `ts.sys.readFile` 从磁盘读，读不到才抛错，消息含该 `fileName` 与「无法读取」。 |
| `parse(files)` | 已实现 | 输入非空时用这些源码和 `createMemoryCompilerHost` 新建 `ts.Program`；输入为空时回退到 program 服务，便于 `compile([])` 分析预建工程。 |
| `analyze()` | 已实现 | 对本次源码上报语法/语义诊断，并找出 interface、type-alias、enum、class、function 与 type-only import。 |
| `collect(files)` | 已实现 | 用 `program.getTypeChecker()` 反解声明类型，写入 `metadataRegistry`；成员、泛型参数与继承链一起收集。 |
| `emit()` | 已实现 | 展平仓库返回 `metadata`，并附一份 `{ files, metadata }` 的可序列化 JSON。 |

### 扩展流水线

基类负责流水线编排，子类只覆写阶段。下面这段可以直接放在 `packages/` 之外的工程里，只从包入口 import：

```ts
// 包外扩展示例：只从入口 import，覆写 analyze 加一条“禁止 any”的规则。
// External example: import only the entry and override analyze with a "no any" rule.
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
        messageText: '禁止使用 any',
      })
    }
  }
}
```

`compile(inputs)` 会用 `inputs` 里的源码建本次 Program，所以规则看到的正是你传进去的内容；`report()` 进诊断队列，`addMetadata()` 进元数据仓库。仓库里的 `tests/compiler-extension` 就是这段代码的可运行版本。

## 开发

```bash
pnpm --filter @veren/compiler-compiler build
pnpm --filter @veren/compiler-compiler test
```

测试位于 `test/*.test.ts`：`test/index.test.ts`（15 个用例）覆盖令牌与 `inject`、fail-fast getter、`load`（内存 + 磁盘）、`parse`、内容驱动的元数据/诊断、默认阶段行为与 Provider；`test/types.test.ts`（7 个用例）覆盖模板方法流水线与查询接口。合计 22 个用例。

## 注意事项与约束

- **输入决定分析对象。** `compile(inputs)` 有输入时会用这些源码新建 Program，不再读取 `rootNames` 预建的程序；`compile([])` 才回退到 program 服务。每次 `compile` 都会复位，后一次不会看到前一次的 Program、元数据或诊断。
- **`load` 支持内存与磁盘两种来源。** 有 `content` 用内存源码；没有则按 `ts.sys.readFile` 从磁盘读，读不到抛「无法读取」。自定义 CompilerHost 的虚拟文件请显式传 `content`。
- **`parse` 会为本次输入新建 program。** 只有输入为空时才返回 `@veren/compiler-program` 提供的 program 服务。
- **getter 快速失败。** `options`、`program`、`checker` 在本次 Program 不存在时通过 `getOrThrow` 取上下文服务，缺失时抛出 `Value for token <token> not found in context`。
- **`compile` 幂等。** 每次调用先执行 `reset()`，清空元数据仓库与诊断，二次编译不会让条目翻倍。
- **查询前置条件。** 成功 compile 之前调用 `getMetadata` 会抛出 `Compiler: parse 尚未完成，请先调用 compile()`；未知文件返回 `[]`。`hasErrors()` 只统计 `ts.DiagnosticCategory.Error`。
- **同一 Context 只能有一份服务。** cordis 对同名令牌的第二次注册会抛 `service already registered`；要在同一 `Context` 上重新 provide，需先调用 `apply`（或 `provide`）返回的 disposer。
- **同步写法。** 调用方若自行管理激活，可以同步直调 `Compiler.apply(ctx)`，而不使用 `await ctx.plugin(Compiler)`；链上其他 Provider 同理。
- **当前的导出面。** 包的 `exports` 只映射 `"."`，对外暴露 `name`、`inject`、`DefaultCompiler`、`Compiler`、`apply` 与全部元数据类型（`CompileInput`、`SourceSpan`、`TypeMetadata`、`TypeMetadataKind`、`EmitResult`）。包外可以直接继承 `Compiler` 或 `DefaultCompiler`，不需要相对源码路径。
