# @veren/graph-core

面向 Cordis 应用的业务无关有向无环图（DAG）执行内核。当你需要执行一张"抽象节点的依赖图"——flow 引擎、pipeline、任务编排——而又不想让内核知道"节点是什么、数据怎么流"时，使用它。需要 flow 语义（类型化节点、黑板数据传递）时，请在 `@veren/graph-flow-engine` 之上适配；内核保持中立。

## 提供什么

- **中性模型** —— `GNode{id}`、`GEdge{from, to, when?}`、`Graph{id, nodes, edges}`。边上的 `when` 谓词由上层注入，内核只负责求值时机（上游节点落定后）。
- **尽早且响亮的校验** —— `GRAPH_DUPLICATE_NODE`、`GRAPH_DANGLING_EDGE`、`GRAPH_CYCLE_DETECTED`（含 Kahn 拓扑排序）。
- **就绪集调度器** —— 拓扑调度 + 并发上限（`concurrency`，默认 4）。
- **节点状态机** —— `pending → ready → running → completed | failed | skipped | cancelled`，逐节点记录（`startedAt`、`endedAt`、`error`、`output`、`skipReason`）。
- **run 子 context** —— 每次 run 通过 `ctx.extend({ graphId, runId, signal })` 派生（`GraphRunContext` 是 Cordis `Context` 的扩展，不是自造接口）；节点作用域用 `ctx.isolate(nodeId)` 派生；状态上报能力以 `RunStatusToken` 注册在 run context 上。
- **生命周期事件**（declaration merging，JSDoc 标注 `@mode`）：
  - `graph/run-starting` `@mode serial` —— 监听器返回真值即拒绝启动；
  - `graph/run-start` `@mode emit`；
  - `graph/node-pre-execute` `@mode bail` —— 真值否决该节点（skipped，`pre-execute-veto`）；
  - `graph/node-post-execute` `@mode waterfall` —— 监听器修改 `envelope.output` 且**必须调用 `next()`**；
  - `graph/node-error` `@mode emit` —— 结构化错误 `{ code, graphId, runId, nodeId, cause }`；
  - `graph/run-end` `@mode emit` —— `{ runId, graphId, status }`。
- **失败传播** —— 默认 fail-fast：失败节点的下游标记 `skipped`（`upstream-failure`），运行中的兄弟分支自然跑完（signal 只通知，执行方自愿响应），run 结束为 `failed`。策略可按 run 替换（`onNodeFailure`），将来 continue/retry 等策略插件化不改内核。
- **边条件** —— `when` 为 false 时跳过该边的下游子树，skipReason 记 `upstream-condition`，与失败传播区分。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, GraphKernelToken } from '@veren/graph-core';

const ctx = new Context();
await ctx.plugin(apply, { concurrency: 4 });
const kernel = ctx.get(GraphKernelToken)!;

const handle = kernel.run({
  id: 'demo',
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ from: 'a', to: 'b' }],
}, {
  execute: async (node, runCtx) => {
    runCtx.signal.throwIfAborted(); // 协作式取消
    return { from: node.id };
  },
}, { runId: 'r1' });

handle.cancel(); // 可选，协作式
const result = await handle.result;
```

## 非目标（二期）

- 不做 Client 端可视化画布 —— 中性 `Graph` 模型就是将来画布的数据源；节点布局元数据由上层附加，内核不存。Service/事件 API 为二期保留订阅面。
- 不做迭代/循环节点、触发器、完整表达式语言（一期只有 flow 层的 `${nodeId.slot}` slot 引用）。
- 不做节点间数据传递 —— 请在你的 `GExecutor` 内适配。

中文文档即本文件；英文见 [README.md](./README.md)。
