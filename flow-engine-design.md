# Graph 引擎设计文档（v2 草案）

> 定位：DSH (Cordis) 插件族。**通用有向无环图执行内核**——内核只认识
> `Node{id}` / `Edge{from, to}` / `Graph{nodes, edges}`，负责 DAG 校验、
> 拓扑调度、节点执行生命周期与事件；对"节点是什么、数据怎么流"完全中立。
> "flow" 是内核之上的一层语义适配：节点带 type/config、黑板数据传递。
> 其余能力全部由其他插件以"节点类型"形式扩展贡献。

## 1. 需求决策记录

| 决策点 | 结论 |
|---|---|
| 内核抽象层级 | 通用 Graph 内核（Node/Edge/Graph 中性模型），flow 是其上的语义层 |
| 节点间数据传递 | 共享黑板（flow 级 Context），节点读写命名 slot；边只表达依赖 |
| 节点类型注册 | NodeRegistry Service + ctx.effect 注册/逆序 dispose |
| 失败语义 | fail-fast：任一节点失败 → 取消未启动下游、标记 skipped、run failed |
| 范围 | 分阶段：一期纯 Host 引擎，二期 Client 可视化 UI |
| 定义来源 | ① 代码 API ② DSH domain storage 持久化 ③ YAML 由独立内置插件加载 |

## 2. 分层与包结构（遵守单包 ≤5 源文件、单文件 ≤300 行）

```
packages/graph/                        # 领域组，对齐 DSH 的 packages/<group>/<name> 布局
  graph-core/        → @deepseek-ai/dsh-graph-core          # 通用内核：Graph 模型 + 校验 + 拓扑调度 + 生命周期 + 事件
  flow-api/          → @deepseek-ai/dsh-graph-flow-api      # flow 语义层最小 API：类型 + Token + NodeRegistry + register 帮助函数
  flow-engine/       → @deepseek-ai/dsh-graph-flow-engine   # flow Service：FlowDefinition → Graph 的适配 + 黑板数据传递
  flow-yaml/         → @deepseek-ai/dsh-graph-flow-yaml     # YAML 定义加载插件（依赖 flow-engine）
  flow-storage/      → @deepseek-ai/dsh-graph-flow-storage  # domain storage 持久化定义与运行记录（依赖 flow-engine，可后置）
```

### 命名与 manifest 对齐 DSH 风格（实测自 `@deepseek-ai/dsh-session-title` 等在装包）

- scope 统一 `@deepseek-ai/`；包名 `dsh-graph-<名称>` kebab-case；
  目录 = 去掉 `dsh-graph-` 前缀的短名。
- `type: "module"`；构建产物 `lib/index.js` + `lib/types/**/*.d.ts`；
  `exports` 显式映射 `.`、`./types`（及需要的 `./client`）子路径；
  `files` 只含 lib；`src/types.ts` 只放类型。
- cordis 与兄弟 dsh 包走 `peerDependencies`，版本锁到补丁号（`0.x.y-rc.z` 风格）。
- 文档三件套：`README.md`（英文）+ `README.zh.md`（中文）+ `README.i18n.yaml`；
  另附 LICENSE（MIT）。注意：DSH 实际用 README.zh.md，与 AGENTS.md 所写
  README.cn.md 不一致——本设计跟随 DSH 实际风格，落地时以仓库现状裁决。

- **graph-core 对业务零认知**：不知道 flow、不知道节点类型注册表、不碰数据。
  它暴露的执行单元是一个回调接口，由上层适配注入。
- 节点插件只依赖 `flow-engine-node-api`（import type + Token），不依赖实现 → 升级稳定。
- 跨包一律 import type；行为通过注入的 Cordis Service（Token）交互。
- 跨边界 id 用 brand：`GraphId` / `RunId` / `NodeId`。

## 3. 内核模型（graph-core）

```ts
interface GNode { id: NodeId }
interface GEdge { from: NodeId; to: NodeId }
interface Graph { nodes: GNode[]; edges: GEdge[] }

// 内核调用的执行单元：上层适配器负责把 GNode 翻译成真正的执行逻辑
interface GExecutor {
  execute(node: GNode, ctx: GRunContext): Promise<void>
}

// GRunContext 不是自造接口，而是 DSH (Cordis) Context 的扩展：
// 每次 run 用 ctx.extend(runMeta) 创建子 context，执行期服务
// （状态上报等）注册在该子 context 上，ctx.isolate(nodeId) 再派生节点作用域。
interface GRunMeta {
  graphId: GraphId
  runId: RunId
  signal: AbortSignal           // cancel / fail-fast 取消的统一通道
}
type GRunContext = Context      // 已 extend(GRunMeta)；读元数据走 RunMetaToken
// RunStatusToken: 注册在 run 子 context 上的状态上报能力
// getOrThrow(ctx, RunStatusToken).setStatus(node, st)
```

内核职责（且仅此）：
1. **图校验**：重复 id、悬挂边（引用不存在的节点）、环检测，注册时完成；
   结构化错误 `GRAPH_CYCLE_DETECTED` / `GRAPH_DANGLING_EDGE` / `GRAPH_DUPLICATE_NODE`。
2. **拓扑调度**：入度就绪集并发执行，并发上限可配；`signal` 广播取消。
3. **节点状态机**：`pending → ready → running → completed | failed | skipped | cancelled`。
4. **生命周期事件**（见 §5）。
5. **失败传播**：fail-fast 策略内置且可替换（策略函数 `onNodeFailure`，默认
   fail-fast；将来可插件化提供 continue/retry 等策略而不改内核）。

内核**不做**：数据传递（黑板）、节点类型校验（z schema）、持久化、flow 语义。

## 4. flow 语义层（flow-engine + node-api）

```ts
interface FlowDefinition {
  id: FlowId
  nodes: Array<{
    id: NodeId
    type: string                  // NodeRegistry 中注册的节点类型
    config: unknown               // 由节点类型自己的 z schema 校验
  }>
  edges: Array<{ from: NodeId; to: NodeId }>   // 对齐内核 Edge{from,to}
}

interface NodeHandler<TConfig> {
  config: z<TConfig>
  execute(input: { ctx: Context; config: TConfig }): Promise<unknown>
}
```

- 适配器把 `FlowDefinition` 编译成内核 `Graph`（每个 flow 节点包一个 executor，
  executor 内做 z schema 校验 + 黑板读写 + 生命周期事件包裹），
  `registerFlow` 时做环检测报 `FLOW_CYCLE_DETECTED`（复用内核校验，换 code 语义）。
- **黑板**：内核 run 的子 context（`ctx.extend(GRunMeta)`）之上，flow 层再
  `ctx.extend({ flowId })`；节点在 `ctx.isolate(nodeId)` 作用域内向黑板写命名
  slot，下游按名读取。并发分支各写各的 slot，无竞争。
- **注册**：`NodeRegistry.register(type, handler)`，插件在 apply 里用
  `ctx.effect(register, dispose)` 保证卸载逆序清理、HMR 安全。

## 5. 生命周期与事件（内核层通用，declaration merging + JSDoc @mode）

事件定义在 graph-core，payload 只含中性字段（graphId/runId/nodeId），
flow 层再 emit 自己的语义事件（可带 flowId、输出值）：

内核事件命名对齐 DSH 惯例：kebab-case + `/` 命名空间前缀；
拦截用 `pre-`（参照 `tools/pre-execute`）、加工用 `post-`（`tools/post-execute`）、
即将发生用 `-ing`（`agent/turn-stopping`）、起止用 `start`/`end`（`workflow/start|end`）：

```
graph/run-starting      serial    拦截：任一监听器拒绝则 run 不启动
graph/run-start         emit      （参照 workflow/start）
graph/node-pre-execute  bail      返回 false 跳过该节点（下游照常，标记 skipped）
graph/node-post-execute waterfall 加工：节点产出可被下游链改写（监听器必须调 next()）
graph/node-error        emit      结构化错误 { code, graphId, runId, nodeId, cause }
graph/run-end           emit      { runId, status: completed|failed|cancelled }
```

flow 层事件：`flow/run-starting` / `flow/run-start` / `flow/run-end`
（转发自内核并补充 flowId、黑板快照）。

- waterfall 监听器必须调 `next()`，否则短路整条链（事件契约强制面）。
- 事件类型走 declaration merging，JSDoc 标注 `@mode`。

## 6. 失败语义（fail-fast，默认策略）

- 节点抛错 → 该节点 `failed`；未启动的下游全部 `skipped`；
  正在运行的兄弟分支**等待自然结束**（不粗暴杀异步；内核 signal 仅通知，
  执行方自愿响应），全部落定后 run 进入 `failed`。
- 超时：flow 节点级可配 `timeout`（默认取引擎 config），超时按失败处理，`NODE_TIMEOUT`。
- 错误码：内核 `GRAPH_*`（见 §3）；flow 层 `FLOW_CYCLE_DETECTED` / `NODE_TYPE_NOT_FOUND` /
  `NODE_CONFIG_INVALID` / `NODE_FAILED` / `NODE_TIMEOUT` / `FLOW_CANCELLED`。
  全部结构化：稳定 code + 机器可读字段；misconfiguration fails loud。

## 7. Service API

```ts
// graph-core: GraphEngineService（通用）
createGraph(graph: Graph, opts?: { executor: GExecutor; onNodeFailure? }): GraphId
run(graphId: GraphId): RunHandle          // { runId, status(), cancel(), awaitCompletion() }
listRuns(): RunSummary[]

// flow-engine: FlowEngineService（语义层）
registerFlow(def: FlowDefinition): FlowId // 编译为内核 Graph + 环检测 + 类型校验
unregisterFlow(id: FlowId): void
run(id: FlowId, input?: BlackboardSeed): RunHandle
listRuns(): RunSummary[]
```

- storage 插件负责把 flow 定义 / 运行记录写进 dsh domain storage；
  flow 层不直接碰存储（单一职责），通过注入的 storage Service 能力。

## 8. 配置（@deepseek-ai/schemastery）

```ts
// graph-core
interface Config { concurrency: number }        // 就绪集并发上限，默认 4
// flow-engine
interface Config { nodeTimeoutMs: number }      // 默认节点超时
```

## 10. 竞品对照与补漏（n8n / Dify / 扣子）

> 对照 n8n、Dify、Coze 的工作流设计查漏补缺。分期：一期必须 / 一期建议 / 二期。

### 一期必须

1. **边条件与命名输出端口**（n8n 多输出分支、Dify IF/ELSE）：
   - 内核 Edge 加可选 `when`（谓词，由上层注入求值）；
   - 条件不满足的边 → 下游标记 `skipped`（原因 `upstream-condition`，与
     失败传播的 `upstream-failure` 区分，run 结果里可区分）。
2. **节点级失败策略**（三家标配的 onError）：
   `onError: 'failFast' | 'fallback' | 'errorBranch'`，默认 `failFast`；
   - `fallback`：输出声明式 fallback 值，流程继续；
   - `errorBranch`：失败沿名为 `error` 的输出端口继续（有该端口才可配此策略）；
   内核的 `onNodeFailure` 全局策略保留，节点级策略由 flow 层实现并优先生效。
3. **节点重试**：`retry: { tries, backoffMs }`（flow 层，executors 包裹实现）。
4. **子流程节点**（n8n Execute Workflow / Coze Workflow 节点）：
   内置 `subflow` 节点类型，引用另一个 FlowId，节点执行 = 一次嵌套 run；
   禁环（flow 引用图也做环检测，`FLOW_REFERENCE_CYCLE`）。

### 一期建议

5. **显式输入映射**（Dify 变量选择器）：节点声明
   `input: Record<string, '${nodeId.slot}' | 字面量>`，引擎解析后注入
   execute 入参，取代"节点自己随意读黑板"；黑板仍可读，但显式映射是
   推荐路径（数据流显式 → 可测、可画布展示血缘）。
6. **Start/End 签名**（Dify Start/End）：FlowDefinition 加
   `input: z schema` 与 `output: Record<string, '${nodeId.slot}'>`；
   run() 校验入参、RunResult 携带解析后的输出变量。
7. **节点类型版本**（n8n typeVersion）：NodeHandler 加 `version`，
   注册表按 `(type, version)` 索引，FlowDefinition 引用时可固定版本。
8. **mock 试跑**（n8n pinned data / Coze 节点 mock）：run() 支持
   `mocks: Record<NodeId, unknown>`，被 mock 的节点跳过执行直接产出——
   引擎自身的可测试性与用户调试共用一条路径。
9. **执行记录**：RunResult 每节点带 `{ status, skipReason?, startedAt, endedAt, error? }`；
   storage 插件据此落库。

### 二期（不进一期）

10. **迭代/循环**（Dify Iteration、Coze Loop）：作为特殊节点类型实现
    （内部子 run 遍历数组），不进内核 DAG——DAG 保持无环。
11. **触发器**（n8n trigger）：= 监听外部事件后调用 run() 的普通插件，内核不改。
12. **表达式求值**：只支持 slot 引用 `${nodeId.slot}`，不做完整表达式语言
    （与薄内核定位一致）。

## 11. 二期（Client UI，写进目标但不在一期实现）

- Graph/flow 画布与运行状态面板：内核的 Graph 模型本身就是画布数据源，
  node 坐标等布局元数据由上层（flow/yaml/UI 层）附加，内核不存。
- client 端插件：slot inject（铁律一）、children 声明 + 授权（铁律二）、
  props 派生共享、动态事实包 HostObservable hooks、组件不接触 ctx；
  多主题 token + ctx.locale.register 双语。

## 12. 测试要求

- vitest：`*.spec.ts` 并发安全（单独跑才过 = 缺陷）；
- registry 贡献必须带 dispose / HMR 安全测试；
- 插件要有走真实 Loader 的 composition 测试；
- graph-core 用纯内存 executor 做调度/状态机/取消的单测（不依赖 flow 层）；
- `*.e2e.ts` 真实环境、无凭据自跳过、retry: 2。
