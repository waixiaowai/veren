# @deepseek-ai/dsh-graph-flow-canvas

flow 的画布数据源：可序列化的静态投影 + 运行中按节点的实时投影。上层（未来的可视化画布、CLI 画图、编辑器插件）想绘制或检查一个已注册 flow、又不想懂内核调度/黑板/事件细节时使用它。需要执行或定义 flow 时用 `@deepseek-ai/dsh-graph-flow-engine`；找浏览器 UI 时不要用本包——本包不包含 UI、渲染器或布局算法。

## 提供什么

- **`graphFlowCanvas` 服务**：`project(flowId)` / `projectDefinition(def)` 返回 `CanvasFlow`；`watch(handle)` / `run(flowId, options, listener)` 返回 `CanvasRunProjection`。
- **静态投影（`CanvasFlow`）**：节点带 `id`、`type`、可选的固定 `version`、`display` 标签/副标题、JSON 安全的 `config` 与 `input`、`onError`/`retry`/`timeout`，以及 `layout` 槽位；边带稳定的 `from`/`to`、可选的命名 `port`，以及可序列化的 `condition`（`always` | `port` | `predicate` | `error-branch-default`；最后一种表示 errorBranch 节点的默认输出会在 error 端口激活时关闭）。结构带版本号（`schemaVersion: 1`），`JSON.stringify` / `JSON.parse` 往返稳定。
- **条件边不泄漏函数**：谓词是函数，进不了 JSON，因此投影只标记 `condition.kind: 'predicate'` 与 `hasPredicate: true`；命名输出端口则原样暴露（`condition.kind: 'port'`、`condition.port`）。`errorBranch` 节点的默认出边标记为 `kind: 'error-branch-default'`，因为 error 端口激活时它会关闭。本包从不求值谓词文本。
- **布局归调用方**：`CanvasFlow.layout` 存在但为空（`{ viewport: null, nodes: {}, edges: {} }`），每个节点/边还有 `layout: null` 槽位。调用方自行填充；内核不存布局，本包也不生成坐标。
- **运行投影**：订阅一次运行，按节点收到 `pending → ready → running → completed | failed | skipped | cancelled`，带 `skipReason`、结构化 `error`、`startedAt` 与 `endedAt`。不轮询、不读日志：消费引擎的 `flow/node-status` 事件（由内核中性事件 `graph/node-status` 转发）。
- **最终快照与 `FlowRunResult` 一致**：`projection.finished` 解析出的 `CanvasRunSnapshot.result` 就是 `handle.awaitCompletion()` 返回的同一个 `FlowRunResult`；`nodes` 还会从该结果重新同步，因此晚订阅也不会漏掉落定状态。
- **干净收尾**：运行结束时移除 `flow/node-status` 与 `flow/run-end` 监听器；`dispose()` 幂等，只停止订阅，不取消运行。
- **引擎的 `getFlow`**：画布服务经 `FlowEngine.getFlow(flowId)` 读取已注册定义；未知 id 抛 `CANVAS_FLOW_NOT_FOUND`，非 JSON 配置抛 `CANVAS_NOT_SERIALIZABLE`。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as canvas, FlowCanvasToken } from '@deepseek-ai/dsh-graph-flow-canvas';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, { nodeTimeoutMs: 30_000 });
await ctx.plugin(canvas);
const flow = ctx.get(FlowEngineToken)!;
const view = ctx.get(FlowCanvasToken)!;

await flow.registerFlow({
    id: 'demo',
    nodes: [
        { id: 'src', type: 'echo', config: { message: 'hi', label: 'Source' } },
        { id: 'sink', type: 'noop', input: { said: '${src.message}' } },
    ],
    edges: [{ from: 'src', to: 'sink' }],
    output: { said: '${sink.said}' },
});

const staticCanvas = view.project('demo');
staticCanvas.layout.nodes['src'] = { x: 40, y: 80 }; // 布局由调用方填充

const live = view.run('demo', {}, (change) => {
    console.log(change.nodeId, change.status, change.skipReason ?? '', change.error ?? '');
});
const final = await live.finished;
console.log(final.status, final.result?.output);
```

## 演示

可运行演示用真实 YAML Loader 装载 `examples/demo.flow.yaml`，打印画布 JSON，再打印一次运行的按节点状态流：

```bash
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

它会在一次运行里展示：`error` 端口条件（`gate → recover`）、默认分支被跳过（`normal`，`upstream-condition`）、节点失败（`fatal`，`NODE_FAILED`）以及下游被跳过（`join`，`upstream-failure`）。

## 契约说明

- `watch(handle)` 必须在 `engine.run()` 之后尽快调用；投影会从已注册定义把每个节点播种为 `pending`，但不缓存 attach 之前的事件。需要"启动即订阅"时用 `run()`。
- 最终 `snapshot.nodes` 从 `FlowRunResult` 重建，因此即使漏掉一条状态事件，最终快照仍是权威的。
- `flow/node-status` 是引擎事件；本包不把状态写存储、也不写日志。

## 非目标（二期）

- 不做浏览器 UI、渲染器、布局算法或任何前端依赖；本包只产出数据。
- 不做布局持久化：坐标永不进入内核或引擎。
- 不做表达式求值：谓词只被报告，不被解释。

中文文档即本文件；英文见 [README.md](./README.md)。
