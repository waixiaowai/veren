# flow-canvas 画布数据源复核报告

- 复核对象：`packages/graph/flow-canvas`（`@deepseek-ai/dsh-graph-flow-canvas`），以及它依赖的 `graph/node-status` / `flow/node-status` 事件面。
- 复核方式：只读源码/测试，执行 8 包 build、递归 spec、README demo；另在仓库外写独立探针，验证 JSON 序列化、运行状态流、晚订阅、监听器清理、事件中性、布局不被内核填充。探针与日志已清理。
- 判断标准：不是逐条验收，而是“一个真要画这张图的实现者，拿这个数据面够不够用”。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。

---

## 0. 结论速览

| 维度 | 结论 | 一句话判断 |
|---|---|---|
| 静态投影 | **通过（可画图）** | 节点/边/条件/retry/timeout/input 都能 `JSON.stringify`；`layout` 为空且内核没有填；谓词只留标记，errorBranch 默认边可识别。 |
| 运行投影 | **基本通过（可做状态板）** | 状态流完整覆盖 `pending → ready → running → completed/failed/skipped/cancelled`；两种 skip、取消、最终 result 同一对象、listener 清理都实测通过。 |
| 晚订阅 | **有缺口（需 `await finished`）** | 跑完再 `watch()`，最终态通过 `finished` 可拿；但立即 `snapshot()` 会出现 `status: completed` 而节点仍 `pending` 的瞬时不一致。 |
| 事件面 | **通过** | `graph/node-status` 顶层只有中性字段、无 `flowId`；`flow/node-status` 带 `flowId`、无 `graphId`；canvas 只加 `flow/node-status` / `flow/run-end` 监听器。 |
| 规范 | **通过（bundle 有遗漏）** | 5 个源文件、最大 194 LF、README 三件套、英文 description、LICENSE、无前端依赖；但 bundle 的 patch/tarballs 没有 flow-canvas。 |
| 回归 | **通过** | 8 包 build exit 0；递归 test exit 0，**98 spec**；旧 83 spec 没有减少（旧包 83 + status 2 + engine 1 + canvas 12）。 |
| demo | **通过** | README 的 `pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo` 在 PowerShell 下 exit 0，输出含 error 端口边、layout 空槽、completed/skipped/failed 状态。 |

**总评：够画一张静态图，也够做“节点状态板”；不够直接做生产级运行态调试画布——边执行历史、运行中节点 I/O、分组/子图和多运行 patch 都不在数据面里。**

---

## 1. 复跑记录

### 1.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

结果：**8 个包** `tsc` 全部通过，`EXIT=0`（含新增 `flow-canvas`）。

### 1.2 递归 spec

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

结果：`EXIT=0`，**98 spec 全绿**：

| 包 | 通过数 |
|---|---:|
| flow-api | 6 |
| graph-core | 18（旧 16 + status.spec 2） |
| flow-engine | 35（旧 34 + errorBranch 端口校验 1） |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas | **12（project 6 / watch 5 / demo 1）** |
| **合计** | **98** |

旧 83 个 spec 的覆盖没有减少：6 + 16 + 34 + 5 + 4 + 10 + 8 = 83；新增 2 + 1 + 12 = 15。

### 1.3 lockfile

```powershell
pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only
```

`EXIT=0`，lockfile hash 未变化；`packages/graph/flow-canvas` importer 已被 lockfile 收录，依赖/peer 与 package.json 一致。

### 1.4 demo

```powershell
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

PowerShell 下可直接执行，`EXIT=0`。输出为真实 YAML Loader 装载 `examples/demo.flow.yaml` 后的静态 JSON + 一次运行的状态流，关键行：

```text
status gate: completed (...)
status normal: skipped (skip=upstream-condition)
status recover: completed (...)
status fatal: failed (error=NODE_FAILED ...)
status join: skipped (skip=upstream-failure)
```

静态 JSON 中还出现了 `"kind": "port"`、6 个 `"layout": null` 和顶层空 `layout`，符合 README 的描述。README 命令没有 Windows 特殊写法问题。

---

## 2. 静态投影：真能画吗？

### 2.1 独立探针

构造的 flow 包含：带 `version`/`retry`/`timeout`/`input`/`label` 的节点、命名端口 + predicate 的边、纯 predicate 边、普通边、errorBranch 默认边、fallback 节点、input schema。

关键输出（节选）：

```text
S_STATIC {
  schemaVersion:1, flowId:"canvas-static", hasInputSchema:true,
  output:{result:"${a.out}"}, meta:{nodeCount:3,edgeCount:4},
  nodeA:{
    id:"a", type:"echo", version:2,
    display:{label:"Alpha",subtitle:"echo@2"},
    config:{label:"Alpha",nested:{n:1},list:[1,"two",null]},
    input:{v:"${seed.value}",literal:42},
    onError:"failFast", retry:{tries:2,backoffMs:5}, timeout:1500,
    layout:null
  },
  conditions:{
    "a:error->b":{kind:"port",port:"error",hasPredicate:true,summary:"port \"error\" (predicate ignored)"},
    "a:out->c":{kind:"predicate",hasPredicate:true,summary:"declared predicate"},
    "a:out->c~1":{kind:"always",hasPredicate:false,summary:"always"},
    "b:out->c":{kind:"error-branch-default",hasPredicate:false,summary:"default output (closed when the error port is active)"}
  },
  layout:{viewport:null,nodes:{},edges:{}},
  nodeLayouts:[null,null,null], edgeLayouts:[null,null,null,null],
  stringHasFunction:false, roundTripEqual:true
}
```

另外：

```text
S_ERRORS {"nonSerializable":"CANVAS_NOT_SERIALIZABLE","circularCode":"CANVAS_NOT_SERIALIZABLE"}
```

### 2.2 判断

- **JSON 安全**：`JSON.stringify` 后没有函数；`JSON.parse(JSON.stringify())` 与原文逐字相等。谓词函数只留下 `kind:'predicate'`/`hasPredicate`，不进投影。
- **条件边可画**：port、predicate、always、errorBranch 默认边四种都能区分；port 上额外声明 predicate 时标记 `hasPredicate:true` 并提示 predicate 被忽略。
- **布局**：`canvas.layout` 是 `{viewport:null,nodes:{},edges:{}}`，每个 node/edge `layout:null`；执行一次 run 后再 `project()` 仍为空，`engine.getFlow()` 的 definition 键只有 `edges/id/nodes`，内核没有塞任何布局。
- **节点元数据**：`id/type/version/display/config/input/onError/fallbackValue/retry/timeout` 都在；`config.label` 被用于展示标签，`type@version` 做副标题。
- **序列化失败**：函数配置和循环引用都抛 `CANVAS_NOT_SERIALIZABLE`，不是被 JSON.stringify 静默丢弃。

结论：**静态投影足够画一张带条件边和空布局槽位的图。** 唯一要提醒的是：条件模型是单值 `kind`，`errorBranch 默认边 + predicate` 这种组合会只报 `predicate`，见 §7。

---

## 3. 运行投影：状态板够不够？

### 3.1 状态流（一张图覆盖 completed / failed / 两种 skipped）

探针 flow：`ok`（echo）、`bad`（80ms 后失败的 slowFail）、`down`（bad 下游）、`drop`（ok 边 `when:false`）、`keep`（ok 边 `when:true`）。

```text
R_STATUS {
  status:"failed", resultSameObject:true,
  streams:{
    ok:["pending","ready","running","completed"],
    bad:["pending","ready","running","failed"],
    down:["pending","skipped"],
    drop:["pending","skipped"],
    keep:["pending","ready","running","completed"]
  },
  pendingCount:5,
  finalNodes:{
    bad:{status:"failed",error:{code:"NODE_FAILED",...},startedAt,endAt},
    down:{status:"skipped",skipReason:"upstream-failure"},
    drop:{status:"skipped",skipReason:"upstream-condition"},
    keep:{status:"completed",...}
  }
}
```

- `pending/ready/running` 没有丢；失败节点有 `error` 和起止时间；两种 skip reason 都出现。
- `finished.result === handle.awaitCompletion()` 为 **true**（同一对象），`finished.nodes` 从 result 重建。
- 取消探针：

```text
C_CANCEL { status:"cancelled",
 streams:{hold:["pending","ready","running","cancelled"], never:["pending","cancelled"]},
 failedSeen:false }
```

### 3.2 晚订阅

```text
L_LATE {
  immediateStatus:"completed",
  immediateNodes:{a:{id:"a",status:"pending"}},
  finalStatus:"completed",
  finalResultSameObject:true,
  finalNodes:{a:{id:"a",status:"completed",...}}
}
```

- `await projection.finished` 能拿到最终态，且 `result` 是同一个 `FlowRunResult`；这点成立。
- **但** `watch()` 之后立刻 `snapshot()`，会出现 `status:'completed'`、节点仍 `pending` 的瞬时不一致，直到 `finished` 的 microtask 跑完。README 的契约说最终快照看 `finished`，所以不是完全未记录；但对一个“晚挂载后先渲染 snapshot”的画布实现者，这是实际坑。

### 3.3 dispose / 监听器

```text
D_DISPOSE {
  baseline:{status:0,end:0,graph:1},
  during:{status:1,end:1,graph:1},
  afterDispose:{status:0,end:0,graph:1},
  afterFinish:{status:0,end:0},
  runStatus:"completed"
}
```

- `dispose()` 两次都幂等；`flow/node-status` 和 `flow/run-end` 监听器都被移除；`graph/node-status` 计数始终不变（canvas 不碰内核事件）。
- dispose 不取消运行：`runStatus` 最终仍为 `completed`。
- run 结束自动清理也成立（`afterFinish` 两个计数为 0）。

---

## 4. 事件面隔离

独立探针同时订阅内核与 flow 事件：

```text
E_EVENTS {
  graphKeys:["endedAt","error","graphId","nodeId","runId","skipReason","startedAt","status"],
  flowKeys:["endedAt","error","flowId","nodeId","runId","skipReason","startedAt","status"],
  graphHasFlowId:false, flowHasGraphId:false
}
```

- `graph/node-status` 顶层只有中性字段，没有 `flowId`、没有 UI/layout 字段。
- `flow/node-status` 带 `flowId`，没有 `graphId`；`error` 在 flow 层被收缩成 `{code,message}`（源码 `flow-engine/src/service.ts:76-87`）。
- Canvas 监听器计数：`graph/node-status` 在 `run()` 前后不变，`flow/node-status` +1、`flow/run-end` +1；源码里 canvas 只写 `ctx.on('flow/node-status')` 与 `ctx.on('flow/run-end')`（`watch.ts:58-76`）。
- 内核初始 pending 会先广播（`scheduler.ts:115-118`），因此状态板不需要轮询。

结论：**事件面分层干净，canvas 没有直接碰内核事件。**

---

## 5. 规范与包结构

### 5.1 flow-canvas 本体

| 检查项 | 结果 |
|---|---|
| 源文件数 | **5**：`index.ts` / `project.ts` / `service.ts` / `watch.ts` / `types.ts`，≤5 |
| LF 行数 | index 38、project 186、service 71、watch 118、types 194；最大 **194**，全部 <300 |
| README 三件套 | `README.md` + `README.cn.md` + `README.i18n.yaml` 都在；另有 MIT LICENSE |
| README.i18n | 26 行，可 YAML 解析；含 `readme.en/zh`、4 条 en/zh `how-to-use`、`naming`、`reviewed` |
| 英文 description | 有，明确 “Use when …; skip it when …”，同时说明什么时候不用 |
| 前端/浏览器依赖 | package.json 无 React/浏览器依赖；源码无 `window/document/react` 实际引用（只有注释/类型） |
| 产物 | `main/types` 指向 `lib/`；`files: ["lib"]`；`exports` 含 `.` 与 `./types` |
| 与内核/引擎隔离 | 源码只依赖 flow-api/flow-engine/graph-core 类型与 cordis；无 `ctx.slots`、无 UI 概念 |

### 5.2 内核与引擎是否被塞 UI/布局

- `graph-core/src` 与 `flow-engine/src` 中搜索 `layout|canvas|browser|react|window|document` 无实际代码命中。
- `graph/node-status` 只增加中性状态字段；`flow/node-status` 只加 `flowId` 并收缩 error。
- `flow-engine` 新增 `getFlow(flowId)`，这是画布投影读取 definition 的最小接缝，不是 UI 概念。

### 5.3 一个交付遗漏

`packages/graph/bundle` 的 `package.json`、`cordis.patch.yml`、`tarballs/` **没有 flow-canvas**：

- bundle 依赖列表仍是 core/flow-api/flow-engine/node-tool/storage/yaml/tools + `@veren/*`；
- 没有 `deepseek-ai-dsh-graph-flow-canvas-0.1.0.tgz`；
- 如果 bundle 的“整个 graph 插件族”承诺包含 canvas，这是遗漏；如果 canvas 被有意定位为“上层数据源、不随 Host bundle 安装”，README 应明确写出来。当前没有写。

这不影响单独安装 flow-canvas 或数据面正确性，但影响“整族交付”的一致性。

---

## 6. 测试质量：有没有放松？

新测试整体是偏严的，不是把断言写绿：

- `project.spec.ts` 6 个用例：JSON 往返、四种条件、errorBranch 默认边、重复边 id、非 JSON 失败、悬挂边失败。
- `watch.spec.ts` 5 个用例：按节点精确状态数组、两种 skip、取消、run-end 清理 listener 数、dispose 幂等且不取消。
- `demo.spec.ts` 1 个用例：真实 YAML Loader + 静态 JSON + 状态流 + final result 同一对象。

但覆盖有洞，且我们用自己的探针补了：

1. **晚订阅没有正式测试**：`watch.spec.ts` 没有“跑完再 watch”的用例；我们的 L 探针发现 `finished` 正确，但立即 snapshot 瞬时不一致。
2. **事件中性没有正式测试**：`watch.spec.ts` 没有断言 `graph/node-status` 无 `flowId`、`flow/node-status` 有 `flowId`；我们的 E 探针补了。
3. **canvas 只消费 flow 事件没有正式测试**：`watch.spec.ts` 的 listener 计数只数了 `flow/node-status` 与 `flow/run-end`，没有显式断言 `graph/node-status` 不变；我们的 D/E 探针补了。
4. **布局“内核不填”没有正式测试**：`project.spec.ts` 只检查 `projectFlow` 初始 layout 为空；没有 run 后再 project 的断言；我们的 LAYOUT 探针补了。
5. **hasInputSchema=true 没有正式测试**：`project.spec.ts` 只断言 false；我们的 S 探针用 input schema 得到 true。
6. **dispose 只数了 flow/node-status**：`watch.spec.ts` 没有数 `flow/run-end`；我们的 D 探针两个都数了。
7. **edge condition 组合**：`error-branch-default + predicate` 没有测试；当前实现会报 `predicate` 而不是 `error-branch-default`，见 §7。
8. `flow-canvas` 的 e2e 配置是空套件（`passWithNoTests`），没有真实浏览器/UI e2e；本包本来不做 UI，空套件可以接受，但不能算渲染验证。

没有发现“旧测试被放松”的证据；98 spec 中旧 83 个计数保留，新增 15 个（status 2 + engine 1 + canvas 12）。

---

## 7. 一个画布实现者会遇到的缺口

### 7.1 设计明确不做，不算缺陷

- **UI / 渲染器 / 自动布局 / 布局持久化**：README 与源码都明确 layout 由调用方持有，本包只产出 `layout:null` 和空容器。
- **谓词求值**：谓词函数只被标记，不进 JSON；本包不做表达式语言。
- **运行中途晚挂载的事件回放**：README 契约明确 `watch(handle)` 要尽快，不缓存 attach 前事件；需要启动即订阅就用 `run()`。

### 7.2 数据面确实没覆盖（按真实实现者视角）

1. **边上的执行历史没有。**
   静态投影只有边的条件；运行时只有节点状态。没有 `flow/edge-status`，也没有 `snapshot.edges`。
   简单图可以用“下游 skipped + port”推断，但多入边 join、条件边、errorBranch 默认边同时存在时，画布无法准确知道某次运行到底走了哪条边。这不在 README 的非目标里，属于未设计的缺口。

2. **运行中节点的入参/出参拿不到。**
   `CanvasNodeRuntime` 只有 `status/skipReason/error/startedAt/endedAt`；`flow/node-status` 也没有 input/output。最终 `result.nodes` 有 output，但没有 input。节点检查器/调试画布只能等运行结束看 output，看不到运行中的 payload。

3. **节点分组 / 子图没有表示。**
   `FlowDefinition` 和 `CanvasNode` 都是平铺的；`subflow` 节点只有 `type:'subflow'` + `config.flow`，没有 group/parent/child 元数据。实现者可以自己从 `config.flow` 递归 `project(childFlowId)`，但数据面没有“子图引用/分组”模型。这不是明确非目标，更像一期没做。

4. **多次运行只有 per-run 全量快照，没有增量 patch。**
   `watch()`/`run()` 只返回一次 run 的 projection；没有 `listRuns`/`getRun` 的画布面，也没有跨 run 的 diff/patch。一个画布要显示“同一 flow 的多次运行”必须自己管理多个 handle。当前 `FlowEngine` 有 `listRuns/getRun`，canvas 没接。

5. **retry 次数 / 尝试序号不可见。**
   节点状态只有 `running`，没有 `attempt`；重试图层无法显示“第 2 次尝试”。`flow/node-status` 也没有 attempt。这不在 README 的非目标里。

6. **run 级时间戳没有进快照。**
   `CanvasRunSnapshot` 没有 run 的 `startedAt/endedAt`；`FlowRunResult` 也没有。画布做运行时间线时需要另找引擎 entry。

7. **输入 schema 只有布尔。**
   `hasInputSchema` 只告诉有没有，schema 本身是函数，不能进 JSON；画布无法根据 schema 渲染表单。需要上层另拿定义或节点 schema。

8. **errorBranch 的“失败但已恢复”不可见。**
   engine 仍把 errorBranch 失败节点记 `completed`、无 `error`，error 只写在输出 slot（`gate.output.error`）。画布只能把 gate 画成成功节点；如果要在节点上标红“失败已兜底”，数据面没有这个事实。

9. **条件组合丢失。**
   `CanvasEdgeCondition.kind` 是单值。`errorBranch` 默认边同时带 predicate 时，实现返回 `predicate`，不会同时表达“error 端口激活时关闭”；port 边 + predicate 则只有 `hasPredicate` 标记。大多数情况够用，但复杂条件边会失真。

10. **运行结束后的即时快照有瞬时 pending。**
    晚订阅 `watch()` 立即 `snapshot()` 会出现 `status:'completed'` + 节点 `pending`；`await finished` 后一致。对“先渲染 snapshot、再订 finished”的画布，会闪一下 pending。建议要么 seeded snapshot 在 completed 时直接用 result，要么在 API/README 里强制“晚订阅先 await finished”。

### 7.3 够用程度

- **画静态图**：够用。节点、边、条件、端口、retry/timeout/input、空布局槽位都有，JSON 安全。
- **做运行状态板**：够用。状态流完整，skip/error/时间、最终 result、dispose/cleanup 都可靠。
- **做生产级运行态调试画布**：不够。边历史、实时节点 I/O、分组/子图、多运行 patch、retry attempt 都缺；这些是数据面扩展，不是 canvas 本包渲染问题。

---

## 8. 总评

**现在敢把 flow-canvas 当“静态图 + 节点状态板”的数据源地基；不敢把它当完整运行态调试画布的地基。**

静态投影和事件隔离做得干净，运行状态流、最终快照同一对象、listener 清理、8 包 build、98 spec、demo 都实测通过。真正限制一个画布实现者的是数据面没覆盖的边历史、运行中节点 I/O、分组/子图、多运行 patch；另外 bundle 未包含 canvas、晚订阅即时 snapshot 的瞬时 pending 是需要收口的点。这些都是可扩展的边界，不是当前静态图/状态板能力的失败。
