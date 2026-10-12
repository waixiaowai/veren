# @veren/compiler-host

[English](./README.md)

把上下文中已有的编译选项变成 Veren 编译器流水线可用的 `ts.CompilerHost` 服务。

## 何时使用

- TypeScript 构建阶段需要从上下文获取 `ts.CompilerHost` 服务 —— 包括为「从不落盘」的源码准备的内存宿主工厂 —— 而不是手工创建宿主。
- 多个阶段需要共享同一个由相同编译选项派生出的宿主实例。
- 编译的源码只存在于内存中（虚拟文件、编辑器缓冲区、测试用例），同时模块解析仍要正常工作。

## 安装

本包属于 pnpm workspace，请在消费方的 `package.json` 中通过 workspace 协议声明依赖：

```json
{
  "dependencies": {
    "@veren/compiler-host": "workspace:*"
  }
}
```

运行时上下文中必须已经提供编译选项服务，因为本包声明了 `inject = ['verenCompilerOptions']`；通常由 `@veren/compiler-options` 提供。

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

对于从不落盘的源码，可用内存宿主工厂构建宿主：给出的 `SourceFile` 优先命中，其余请求回落到默认的磁盘宿主：

```ts
import * as ts from 'typescript'
import { createMemoryCompilerHost } from '../compiler-host/src/memory-host.ts'

const fileName = '/virtual/sum.ts'
const source = ts.createSourceFile(
  fileName,
  'export function sum(a: number, b: number): number { return a + b; }',
  ts.ScriptTarget.ES2022,
  true,
)

const host = createMemoryCompilerHost({ noLib: true, types: [] }, [source])
host.getSourceFile(fileName, ts.ScriptTarget.ES2022) // === source
```

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<ts.CompilerHost>`，字符串 `'verenCompilerHost'` | 创建出的宿主所注册到的令牌。 |
| `Config` | Schemastery schema 与 `interface Config` | 校验插件配置。`setParentNodes` 为布尔值，默认 `false`，传入其他类型会抛错；`Config({})` 归一化为 `{ setParentNodes: false }`。 |
| `inject` | `Token[]` | `['verenCompilerOptions']`：`apply` 执行前编译选项服务必须已存在。 |
| `apply(ctx, config)` | `(ctx: Context, config: Config) => () => void` | 读取编译选项服务，调用 `ts.createCompilerHost(options, config.setParentNodes)`，并以 `name` 提供宿主。返回的 disposer 用于取消提供。 |
| `createMemoryCompilerHost(options, sources)` | `(options: ts.CompilerOptions, sources: readonly ts.SourceFile[]) => ts.CompilerHost`，由 `src/memory-host.ts` 导出，**未**从包入口导出 | 优先命中给出的内存 `SourceFile`（`getSourceFile`、`getSourceFileByPath`、`fileExists`、`readFile` 均按 `f.fileName` 精确匹配），其余请求回落到默认的磁盘宿主。 |

## 开发

```bash
pnpm --filter @veren/compiler-host build
pnpm --filter @veren/compiler-host test
```

测试位于 `test/*.test.ts`，通过 `vitest run` 运行：`test/index.test.ts`（9 用例）与 `test/memory-host.test.ts`（8 用例），共 17 用例。

```
packages/compiler/compiler-host
├── README.md           # English docs
├── README.cn.md        # Chinese docs
├── package.json
├── src/
│   ├── index.ts        # provider entry: name / Config / inject / apply
│   └── memory-host.ts  # createMemoryCompilerHost (not re-exported from "." yet)
└── test/
    ├── index.test.ts        # 9 cases
    └── memory-host.test.ts  # 8 cases
```

构建产物由 `tsc` 输出到 `dist/`；`main` 与 `exports` 都指向 `./dist/index.js`。

## 注意事项与约束

- 令牌就是普通字符串，带 `veren` 前缀，因此不会跨包重名。
- 用 `await ctx.plugin(Module, config)` 消费 provider（fiber 异步激活，`await` 之后服务才就绪），或在低层单测中同步直调 `Module.apply(ctx, config)`。
- 同一个 `Context` 上重复 provide 同名服务会抛 `service already registered`，需要先 dispose 上一次注册。
- 内存源码的 `fileName` 必须是规范化后的绝对路径。TypeScript 5.9 会把路径规范化为正斜杠，并在大小写不敏感的系统上转小写，而内存映射以规范化后的 `f.fileName` 为键，拼写不一致就会命中失败。若编译过程走模块解析，源码所在目录必须在磁盘上真实存在。
- `createMemoryCompilerHost` 目前**没有**从 `src/index.ts` 再导出，包的 `exports` 只暴露 `"."`。因此外部消费者只能通过相对源码路径引用它，例如 `../compiler-host/src/memory-host.ts`；当前并不存在可用的 `@veren/compiler-host/memory-host` 导入路径。后续可考虑从入口导出。
- 只要后续阶段需要节点上的 parent 链或位置计算，就应保持 `setParentNodes: true`。
