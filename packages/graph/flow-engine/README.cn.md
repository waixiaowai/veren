# @deepseek-ai/dsh-graph-flow-engine

DAG 内核之上的 flow 语义层引擎。当你需要 flow 语义——带 schema 校验配置的类型化节点、显式输入映射、每次运行的黑板、重试/超时/onError 策略、子流程与 mock——并编译到中性内核上执行时使用它。只需要内核本身（`@deepseek-ai/dsh-graph-core`）或纯类型（`@deepseek-ai/dsh-graph-flow-api`）时请跳过。

## 提供什么

- **`FlowEngine` 服务**（`graphFlowEngine`）：`registerFlow` / `unregisterFlow` / `hasFlow` / `getFlow` / `listFlows` / `run` / `listRuns` / `getRun`。`getFlow(id)` 返回已注册的 `FlowDefinition`，供上层投影使用（画布包就依赖它）。
- **注册表与运行读取面**：`listFlows()` 返回每个已注册 flow 的 id、节点数、边数与声明的输出变量名（按 id 升序）；`getRun(runId)` 返回单次运行的状态、实时逐节点记录（`FlowRunDetail.nodes`，含 `completed`/`running`/`pending` 与起止时间），完成后带上完整结果（`FlowRunDetail.result`）。实时节点是晚订阅者做 hydration 的只读入口。`@deepseek-ai/dsh-graph-tools` 就是把这套读取面暴露成模型可见工具。
- **注册期编译，fails loud**：`NODE_TYPE_NOT_FOUND`、`NODE_CONFIG_INVALID`、`FLOW_CYCLE_DETECTED`、`FLOW_REFERENCE_CYCLE`（subflow 互引用）、`GRAPH_DANGLING_EDGE` 透传。
- **`run()` → `FlowRunHandle`**：`status()`、协作式 `cancel()`、`awaitCompletion()`；`FlowRunResult` 携带解析后的输出变量与逐节点记录（`{ status, skipReason?, startedAt, endedAt, error?, recovered?, approvals?, output? }`），缺失的可选键会被省略（不会出现 `error: undefined` 自有属性）。取消一个运行中的 flow 时，所有未落定节点记为 `cancelled`（不是 `failed`，也不是 `skipped`）；`failFast` 的通知只停止新调度，运行中的兄弟分支会跑完并保持 `completed`。
- **节点授权（挂起而不是失败）**：`NodeExecuteContext.approval` 把授权请求交给可选的 `@deepseek-ai/dsh-graph-flow-approval` 服务。等待期间节点状态是 `awaiting-approval`（flow 层新增的可辨识状态；内核仍视为 `running`），记录带 `approvals` 审计；同意后回到 `running` 继续执行，拒绝/超时按节点自己的稳定 code 失败。等待期间节点执行超时暂停，取消运行会撤销挂起。未装载授权服务时，`approval.request` 以 `via: 'unavailable'` 拒绝——旧的 fail-closed 行为保持不变。
- **节点执行器包裹**：显式输入映射（`${nodeId.slot}` 或字面量）、重试（`{ tries, backoffMs }`）、节点级/引擎级超时（`NODE_TIMEOUT`）、`mocks`（固定产出，跳过执行）、`onError` 策略 —— `failFast`（默认）、`fallback`（声明式兜底值继续跑）、`errorBranch`（失败沿名为 `error` 的输出端口继续，默认端口改为关闭；配置了 `errorBranch` 的节点必须至少声明一条 `port: 'error'` 出边，否则注册期以 `NODE_CONFIG_INVALID` 失败）。兜底成功的 errorBranch 节点仍是 `completed`，但记录带 `recovered: { code, message }`，调用方可以区分"失败后兜底"与真正干净的成功。
- **内置节点类型**（仅参考实现/测试夹具）：`noop`、`fail`、`echo`、`subflow`（flow 即节点；引用环在注册期检测，运行期递归另有防护；外部取消会传播进子 flow，fail-fast 通知则让子 flow 自然跑完）。
- **Start/End 签名**：`input` schema 每次 run 校验；`output` slot 引用解析进 `FlowRunResult.output`。
- **节点类型版本**：注册表按 `(type, version)` 索引；handler 运行期重解析，节点插件卸载后再次运行会响亮地得到 `NODE_TYPE_NOT_FOUND`。
- **flow 事件**：`flow/run-starting`（`@mode serial`，真值拒绝）、`flow/run-start`、`flow/node-status`（`@mode emit`，把内核中性事件 `graph/node-status` 的逐节点迁移补上 `flowId` 后转发；errorBranch 完成时额外带 `recovered`，等待授权时状态为 `awaiting-approval` 并带 `approvals`）、`flow/run-end`（`@mode emit`，带输出变量与黑板快照）。内核 `graph/node-post-execute` waterfall 的改写会同步进黑板，下游节点读到改写后的值。
- **存储接缝**：引擎不直接碰存储；装载 `@deepseek-ai/dsh-graph-flow-storage`，经可选的 `FlowStorageToken` 能力持久化定义与运行记录。该能力按次解析，因此先装引擎、后装存储插件也能在能力到达后正常落盘。
- **画布/CLI 投影**：`@deepseek-ai/dsh-graph-flow-canvas` 消费 `getFlow`、`getRun().nodes` 与 `flow/node-status`，产出可序列化的静态画布与可任意时刻 hydration 的运行中按节点快照；引擎本身不承担布局与 UI 概念。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, { nodeTimeoutMs: 30_000 });
const flow = ctx.get(FlowEngineToken)!;

await flow.registerFlow({
    id: 'demo',
    nodes: [
        { id: 'src', type: 'echo', config: { message: 'hi' } },
        { id: 'sink', type: 'noop', input: { said: '${src.message}' } },
    ],
    edges: [{ from: 'src', to: 'sink' }],
    output: { said: '${sink.said}' },
});
const result = await flow.run('demo').awaitCompletion();
```

配置：`nodeTimeoutMs`（默认节点超时，30 000 毫秒）。

## 非目标（二期）

不做 Client 端可视化画布（内核 `Graph` 即将来数据源；运行状态今天已经可以经事件订阅）。不做迭代/循环节点、触发器、除 `${nodeId.slot}` 外的表达式语言。

中文文档即本文件；英文见 [README.md](./README.md)。
