# @veren/core

[English](./README.md)

`@veren` TypeScript 工具链的令牌式依赖注入基础：让多个包通过同一个 Cordis `Context` 共享带类型的服务，也是其他所有 `@veren` 包的基础。

## 何时使用

- 当多个包需要通过同一个 Cordis `Context` 共享带类型的服务，而不是互相直接 import 时。
- 当某个包需要发布服务、或读取服务，并且希望其他包引用同一个令牌而不必各自复制字符串字面量时。
- 当你正在编写其他 `@veren` 包时：工具链的其余部分都建立在这套依赖注入基础之上。

## 安装

在消费方的 `package.json` 中加入（pnpm workspace）：

```json
{
  "dependencies": {
    "@veren/core": "workspace:*"
  }
}
```

或者交给 pnpm 完成：

```bash
pnpm --filter <consumer-package-name> add @veren/core
```

## 快速开始

```ts
import { Context } from '@deepseek-ai/cordis'
import {
  InjectorService,
  defineToken,
  get,
  getOrThrow,
  provideValue,
  set,
} from '@veren/core'

const ctx = new Context()

// defineToken() returns the descriptor string itself, typed as Token<T>.
// The `veren` prefix keeps service names from colliding across packages.
const PortToken = defineToken<number>('veren/port')

// provideValue() registers a typed service and returns a disposer.
const disposePort = provideValue(ctx, PortToken, 8080)
console.log(get(ctx, PortToken))        // 8080
console.log(getOrThrow(ctx, PortToken)) // 8080

// set() overwrites a value that was already provided in the same fiber.
set(ctx, PortToken, 9090)
console.log(get(ctx, PortToken))        // 9090

// The disposer is idempotent: the service is unregistered and can be provided again.
await disposePort()
console.log(get(ctx, PortToken))        // undefined
provideValue(ctx, PortToken, 3000)           // keep its disposer to release it later
console.log(getOrThrow(ctx, PortToken)) // 3000

// `new InjectorService(ctx)` registers the 'injector' service itself.
const injector = new InjectorService(ctx)
const NameToken = defineToken<string>('veren/name')
injector.provide(NameToken, 'veren')
console.log(injector.getOrThrow(NameToken)) // veren
```

该片段是 ESM 并使用了顶层 `await`，请从 `.mts`/`.ts` 模块或 `"type": "module"` 的包中运行。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `Token<T>` | 类型 | 字符串令牌，通过 `T` 携带类型信息；运行时就是普通字符串。 |
| `defineToken<T>(desc)` | `(desc: string) => Token<T>` | 直接返回 `desc` 本身并转换为 `Token<T>`，不创建任何运行时对象。 |
| `provideValue(ctx, token, value)` | `(ctx: Context, token: Token<T>, value: T) => Disposable<Promise<void>>` | 用 `ctx.effect(...)` 包裹 `ctx.provide`，返回幂等的 disposer。 |
| `set(ctx, token, value)` | `(ctx: Context, token: Token<T>, value: T) => void` | 覆盖同一 fiber 中已 provide 的值；否则抛出 `cannot set property "X" without provide`。 |
| `get(ctx, token)` | `(ctx: Context, token: Token<T>) => T \| undefined` | 读取值；令牌缺失时返回 `undefined`。 |
| `getOrThrow(ctx, token)` | `(ctx: Context, token: Token<T>) => NonNullable<T>` | 读取值；缺失或值为 falsy 时抛出 `Value for token <token> not found in context`。 |
| `Injector` | `Token<InjectorService>` | 注入服务的令牌，其字符串值为 `'injector'`，不带 `veren` 前缀。 |
| `InjectorService` | 类 | `new InjectorService(ctx)` 会注册 `'injector'` 服务；`provide`/`get`/`getOrThrow` 转发到上下文。无默认导出（规范约定）。 |

`Disposable<Promise<void>>` 来自 `@deepseek-ai/cordis`。

## 开发

```bash
pnpm --filter @veren/core build
pnpm --filter @veren/core test
```

- `build` 执行 `tsc`，产物写入 `dist/`。
- `test` 执行 `vitest run`；测试位于 `test/*.test.ts`（本包 19 个用例）。
- 在仓库根目录执行 `pnpm test` 会运行所有包的测试。

```
packages/core
├── src/index.ts        # tokens, provide/set/get/getOrThrow, InjectorService
├── test/index.test.ts  # vitest suite (19 cases)
└── package.json
```

## 注意事项与约束

- 服务令牌都是普通字符串；`@veren` 各包用 `veren` 前缀避免跨包重名。`Injector` 是例外：它的值是 `'injector'`。
- 消费 provider 模块有两种方式：`await ctx.plugin(Module, config)`，以 fiber 异步激活，`await` 之后服务才就绪；或者单元测试直接使用的低层同步方式 `Module.apply(ctx, config)`。
- 同一个 `Context` 上重复 provide 同名服务会抛 `service already registered`；需要先 dispose 再重新 provide。
- `provideValue()` 通过 `ctx.effect(...)` 把服务生命周期绑定到当前 fiber，fiber 卸载时服务会自动释放。
- `getOrThrow` 会把 falsy 值（`0`、`''`、`false`、`null`）视为缺失，即使令牌确实存在；若 falsy 是合法值，请改用 `get` 加显式的 `undefined` 判断。
- `ctx.injector` 每次访问都返回新的扩展视图：引用相等（`===`）为 false，但 `instanceof InjectorService` 成立，且结构相等。
