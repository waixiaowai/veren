# @veren/node-path

[中文文档](./README.cn.md)

Turns `node:path` into a Cordis context service for the Veren toolchain: install the provider, then build, parse and compare paths through the context instead of importing `node:path` directly — with the path flavor (posix/win32) configurable per deployment.

## When to use

- A Cordis-based app or pipeline must build, parse or compare paths, and the path flavor should be swappable through the context (e.g. generating posix-style paths on any host OS).
- Several packages need path handling and should share one provider instead of each importing `node:path`.
- You write cross-platform tooling that must pin one path flavor regardless of the host operating system.

Skip it when you are outside a Cordis context and just need a one-off `join` — import `node:path` directly instead.

## Install

The package is part of the pnpm workspace. Depend on it through the workspace protocol in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/node-path": "workspace:*"
  }
}
```

It declares `inject = []`, so it can be the first plugin of any pipeline; no other service is required.

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, Config, name } from '@veren/node-path';

const ctx = new Context();
// Pin posix style even on Windows; the config goes through the Config schema.
// 即使在 Windows 上也固定 posix 风格；配置先经 Config schema 归一化。
apply(ctx, Config({ platform: 'posix' }));

const p = ctx.get(name)!;
p.join('assets', 'logo.png'); // 'assets/logo.png'
p.sep; // '/'
```

## Config

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `platform` | `'posix' \| 'win32'` | `'win32'` on Windows, `'posix'` elsewhere | Which `node:path` flavor the service delegates to. |

## Service interface

`NodePath` (see [`src/tokens.ts`](./src/tokens.ts)) covers the common `node:path` pure functions: `join`, `resolve`, `dirname`, `basename`, `extname`, `relative`, `normalize`, `isAbsolute`, plus the `sep` and `delimiter` constants. The token is `verenNodePath`, exported as `name`; import `./tokens` alone when a browser-side or platform-agnostic module only needs the token and interface.
