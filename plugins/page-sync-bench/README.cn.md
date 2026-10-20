# Page-Sync Bench（页面会话增量同步基准）

[English](./README.md) | 中文

## 是什么 / 何时用

一个 DSH 插件 + 真实 API 基准，验证页面会话的追加式增量同步。需要"页面 = 会话"设计（静态系统提示词 + 工具，动态状态以快照/补丁注入）的**硬数据**——缓存命中率、工具调用成功率、token 消耗——时使用。不要直接上生产；应把协议（`store.ts` + `protocol.ts`）移植进正式包。

## 被测设计

- **内核**：页面就是一个 memo 化的函数组件（`TaskListPage`）；状态变化沿 `bindStore → prompt-core reconciler → MessageHost` 提交为只追加的 `SNAPSHOT`/`PATCH` 消息流。
- **页面 = 会话**：静态系统提示词 + 静态工具 schema 构成可缓存前缀。
- **服务端权威**：`TaskStore` 持有任务列表；模型只维护心智副本。
- **对照两种上下文模式**：
  - `full` —— 每轮追加全量 `SNAPSHOT`（朴素基线）
  - `delta` —— 首轮快照，之后追加 `PATCH vA->vB {ops}`
- **工具 = 按钮**：`take_task` / `complete_task` 校验状态迁移，非法迁移带稳定 code fail loud。
- **验证**：每轮指令都在服务端核对（模型是否真的接取/完成了正确任务）。

## 运行

```bash
pnpm test        # 单元测试（无网络）
pnpm test:e2e    # 真实 DeepSeek API，双臂 × 6 轮；无凭据自跳过
```

凭证：`DEEPSEEK_API_KEY` 环境变量，或 `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`。报告写入 `bench/report-full.json` 与 `bench/report-delta.json`。

## 输出的关键统计

- 每轮：prompt tokens、缓存命中 tokens、命中率、注入字节、工具成功数、指令完成
- 汇总：prompt/completion tokens、总缓存命中率、工具成功率、指令完成数
