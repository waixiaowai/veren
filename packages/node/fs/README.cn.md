# @veren/node-fs

[English](./README.md)

把 `fs/promises` 封装成 Veren 工具链的 Cordis 上下文服务：安装 Provider 后，通过上下文读写和检查文件，而不是直接 import `fs/promises`。

## 何时使用

- 基于 Cordis 的应用或流水线需要读写、检查文件，并且希望文件访问可以通过上下文替换（测试中更易 mock）。
- 多个包都需要文件访问能力，应共享同一个 Provider，而不是各自 import `fs/promises`。
- 希望流水线中所有文件 I/O 的默认文本编码只在一处配置。

不在 Cordis 上下文中、只是临时读一次文件时请跳过 —— 直接使用 `fs/promises` 即可。

## 安装

本包是 pnpm workspace 的一部分。在消费方的 `package.json` 中通过 workspace 协议依赖：

```json
{
  "dependencies": {
    "@veren/node-fs": "workspace:*"
  }
}
```

它声明 `inject = []`，因此可以作为任意流水线的第一个插件；不依赖其他服务。

## 快速上手

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, Config, name } from '@veren/node-fs';

const ctx = new Context();
// apply 提供服务；配置先经 Config schema 归一化。
apply(ctx, Config({ encoding: 'utf8' }));

const fs = ctx.get(name)!;
await fs.mkdir('./out', { recursive: true });
await fs.writeFile('./out/report.txt', 'hello');
console.log(await fs.readFile('./out/report.txt')); // 'hello'
```

## 配置

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `encoding` | `'utf8' \| 'utf16le' \| 'latin1' \| 'ascii'` | `'utf8'` | 调用未显式指定编码时，`readFile` / `writeFile` / `appendFile` 使用的默认编码。 |

## 服务接口

`NodeFs`（见 [`src/tokens.ts`](./src/tokens.ts)）覆盖 `fs/promises` 的常用子集：`readFile`、`writeFile`、`appendFile`、`exists`、`stat`、`mkdir`、`readdir`、`rm`、`rename`、`copyFile`。服务令牌为 `verenNodeFs`，以 `name` 导出；浏览器端或平台无关模块只需要令牌和接口时，可单独 import `./tokens`。
