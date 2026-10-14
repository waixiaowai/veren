# @veren/core

[中文文档](./README.cn.md)

Token-based dependency-injection foundation of the `@veren` TypeScript toolchain: it lets several packages share typed services through one Cordis `Context`, and it is the base of every other `@veren` package.

## When to use

- When several packages must share typed services through one Cordis `Context` instead of importing each other directly.
- When a package needs to publish a service, or read one back, with a token that other packages can reference without duplicating string literals.
- When you are writing another `@veren` package: the rest of the toolchain builds on this dependency-injection base.

## Install

Add it to the consumer's `package.json` (pnpm workspace):

```json
{
  "dependencies": {
    "@veren/core": "workspace:*"
  }
}
```

Or let pnpm do it:

```bash
pnpm --filter <consumer-package-name> add @veren/core
```

## Quick start

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

The snippet is ESM and uses top-level `await`, so run it from a `.mts`/`.ts` module or an `"type": "module"` package.

## API

| Export | Type | Description |
| --- | --- | --- |
| `Token<T>` | type | A string token that carries `T` for type checking; at runtime it is just a string. |
| `defineToken<T>(desc)` | `(desc: string) => Token<T>` | Returns `desc` itself, cast to `Token<T>`; it creates no runtime object. |
| `provideValue(ctx, token, value)` | `(ctx: Context, token: Token<T>, value: T) => Disposable<Promise<void>>` | Wraps `ctx.provide` in `ctx.effect(...)` and returns an idempotent disposer. |
| `set(ctx, token, value)` | `(ctx: Context, token: Token<T>, value: T) => void` | Overwrites a value already provided in the same fiber; otherwise throws `cannot set property "X" without provide`. |
| `get(ctx, token)` | `(ctx: Context, token: Token<T>) => T \| undefined` | Reads the value; `undefined` when the token is absent. |
| `getOrThrow(ctx, token)` | `(ctx: Context, token: Token<T>) => NonNullable<T>` | Reads the value; throws `Value for token <token> not found in context` when it is absent or falsy. |
| `Injector` | `Token<InjectorService>` | Token of the injector service; its string value is `'injector'`, without the `veren` prefix. |
| `InjectorService` | class | `new InjectorService(ctx)` registers the `'injector'` service; `provide`/`get`/`getOrThrow` forward to the context. No default export (per convention). |

`Disposable<Promise<void>>` comes from `@deepseek-ai/cordis`.

## Development

```bash
pnpm --filter @veren/core build
pnpm --filter @veren/core test
```

- `build` runs `tsc` and writes `dist/`.
- `test` runs `vitest run`; the tests live in `test/*.test.ts` (19 cases in this package).
- `pnpm test` at the repository root runs the tests of every package.

```
packages/core
├── src/index.ts        # tokens, provide/set/get/getOrThrow, InjectorService
├── test/index.test.ts  # vitest suite (19 cases)
└── package.json
```

## Notes & constraints

- Service tokens are plain strings; `@veren` packages prefix them with `veren` to avoid collisions between packages. `Injector` is the exception: its value is `'injector'`.
- Two ways to consume a provider module: `await ctx.plugin(Module, config)`, which activates a fiber asynchronously so the service is ready only after the `await`, or the low-level synchronous `Module.apply(ctx, config)` used directly by unit tests.
- Providing the same service name twice on one `Context` throws `service already registered`; dispose the first registration before providing again.
- `provideValue()` ties the service lifetime to the current fiber through `ctx.effect(...)`, so it is released automatically when that fiber unloads.
- `getOrThrow` treats falsy values (`0`, `''`, `false`, `null`) as missing even though the token is present; use `get` plus an explicit `undefined` check when falsy values are legitimate.
- `ctx.injector` returns a fresh extended view on every access: reference equality (`===`) is false, while `instanceof InjectorService` holds and the structures compare equal.
