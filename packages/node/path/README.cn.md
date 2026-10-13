# @veren/node-path

[English](./README.md)

把 `node:path` 封装成 Veren 工具链的 Cordis 上下文服务：安装 Provider 后，通过上下文拼接、解析和比较路径，而不是直接 import `node:path` —— 并且路径风格（posix/win32）可按部署配置。

## 何时使用

- 基于 Cordis 的应用或流水线需要拼接、解析、比较路径，并且希望路径风格可以通过上下文替换（例如在任意宿主操作系统上生成 posix 风格路径）。
- 多个包都需要路径处理能力，应共享同一个 Provider，而不是各自 import `node:path`。
- 编写跨平台工具时，需要无论宿主操作系统如何都固定一种路径风格。

不在 Cordis 上下文中、只是临时 `join` 一次路径时请跳过 —— 直接使用 `node:path` 即可。

## 安装

本包是 pnpm workspace 的一部分。在消费方的 `package.json` 中通过 workspace 协议依赖：

```json
{
  "dependencies": {
    "@veren/node-path": "workspace:*"
  }
}
```

它声明 `inject = []`，因此可以作为任意流水线的第一个插件；不依赖其他服务。

## 快速上手

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, Config, name } from '@veren/node-path';

const ctx = new Context();
// 即使在 Windows 上也固定 posix 风格；配置先经 Config schema 归一化。
apply(ctx, Config({ platform: 'posix' }));

const p = ctx.get(name)!;
p.join('assets', 'logo.png'); // 'assets/logo.png'
p.sep; // '/'
```

## 配置

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `platform` | `'posix' \| 'win32'` | Windows 上为 `'win32'`，其他平台 `'posix'` | 服务委托给哪一套 `node:path` 实现。 |

## 服务接口

`NodePath`（见 [`src/tokens.ts`](./src/tokens.ts)）覆盖 `node:path` 的常用纯函数：`join`、`resolve`、`dirname`、`basename`、`extname`、`relative`、`normalize`、`isAbsolute`，以及常量 `sep` 和 `delimiter`。服务令牌为 `verenNodePath`，以 `name` 导出；浏览器端或平台无关模块只需要令牌和接口时，可单独 import `./tokens`。
