# @veren/node-fs

[中文文档](./README.cn.md)

Turns `fs/promises` into a Cordis context service for the Veren toolchain: install the provider, then read, write and inspect files through the context instead of importing `fs/promises` directly.

## When to use

- A Cordis-based app or pipeline must read, write or inspect files, and filesystem access should be swappable through the context (easier to mock in tests).
- Several packages need file access and should share one provider instead of each importing `fs/promises`.
- You want a single place to set the default text encoding for all file I/O in the pipeline.

Skip it when you are outside a Cordis context and just need a one-off read — import `fs/promises` directly instead.

## Install

The package is part of the pnpm workspace. Depend on it through the workspace protocol in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@veren/node-fs": "workspace:*"
  }
}
```

It declares `inject = []`, so it can be the first plugin of any pipeline; no other service is required.

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, Config, name } from '@veren/node-fs';

const ctx = new Context();
// apply provides the service; the config goes through the Config schema first.
// apply 会提供服务；配置先经 Config schema 归一化。
apply(ctx, Config({ encoding: 'utf8' }));

const fs = ctx.get(name)!;
await fs.mkdir('./out', { recursive: true });
await fs.writeFile('./out/report.txt', 'hello');
console.log(await fs.readFile('./out/report.txt')); // 'hello'
```

## Config

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `encoding` | `'utf8' \| 'utf16le' \| 'latin1' \| 'ascii'` | `'utf8'` | The default encoding for `readFile` / `writeFile` / `appendFile` when a call does not pass one explicitly. |

## Service interface

`NodeFs` (see [`src/tokens.ts`](./src/tokens.ts)) covers the common `fs/promises` subset: `readFile`, `writeFile`, `appendFile`, `exists`, `stat`, `mkdir`, `readdir`, `rm`, `rename`, `copyFile`. The token is `verenNodeFs`, exported as `name`; import `./tokens` alone when a browser-side or platform-agnostic module only needs the token and interface.
