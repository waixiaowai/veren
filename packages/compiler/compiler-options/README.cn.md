# @veren/compiler-options

[English](./README.md)

把 `ts.CompilerOptions` 提供到 Cordis `Context`；它是 `@veren` 编译流水线的第一个服务。

## 何时使用

- 当某个 TypeScript 构建阶段需要 `ts.CompilerOptions` 通过上下文提供，而不是一路手工传参时。
- 当你要搭建 `@veren` 编译流水线，需要它的第一个服务，后续每个阶段都从这里读取选项时。
- 当选项已经来自别处时就不要用它，例如外层构建工具已经提供了自己的选项服务。

## 安装

在消费方的 `package.json` 中加入（pnpm workspace）：

```json
{
  "dependencies": {
    "@veren/compiler-options": "workspace:*"
  }
}
```

或者交给 pnpm 完成：

```bash
pnpm --filter <consumer-package-name> add @veren/compiler-options
```

## 快速开始

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

流水线后续的包按顺序消费这个服务：`@veren/compiler-host` → `@veren/compiler-program` → `@veren/compiler-type-checker` → `@veren/compiler-compiler`。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<ts.CompilerOptions>` | 服务令牌，其字符串值为 `'verenCompilerOptions'`。 |
| `inject` | `never[]` | 空依赖列表：该 provider 不依赖任何其他服务。 |
| `apply(ctx, config)` | `(ctx: Context, config?: ts.CompilerOptions) => Disposable<Promise<void>>` | 把 `config` 的浅拷贝（默认 `{}`）提供到 `name` 下，并返回 `provide` 的 disposer。 |

没有 `Config` 导出：配置对象本身就是 `ts.CompilerOptions`，不做任何 schema 校验。

`Disposable<Promise<void>>` 来自 `@deepseek-ai/cordis`。

## 开发

```bash
pnpm --filter @veren/compiler-options build
pnpm --filter @veren/compiler-options test
```

- `build` 执行 `tsc`，产物写入 `dist/`。
- `test` 执行 `vitest run`；测试位于 `test/*.test.ts`（本包 8 个用例）。
- 在仓库根目录执行 `pnpm test` 会运行所有包的测试。

```
packages/compiler/compiler-options
├── src/index.ts        # name, inject, apply
├── test/index.test.ts  # vitest suite (8 cases)
└── package.json
```

## 注意事项与约束

- 提供的是浅拷贝（`{ ...config }`）：顶层字段被复制，嵌套对象仍与原对象共享引用，之后修改原对象不会影响已提供的值。
- 因为没有 `Config` schema，传入的对象会原样使用（仅做拷贝），未知字段不会被拒绝。
- 在同一个 `Context` 上激活两次会抛 `service already registered`；再次激活前请先 dispose 前一个 fiber。
- `apply` 返回的 disposer 会注销服务且是幂等的，因此之后可以重新提供选项。
- 服务令牌都是普通字符串；`@veren` 各包用 `veren` 前缀避免跨包重名，因此是 `'verenCompilerOptions'`。
