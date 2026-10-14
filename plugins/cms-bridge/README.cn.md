# @veren/cms-bridge

[English](./README.md) | [简体中文](./README.cn.md)

> 需求文档:`docs/designer/REQUIREMENTS-plugin.md`(验收 P1–P10);服务端对应文档:`docs/designer/REQUIREMENTS-server.md`。

一个 Cordis 插件:从 Node 侧 DSH 宿主到 CMS 服务端维持一条 WebSocket 长连接 —— 用 cms 凭证鉴权、断线自动重连、把服务端下发的指令分发到本地注册的 action 处理器(带逐条执行超时)、主动上报事件(离线补报),并暴露运行状态快照供观测。

## 什么时候用 / 什么时候不用

- **用**:Cordis 宿主需要长期附着在 CMS 服务端(下行指令通道 + 上行事件通道),且希望重连/停靠/退避全部托管。
- **不用**:只需一次性 HTTP 调用,或希望映射表由服务端维护 —— 这里的映射由插件自身声明(需求 8)。

## 安装

```bash
pnpm add @veren/cms-bridge
```

## 配置

```ts
import { Context } from '@deepseek-ai/cordis';
import * as CmsBridgePlugin from '@veren/cms-bridge';

const ctx = new Context();
await ctx.plugin(CmsBridgePlugin, {
  url: 'wss://cms.example/ws',
  token: process.env.CMS_API_KEY!,   // 用户 API Key,或环境注册换发的长期凭证
  commandTimeoutMs: 30_000,
  reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 },
  credentialCloseCodes: [4001, 4401],
});
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `url` | *(必填)* | CMS WebSocket 端点 |
| `token` | `''` | 以 `Authorization: Bearer …` 携带的凭证 |
| `commandTimeoutMs` | `30000` | 单条指令执行超时(P6) |
| `reconnect` | `1s → ×2 → 30s` | 自动重连的指数退避(P2) |
| `credentialCloseCodes` | `[4001, 4401]` | 视为凭证失效的 close code → 停靠等待重配置(P3) |

## 使用

```ts
import { CmsBridge } from '@veren/cms-bridge';
const bridge = ctx.get(CmsBridge)!;

// 声明一个 action 映射 —— 新增映射服务端无需任何改动(P10)。
bridge.registerAction('shell.exec', {
  validate: (payload) => (typeof payload?.['command'] === 'string' ? null : 'payload.command must be a string'),
  handler: async (payload) => run(payload['command']),
});

// 主动上报事件 —— 断线时入队,重连后按序补报(P6/P7/P8)。
bridge.report('host.ready', { version: '1.0.0' });

// 查询运行状态(P9)。
bridge.status(); // { state, reconnectAttempts, pendingEvents, inflightCommands, … }

// 更换凭证 —— 处于等待重配置状态时会自动恢复连接(P3)。
bridge.setCredential('new-long-lived-token');
```

## 行为保证

| 保证 | 所在文件 |
|---|---|
| 未知 action 回传明确 `UNKNOWN_ACTION` 失败,绝不静默(P5) | `src/dispatcher.ts` |
| 每条指令独立超时;卡死的 handler 不阻塞后续指令(P6) | `src/dispatcher.ts` |
| 离线事件按 FIFO 入队,重连后恰好一次按序补报(P8) | `src/reporter.ts` |
| 凭证失效即停靠(不无限重试),等待重新配置(P3) | `src/connection.ts` |
| 关键节点写日志 + 广播 `cms-bridge/status` 事件(P9) | `src/connection.ts` |

## 开发

```bash
pnpm build   # tsc
pnpm test    # vitest run(离线,假 socket;无需真实 CMS)
```

测试使用可编程假 socket,全部验收路径本地可跑、不占网络。

## 许可证

见工作区根目录。
