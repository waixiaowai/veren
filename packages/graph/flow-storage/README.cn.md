# @deepseek-ai/dsh-graph-flow-storage

经 dsh domain 存储层（`ctx.storage.domain`，构建在 dsh storage hub 之上，支持 json/sqlite 后端）持久化 flow 定义与运行记录。当 flow 与运行历史需要跨进程重启保留、并让 flow 引擎从真实介质获得 `FlowStorage` 能力时使用它。内存或 YAML 文件装载（`@deepseek-ai/dsh-graph-flow-yaml`）场景请跳过。

## 提供什么

- **`graphFlowStorage` 插件** —— 打开 `graph_flow` 域（zod 在持久边界校验记录；后端路由由 storage-domain 插件的配置决定），提供引擎的 `FlowStorageToken` 能力；域随 fiber 卸载自动关闭。
- **`flowDomain`** —— 域声明：`flows` 表（定义）与 `runs` 表（运行记录）。
- **`createDomainStorage` / `tablesOf`** —— 基于两张表的 `FlowStorage` 实现，测试可直接传入表替身使用。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as flowStorage } from '@deepseek-ai/dsh-graph-flow-storage';
// 需先装载存储栈：
// @deepseek-ai/dsh-storage（hub）+ 后端（如 dsh-storage-json）+ dsh-storage-domain

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(flowStorage, { restoreFlows: false });
await ctx.plugin(engine, {}); // 存在 FlowStorageToken 时自动接上
```

## 非目标（二期）

不做运行状态订阅（今天可使用引擎的 `flow/run-*` 事件）；除 domain 层版本检查外不做迁移工具；`restoreFlows`（启动时重新注册已持久化定义）为预留未实现选项。

中文文档即本文件；英文见 [README.md](./README.md)。
