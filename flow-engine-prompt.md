# 可用提示词：通用 Graph 内核 + flow 引擎插件族实现

> 把下面整段投喂给实现 Agent 即可。自包含，不依赖本次会话上下文。

---

在 DSH (Cordis) 工作区实现一个插件族：**通用有向无环图执行内核 + flow 语义层**。
内核只认识中性模型 `Node{id}` / `Edge{from, to}` / `Graph{nodes, edges}`，
负责 DAG 校验、拓扑调度、节点执行生命周期与事件；对"节点是什么、数据怎么流"
完全中立。"flow" 只是内核之上的一层语义适配（节点带 type/config、黑板数据传递），
同一个内核将来可复用于 pipeline、任务编排等其他形态。动手前先读工作区 AGENTS.md，
并用 `pnpm cli list` / `pnpm cli doc` 查看已有能力，避免重复造轮子。

## 包结构（新包统一放在 packages/graph/ 下，命名与 manifest 对齐 DSH 风格；
遵守单包 ≤5 个源文件、单文件 ≤300 行、单函数 ≤30 行。动手前先看一个在装包
的 package.json 作为模板，如 `@deepseek-ai/dsh-session-title`）

| 目录 | 包名 | 职责 |
|---|---|---|
| `packages/graph/graph-core` | `@deepseek-ai/dsh-graph-core` | **通用内核**（对业务零认知）——Graph 模型 + 校验（重复 id / 悬挂边 / 环检测）+ 拓扑调度 + 节点状态机（`pending → ready → running → completed \| failed \| skipped \| cancelled`）+ 生命周期事件 + fail-fast 失败传播策略（`onNodeFailure` 可替换，默认 fail-fast，将来可插件化 continue/retry 而不改内核）。执行单元是回调接口 `GExecutor.execute(node, run)`，由上层适配注入；内核不做数据传递、不做节点类型校验、不碰持久化 |
| `packages/graph/flow-api` | `@deepseek-ai/dsh-graph-flow-api` | flow 语义层最小 API——`FlowDefinition` / `NodeHandler` / brand 过的 `FlowId` `RunId` `NodeId`、`NodeRegistryToken`、注册帮助函数。节点插件只 import type 这个包 + 注入 Token，禁止依赖实现包 |
| `packages/graph/flow-engine` | `@deepseek-ai/dsh-graph-flow-engine` | flow Service——把 `FlowDefinition` 编译成内核 `Graph`（每个 flow 节点包一个 executor：z schema 校验 + 黑板读写 + 事件包裹），提供 `registerFlow` / `unregisterFlow` / `run` / `RunHandle(cancel/status/awaitCompletion)` / `listRuns` |
| `packages/graph/flow-yaml` | `@deepseek-ai/dsh-graph-flow-yaml` | YAML flow 定义加载插件（依赖 flow-engine） |
| `packages/graph/flow-storage` | `@deepseek-ai/dsh-graph-flow-storage` | 用 dsh domain storage 持久化 flow 定义与运行记录（依赖 flow-engine） |

manifest 规范（照抄 DSH 风格）：
- `type: "module"`；`main: lib/index.js`；`exports` 显式映射 `.` 与 `./types`
  （client 面另加 `./client`）；`files` 只含 lib；`src/types.ts` 只放类型。
- cordis 与兄弟 dsh 包放 `peerDependencies`，版本锁到补丁号。
- 文档三件套：README.md（英文）+ README.zh.md（中文）+ README.i18n.yaml；
  附 MIT LICENSE。英文 description 说明"什么情况下用这个包"。

## 关键设计决策（必须遵守）

- **内核中性模型**：`GNode{id}`、`GEdge{from,to}`、`Graph{nodes,edges}`；
  flow 节点用 `edges: Array<{from,to}>` 表达依赖，与内核 Edge 字段对齐。
- **GRunContext = DSH Context 的扩展，不是自造接口**：内核每次 run 用
  `ctx.extend(GRunMeta)` 创建子 context，`GRunMeta = { graphId, runId, signal }`
  （signal 是 cancel / fail-fast 的统一取消通道）；状态上报做成注册在该子
  context 上的服务能力（`RunStatusToken`：
  `getOrThrow(ctx, RunStatusToken).setStatus(node, st)`），节点作用域再用
  `ctx.isolate(nodeId)` 派生。执行单元是回调接口
  `GExecutor.execute(node, ctx: GRunContext)`，由上层适配注入；内核不做数据传递、
  不做节点类型校验、不碰持久化。
- **黑板数据模型**（flow 层）：在内核 run 子 context 之上再
  `ctx.extend({ flowId })`；
  节点在 `ctx.isolate(nodeId)` 作用域内向 flow 级黑板写命名 slot，下游按名读取。
  边只表达依赖顺序，不传值。
- **节点注册**：`NodeRegistry.register(type, handler)`；handler 含
  `config: z<TConfig>`（用 `@deepseek-ai/schemastery`）与 `execute(input)`。
  插件在 apply 里用 `ctx.effect(register, dispose)` 注册，保证卸载逆序清理。
- **生命周期事件**（定义在 `@deepseek-ai/dsh-graph-core`，payload 只含中性字段 graphId/runId/nodeId；
  declaration merging 定义类型，JSDoc 标 `@mode`；命名对齐 DSH 惯例：
  kebab-case + `/` 命名空间前缀，拦截用 `pre-`、加工用 `post-`、
  即将发生用 `-ing`、起止用 `start`/`end`）：
  - `graph/run-starting` @mode serial 拦截——监听器可拒绝启动（参照 `agent/turn-stopping`）；
  - `graph/run-start` @mode emit；
  - `graph/node-pre-execute` @mode bail——返回 false 跳过该节点（参照 `tools/pre-execute`）；
  - `graph/node-post-execute` @mode waterfall——加工节点产出，监听器必须调 `next()`
    （参照 `tools/post-execute`）；
  - `graph/node-error` @mode emit——结构化错误 `{ code, graphId, runId, nodeId, cause }`；
  - `graph/run-end` @mode emit——`{ runId, status }`。
  flow 层再转发/补充语义事件（`flow/run-starting` / `flow/run-start` / `flow/run-end`，
  带 flowId 与黑板快照）。
- **失败语义 fail-fast**（内核默认策略）：节点失败 → 未启动下游标记 `skipped`；
  正在运行的兄弟分支等待自然结束（signal 只通知，执行方自愿响应），run 进入 `failed`。
  超时在 flow 层实现：节点级可配 `timeout`，默认取引擎 config，错误码 `NODE_TIMEOUT`。
- **结构化错误**：内核 `GRAPH_CYCLE_DETECTED` / `GRAPH_DANGLING_EDGE` /
  `GRAPH_DUPLICATE_NODE`；flow 层 `FLOW_CYCLE_DETECTED` / `FLOW_REFERENCE_CYCLE` /
  `NODE_TYPE_NOT_FOUND` / `NODE_CONFIG_INVALID` / `NODE_FAILED` / `NODE_TIMEOUT` /
  `FLOW_CANCELLED`。全部稳定 code + 机器可读字段；misconfiguration fails loud。
- **边条件与命名输出端口**（参照 n8n 多输出 / Dify IF-ELSE）：内核 Edge 加可选
  `when` 谓词（上层注入求值）；条件不满足 → 下游 `skipped`，skipReason 记
  `upstream-condition`（与失败传播的 `upstream-failure` 区分）。
- **节点级失败策略**（参照三家 onError）：节点可配
  `onError: 'failFast' | 'fallback' | 'errorBranch'`，默认 `failFast`；
  `fallback` 输出声明式兜底值继续跑；`errorBranch` 沿名为 `error` 的输出端口
  继续（声明了该端口才可配）。节点级策略在 flow 层实现、优先生效；
  内核 `onNodeFailure` 全局策略保留。
- **节点重试**：`retry: { tries, backoffMs }`，flow 层 executor 包裹实现。
- **子流程节点**：内置 `subflow` 节点类型引用另一个 FlowId（flow 即节点，
  递归组合）；flow 引用图同样做环检测，报 `FLOW_REFERENCE_CYCLE`。
- **显式输入映射**（参照 Dify 变量选择器）：节点声明
  `input: Record<string, '${nodeId.slot}' | 字面量>`，引擎解析后作为 execute
  入参注入；数据流显式化（可测、可画布展示血缘）。
- **Start/End 签名**：FlowDefinition 加 `input: z schema` 与
  `output: Record<string, '${nodeId.slot}'>`；run() 校验入参，
  RunResult 携带解析后的输出变量。
- **节点类型版本**（参照 n8n typeVersion）：NodeHandler 加 `version`，
  注册表按 `(type, version)` 索引，FlowDefinition 可固定引用版本。
- **mock 试跑**（参照 n8n pinned data / Coze 节点 mock）：run() 支持
  `mocks: Record<NodeId, unknown>`，被 mock 的节点跳过执行直接产出。
- **执行记录**：RunResult 每节点带
  `{ status, skipReason?, startedAt, endedAt, error? }`。
- 明确不做（写进 README 的"非目标"）：迭代/循环节点、触发器、完整表达式语言
  均为二期；一期表达式只支持 `${nodeId.slot}` slot 引用。
- **引擎 config**（schemastery）：`@deepseek-ai/dsh-graph-core` 只有 `concurrency`（就绪集并发上限，默认 4）；
  flow-engine 只有 `nodeTimeoutMs`（默认节点超时）。
- flow-engine 不直接碰存储，通过注入的 storage Service 能力（单一职责）。

## 交付要求

- `packages/graph/flow-engine` 提供 2~3 个内置最简节点类型作为参考实现与集成测试夹具
  （如 `noop`、`fail`、`echo`），不要内置业务节点。
- `packages/graph/graph-core` 的单测用纯内存 executor 覆盖：调度顺序、并发上限、环检测、
  cancel 传播、fail-fast、状态机全迁移路径——不依赖 flow 层。
- 每个 package.json 必须有英文 description，说明"什么情况下用这个包"；
  文档三件套：README.md（英文）/ README.zh.md（中文）/ README.i18n.yaml（怎么用）。
- 注释中英双语。src/types.ts 只放类型。本地导入带 `.ts` 后缀、全 ESM NodeNext。
- 插件写法遵循推荐模式：`defineToken` + `Service` 子类 / `export const name` +
  `Config: z<Config>` + `inject` + `apply`；禁止 default export；
  inject 依赖的是能力（Service）。
- 测试（vitest）：
  - `*.spec.ts` 必须并发安全（单独跑才过 = 缺陷）；
  - NodeRegistry 贡献必须带 dispose / HMR 安全测试；
  - 至少一个走真实 Loader 的 composition 测试；
  - `packages/graph/flow-storage` 补 `*.e2e.ts`（真实 storage，无凭据自跳过，retry: 2）。
- 明确写出一期不做的事：Client 端可视化 UI 是二期，不要在本轮实现，
  但内核 Graph 模型就是将来画布的数据源，node 布局元数据由上层附加、内核不存，
  且 Service/事件 API 要为二期留面（运行状态可订阅）。

## 验收

1. `@deepseek-ai/dsh-graph-core` 用内存 executor 通过：拓扑顺序正确、并发不超上限、
   cancel 后各节点进入 `cancelled`、fail-fast 下游 `skipped` 且兄弟分支跑完；
2. YAML 定义一个含并行分支的 flow，yaml 插件加载成功并注册进引擎；
3. 用内置节点组合出：并行执行 → 汇聚 → 一路失败 → fail-fast 生效
   （下游 skipped、兄弟分支跑完、flow failed、事件序列正确）；
4. `graph/node-post-execute` waterfall 能改写节点产出且下游黑板读到改写后的值；
5. 卸载一个节点插件后再次运行引用它的 flow，得到 `NODE_TYPE_NOT_FOUND`；
6. 引用一个不存在节点的 Edge 注册时得到 `GRAPH_DANGLING_EDGE`；
7. 带条件边的 flow：条件为 false 的分支下游 `skipped`（skipReason `upstream-condition`），
   条件为 true 的分支正常执行；
8. `onError: 'fallback'` 的节点失败后输出兜底值、流程完成；`'errorBranch'`
   的失败走 `error` 端口继续，未失败时该端口不触发；
9. 配了 `retry: { tries: 3 }` 的节点前两次失败、第三次成功，最终完成；
   `subflow` 节点能执行被引用的 flow；互相引用的两个 flow 注册时报
   `FLOW_REFERENCE_CYCLE`；
10. `mocks` 指定的节点不执行、直接产出 mock 值；
11. 卸载一个节点插件后再次运行引用它的 flow，得到 `NODE_TYPE_NOT_FOUND`；
12. 全部 spec 并发通过，dispose 测试证明无注册泄漏。
