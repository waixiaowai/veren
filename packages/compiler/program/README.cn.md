# @veren/compiler-program

[English](./README.md)

从上下文中已有的编译选项与编译宿主服务构建 `ts.Program` —— 即 AST、模块图与类型检查器。

## 何时使用

- 构建阶段需要基于上下文中已有的服务构建 `ts.Program`（AST、模块图与类型检查器），而不是手工调用 `ts.createProgram`。
- 希望 `ts.createProgram` 的三个入参都由上下文服务解析得到，而不是手工逐层透传。
- 后续阶段需要从 program 服务派生，例如用 `@veren/compiler-type-checker` 取 `ts.TypeChecker`，或用 `@veren/compiler-compiler` 取接线好的编译器。

## 安装

本包属于 pnpm workspace，请在消费方的 `package.json` 中通过 workspace 协议声明依赖：

```json
{
  "dependencies": {
    "@veren/compiler-program": "workspace:*"
  }
}
```

运行时上下文中必须已经提供两个依赖服务，因为本包声明了 `inject = ['verenCompilerOptions', 'verenCompilerHost']`；通常由 `@veren/compiler-options` 与 `@veren/compiler-host` 提供。

## 快速开始

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

program 服务进入上下文之后，`@veren/compiler-type-checker` 会用 `program.getTypeChecker()` 从中派生 `ts.TypeChecker`，`@veren/compiler-compiler` 则提供与流水线各阶段接线好的编译器。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<ts.Program>`，字符串 `'verenProgram'` | 构建出的 program 所注册到的令牌。 |
| `ProgramToken` | `name` 的别名，两者同值 | 等价别名，便于按令牌命名习惯导入。 |
| `Config` | Schemastery schema 与 `interface Config` | 校验插件配置。`rootNames` 是字符串数组，默认 `[]`；传入非数组或含非字符串元素会抛错。 |
| `inject` | `Token[]` | `['verenCompilerOptions', 'verenCompilerHost']`：`apply` 执行前两个服务都必须已存在。 |
| `apply(ctx, config)` | `(ctx: Context, config?: Config) => () => void` | 读取两个服务，调用 `ts.createProgram(config?.rootNames ?? [], options, host)`，并以 `ProgramToken` 提供 program。返回的 disposer 用于取消提供。 |

缺少依赖服务时，`apply` 会抛出 `Value for token <token> not found in context`。

## 开发

```bash
pnpm --filter @veren/compiler-program build
pnpm --filter @veren/compiler-program test
```

测试位于 `test/*.test.ts`，通过 `vitest run` 运行：`test/index.test.ts`（13 用例）。

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

构建产物由 `tsc` 输出到 `dist/`；`main` 与 `exports` 都指向 `./dist/index.js`。

## 注意事项与约束

- 令牌就是普通字符串，带 `veren` 前缀，因此不会跨包重名。
- 用 `await ctx.plugin(Module, config)` 消费 provider（fiber 异步激活，`await` 之后服务才就绪），或在低层单测中同步直调 `Module.apply(ctx, config)`。
- 同一个 `Context` 上重复 provide 同名服务会抛 `service already registered`，需要先 dispose 上一次注册。因此想换一组 `rootNames` 重新 apply，应先 dispose 旧的 program 服务，或把 provider 注册到新的子 `Context` 上。
- `config` 是可选的：`apply(ctx)` 会构建根集为空的 program，不会加载任何源码文件。要让入口文件进入 program，必须传入 `rootNames`。
- program 是一次 `ts.createProgram` 调用的快照。改动根文件名、编译选项或宿主内容都不会更新已有的 program，需要 dispose 后重新 apply。
- 本包的 `Config` 只校验 `rootNames`。TypeScript 选项本身不由本包校验，它们就是 `@veren/compiler-options` 提供的原始对象。
- `ProgramToken` 与 `name` 是同一个令牌，两种写法取到的是同一个服务。
