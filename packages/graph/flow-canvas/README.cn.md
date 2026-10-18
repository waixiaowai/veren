# @deepseek-ai/dsh-graph-flow-canvas

flow 的画布数据源：可序列化的静态投影 + 运行中按节点的实时投影。上层（未来的可视化画布、CLI 画图、编辑器插件）想绘制或检查一个已注册 flow、又不想懂内核调度/黑板/事件细节时使用它。需要执行或定义 flow 时用 `@deepseek-ai/dsh-graph-flow-engine`；找浏览器 UI 时不要用本包——本包不包含 UI、渲染器或布局算法。它已作为 `graph-flow-canvas` 行包含在 `@deepseek-ai/dsh-graph-bundle` 中。

## 提供什么

- **`graphFlowCanvas` 服务**：`project(flowId)` / `projectDefinition(def)` 返回 `CanvasFlow`；`watch(handle)` / `run(flowId, options, listener)` 返回 `CanvasRunProjection`。
- **静态投影（`CanvasFlow`）**：节点带 `id`、`type`、可选的固定 `version`、`display` 标签/副标题、JSON 安全的 `config` 与 `input`、`onError`/`retry`/`timeout`，以及 `layout` 槽位；边带稳定的 `from`/`to`、可选的命名 `port`，以及可序列化的 `condition`（`always` | `port` | `predicate` | `error-branch-default`）。每个 condition 还带 `hasPredicate` 与 `closedByErrorPort`，因此“谓词”和“error 端口关闭此边”互相正交。结构带版本号（`schemaVersion: 1`），`JSON.stringify` / `JSON.parse` 往返稳定。
- **条件边不泄漏函数**：谓词是函数，进不了 JSON，因此投影标记 `condition.hasPredicate: true`；命名输出端口则原样暴露（`condition.kind: 'port'`、`condition.port`）。`errorBranch` 节点的默认出边即使同时声明了谓词，也保留 `kind: 'error-branch-default'` 与 `closedByErrorPort: true`，不会退化成普通 `predicate`。本包从不求值谓词文本。
- **布局归调用方**：`CanvasFlow.layout` 存在但为空（`{ viewport: null, nodes: {}, edges: {} }`），每个节点/边还有 `layout: null` 槽位。调用方自行填充；内核不存布局，本包也不生成坐标。
- **运行投影，任意时刻可挂载**：`watch(handle)` 支持 pending、运行中和已完成三种时刻。挂载时先读引擎的 `FlowRunDetail.nodes`（只读实时状态面），把每个节点按真实状态（`completed`/`running`/`pending`/...）同步播种，因此运行中打开面板绝不会把已完成的节点显示成 pending。之后消费 `flow/node-status`；迟到事件做状态序校验、终态吸收，所以不可能出现 `completed → pending` 倒退。不轮询、不读日志。
- **errorBranch 的失败事实仍可见**：`errorBranch` 节点仍以 `completed` 结束、默认端口仍会关闭，但它的记录/状态事件带 `recovered: { code, message }`，画布可以标出“失败已兜底”，同时不改变完成语义与端口行为。
- **等待授权也是可投影状态**：flow 层在 `pending/ready/running/...` 之外多一个 `awaiting-approval`；节点的 `approvals` 携带请求（工具、参数摘要、原因、时间）与结果（同意/拒绝、回答者、时间、来源）。挂起期间 `CanvasNodeRuntime.status` 是 `awaiting-approval`，授权落定后回到 `running`，审计保留到最终结果。
- **最终快照与 `FlowRunResult` 一致**：`projection.finished` 解析出的 `CanvasRunSnapshot.result` 就是 `handle.awaitCompletion()` 返回的同一个 `FlowRunResult`；`nodes` 还会从该结果重新同步，因此晚订阅也不会漏掉落定状态。对一个已完成的 run 调 `watch()` 时会同步播种终态，`watch()` 一返回 `snapshot()` 就是一致的。
- **干净收尾**：运行结束时移除 `flow/node-status` 与 `flow/run-end` 监听器；`dispose()` 幂等，只停止订阅，不取消运行。
- **引擎的 `getFlow` / `getRun`**：画布服务经 `FlowEngine.getFlow(flowId)` 读取已注册定义，经 `FlowEngine.getRun(runId).nodes` 读取实时节点状态；未知 id 抛 `CANVAS_FLOW_NOT_FOUND`，非 JSON 配置抛 `CANVAS_NOT_SERIALIZABLE`。

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

// 面板在运行中才打开：仍然立即拿到真实状态，而不是全 pending
const reopened = view.watch(live.handle);
console.log(reopened.snapshot().nodes);
```

## 演示

可运行演示用真实 YAML Loader 装载 `examples/demo.flow.yaml`，打印画布 JSON，再打印一次运行的按节点状态流：

```bash
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

它会在一次运行里展示：`error` 端口条件（`gate → recover`）、errorBranch 兜底失败（`gate`，`recovered: NODE_FAILED`）、默认分支被跳过（`normal`，`upstream-condition`）、节点失败（`fatal`，`NODE_FAILED`）以及下游被跳过（`join`，`upstream-failure`）。

## 契约说明

- `watch(handle)` 可在任意时刻调用。它会从 `engine.getRun(runId)` 同步 hydration：已完成的 run 用最终 result，运行中的 run 用 `FlowRunDetail.nodes`；`watch()` 一返回 `snapshot()` 就是一致的。需要“启动即订阅”时用 `run()`。
- hydration 之后状态事件保持单调：终态吸收，低序事件（`running` 之后的 `pending`/`ready`）被忽略。`awaiting-approval` 与 `running` 同级，所以授权落定后可以回到 `running`；最终 `snapshot.nodes` 从 `FlowRunResult` 重建，即使漏掉一条状态事件也仍是权威的。
- 缺失的可选节点字段会被省略（不会出现 `error: undefined` 自有属性）；请按值判断，不要按 key 是否存在判断。
- `flow/node-status` 是引擎事件；本包不把状态写存储、也不写日志。

## UI 侧还需要自己做什么

本包刻意停在数据层。UI 仍需决定：

- **布局**：坐标、自动布局策略与 viewport；`CanvasFlow.layout` 与节点/边 layout 槽位都是空的。
- **渲染**：节点形状、端口锚点、边路由、缩放/平移与命中测试。
- **视图状态**：选中、hover、编辑草稿与持久化；这些都不在本包。
- **谓词展示**：只有 `hasPredicate` 与摘要，UI 拿不到谓词表达式文本，也不能求值。
- **recovered 样式**：如果设计上要区分“失败后兜底”和干净成功，把 `CanvasNodeRuntime.recovered` 映射成徽标/描边。
- **授权卡**：`awaiting-approval` 与 `CanvasNodeRuntime.approvals` 已经跨线缆可得；画布面板按节点渲染授权卡，第三方渲染器也可以只用这两个字段。
- **主题、i18n、无障碍**：全是 UI 侧职责。

## 非目标（二期）

- 不做浏览器 UI、渲染器、布局算法或任何前端依赖；本包只产出数据。
- 不做布局持久化：坐标永不进入内核或引擎。
- 不做表达式求值：谓词只被报告，不被解释。

中文文档即本文件；英文见 [README.md](./README.md)。
