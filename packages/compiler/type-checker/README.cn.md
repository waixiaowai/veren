# @veren/compiler-type-checker

[English](./README.md)

veren 编译器流水线的一个 Provider：从上下文中已有的 `ts.Program` 派生 `ts.TypeChecker` 服务，保证 checker 与 program 始终同源。

## 何时使用

- 当某个构建阶段需要从 AST 节点反解完整类型信息时使用 —— 也就是 TypeScript 编译成 JavaScript 时被擦除的类型注解、泛型与签名。
- 当 checker 必须与 program 同源时使用：本 Provider 提供的正是 `program.getTypeChecker()`，即 program 自身缓存的同一个实例，而不是另建一个独立的 checker。
- 当类型信息需要作为上下文服务（`verenTypeChecker`）被后续 Provider 消费时使用 —— 例如 `@veren/compiler-compiler` —— 而不是让每个阶段各自创建 checker。

## 安装

本包为私有包，只在当前 pnpm workspace 内消费。在消费方的 `package.json` 中声明：

```json
{
  "dependencies": {
    "@veren/compiler-type-checker": "workspace:*"
  }
}
```

下面的快速开始会搭起整条 Provider 链，因此运行它的消费方还需要把 `@veren/compiler-options`、`@veren/compiler-host`、`@veren/compiler-program` 与 `@veren/compiler-compiler` 声明为 `workspace:*` 依赖。

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

本 Provider 不接收配置，因此 `ctx.plugin(TypeChecker)` 单独一条即可提供服务。通过该服务反解类型信息：

```ts
// `node` is any node of the program, e.g. a variable declaration.
// `node` 可以是程序中的任意节点，例如一条变量声明。
const type = checker.getTypeAtLocation(node)
const typeText = checker.typeToString(type) // e.g. "Promise<Map<string, User>>"
```

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<ts.TypeChecker>` | 服务令牌；字符串值为 `'verenTypeChecker'`（`veren` 前缀保证跨包不重名）。 |
| `inject` | `Token<ts.Program>[]`，即 `['verenProgram']` | 声明对 program 的依赖，使 `@veren/compiler-program` 先于本 Provider 激活。 |
| `apply(ctx)` | `(ctx: Context) => Disposable` | 读取 `verenProgram` 并 provide `program.getTypeChecker()`；返回的 disposer 用于移除该服务。 |

## 开发

```bash
pnpm --filter @veren/compiler-type-checker build
pnpm --filter @veren/compiler-type-checker test
```

测试位于 `test/*.test.ts`（`test/index.test.ts`，共 8 个用例）。覆盖令牌值与 `inject`、缺少 program 时的报错、provide 的值即 `getTypeChecker()` 的返回值、dispose 后可重复 `apply`，以及用真实 `ts.Program` 把 `answer: number` 声明反解为类型文本 `'number'`。

## 注意事项与约束

- 同源是构造保证的：服务就是 `program.getTypeChecker()`，而 `ts.Program` 会缓存其 checker，因此对同一 program 反复 `apply` 得到的都是同一实例。
- 缺少依赖：未提供 program 时，`apply` 抛出 `Value for token verenProgram not found in context`。
- 同一 Context 只能有一份：cordis 对同名令牌的第二次注册会抛 `service already registered`。要在同一 `Context` 上重新 apply，需先调用 `apply`（或 `provide`）返回的 disposer。
- 同步写法：调用方若自行管理激活，可以同步直调 `TypeChecker.apply(ctx)`，而不使用 `await ctx.plugin(TypeChecker)`。
- 令牌标识：令牌本质是带 `veren` 前缀的字符串，用于避免跨包重名。
- 本包只负责反解类型，不负责搜集与产出元数据；消费该 checker 的流水线是 `@veren/compiler-compiler`。
