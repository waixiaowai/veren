# @veren/graph-flow-engine

DAG 内核之上的 flow 语义层引擎。当你需要 flow 语义——带 schema 校验配置的类型化节点、显式输入映射、每次运行的黑板、重试/超时/onError 策略、子流程与 mock——并编译到中性内核上执行时使用它。只需要内核本身（`@veren/graph-core`）或纯类型（`@veren/graph-flow-api`）时请跳过。

## 提供什么

- **`FlowEngine` 服务**（`graphFlowEngine`）：`registerFlow` / `unregisterFlow` / `hasFlow` / `listFlows` / `run` / `listRuns` / `getRun`。
- **注册表与运行读取面**：`listFlows()` 返回每个已注册 flow 的 id、节点数、边数与声明的输出变量名（按 id 升序）；`getRun(runId)` 返回单次运行的状态，完成后带上完整结果（`FlowRunDetail.result`）。`@veren/graph-tools` 就是把这套读取面暴露成模型可见工具。
- **注册期编译，fails loud**：`NODE_TYPE_NOT_FOUND`、`NODE_CONFIG_INVALID`、`FLOW_CYCLE_DETECTED`、`FLOW_REFERENCE_CYCLE`（subflow 互引用）、`GRAPH_DANGLING_EDGE` 透传。
- **`run()` → `FlowRunHandle`**：`status()`、协作式 `cancel()`、`awaitCompletion()`；`FlowRunResult` 携带解析后的输出变量与逐节点记录（`{ status, skipReason?, startedAt, endedAt, error? }`）。
- **节点执行器包裹**：显式输入映射（`${nodeId.slot}` 或字面量）、重试（`{ tries, backoffMs }`）、节点级/引擎级超时（`NODE_TIMEOUT`）、`mocks`（固定产出，跳过执行）、`onError` 策略 —— `failFast`（默认）、`fallback`（声明式兜底值继续跑）、`errorBranch`（失败沿名为 `error` 的输出端口继续，默认端口改为关闭）。
- **内置节点类型**（仅参考实现/测试夹具）：`noop`、`fail`、`echo`、`subflow`（flow 即节点；引用环在注册期检测，运行期递归另有防护）。
- **Start/End 签名**：`input` schema 每次 run 校验；`output` slot 引用解析进 `FlowRunResult.output`。
- **节点类型版本**：注册表按 `(type, version)` 索引；handler 运行期重解析，节点插件卸载后再次运行会响亮地得到 `NODE_TYPE_NOT_FOUND`。
- **flow 事件**：`flow/run-starting`（`@mode serial`，真值拒绝）、`flow/run-start`、`flow/run-end`（`@mode emit`，带输出变量与黑板快照）。内核 `graph/node-post-execute` waterfall 的改写会同步进黑板，下游节点读到改写后的值。
- **存储接缝**：引擎不直接碰存储；装载 `@veren/graph-flow-storage`，经可选的 `FlowStorageToken` 能力持久化定义与运行记录。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@veren/graph-core';
import { apply as engine, FlowEngineToken } from '@veren/graph-flow-engine';

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
