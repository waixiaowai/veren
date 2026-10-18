# flow-canvas 第二轮画布数据面复核（定向收口）

- 复核对象：`packages/graph/flow-canvas`、`flow-engine` 的 `recovered` 记录、`project.ts` 的 `closedByErrorPort`、`bundle` 的 canvas 行/tarball。
- 复核方式：只读源码/测试；独立探针在仓库外验证晚订阅、兜底可观测、条件边、bundle 安装；复跑 build/spec/e2e/demo。探针与日志已清理。
- 不碰前四份报告：`graph-acceptance-review*.md`、`graph-canvas-review.md` 均未修改。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。

---

## 0. 结论速览

| # | 收口点 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | 晚订阅一致性 | **部分通过** | 跑完再 `watch()` 的 immediate/finished/final 三者一致，result 同一对象；**但运行中途挂载**（已有节点 completed）仍把所有节点播种为 pending，已完成的 `a` 要等 `finished` 才变 completed，期间没有它的 change 回调。 |
| 2 | errorBranch 兜底可观测 | **通过** | `FlowRunResult.nodes.gate.recovered`、`flow/node-status` 的 completed 事件、canvas 的 change/final 三处都有 `{code:'NODE_FAILED',message:'node failed'}`；节点仍 completed，下游继续，error 端口行为不变，顶层 `result.error` 值为 undefined。 |
| 3 | errorBranch 默认边 + predicate | **通过** | JSON 往返后仍是 `kind:'error-branch-default'`、`hasPredicate:true`、`closedByErrorPort:true`；普通 predicate / port / always 三种各自保持 `closedByErrorPort:false`。 |
| 4 | bundle 包含 canvas | **通过（有 peer 前提）** | 10 个 `file:` 依赖、8 个 patch 行、canvas tarball 存在；tarball 可在仓库外安装；只装 canvas 时 root import 因缺 graph peer 失败，补装 bundle 里的 graph-core/flow-api/flow-engine 三个 peer tarball 后 root import 和 `projectFlow` 都成功。bundle README 的“只读投影、无 UI/布局”与事实一致。 |
| 5 | 回归 | **通过** | 8 包 build exit 0；递归 test exit 0，**102 spec**；旧 98 个 spec 计数原样保留；e2e 全 exit 0；demo 在 PowerShell 下照 README 可跑，并显示 `gate: completed (recovered=NODE_FAILED...)`。 |

**总评一句话：可以开工画“只读静态图 + 节点状态板”；还不能说“任意时刻挂到运行中 run 上的完整画布”已经够用——mid-run late watch 仍会 pending 到 finished。**

---

## 1. 复跑记录

### 1.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

8 个包 `tsc` 全部通过，`EXIT=0`（含 flow-canvas）。

### 1.2 递归 spec

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，**102 spec**：

| 包 | 通过数 |
|---|---:|
| flow-api | 6 |
| graph-core | 18 |
| flow-engine | 35 |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas | **16（project 7 / watch 7 / demo 1 / bundle 1）** |
| **合计** | **102** |

旧 98 的计数没有减少：flow-canvas 由 12 → 16（新增 project errorBranch+predicate、watch late、watch recovered、bundle 4 个），其余包计数不变。

### 1.3 e2e

| 包 | 结果 |
|---|---|
| flow-storage | 1 passed |
| node-tool | 1 passed |
| tools | 4 passed |
| graph-core / flow-engine / flow-yaml / flow-canvas | `No test files found, exiting with code 0`（`passWithNoTests` 空套件） |

全部 exit 0。

### 1.4 demo

```powershell
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

PowerShell 下 `EXIT=0`。输出包含 `apply` 的 port 条件边、6 个 `layout:null`、空 layout，以及：

```text
status gate: completed (recovered=NODE_FAILED ...)
status normal: skipped (skip=upstream-condition)
status recover: completed ...
status fatal: failed (error=NODE_FAILED ...)
status join: skipped (skip=upstream-failure)
```

`recovered` 已能在 demo 的状态行里看到；README 命令可直接复制运行。

---

## 2. 晚订阅一致性（重点 1）

### 2.1 跑完再 watch：通过

独立探针 `P1_LATE`：

```text
immediateStatus: "completed"
immediateNodes: { a: { status:"completed", startedAt, endedAt } }
immediateResultSame: true
atFinishedStatus: "completed"
atFinishedNodes: { a: { status:"completed", ... } }
atFinishedResultSame: true
finalStatus: "completed"
finalNodes: { a: { status:"completed", ... } }
finalResultSame: true
sameImmediateFinal: true
```

- `watch()` 返回后立即 `snapshot()`、`finished` 回调里再取、`finished` 之后的 `snapshot()`，三者状态/节点/result 一致。
- `result` 与 `handle.awaitCompletion()` 是**同一个对象**（不是 deep equal）。
- 这是本轮修复的直接效果：`watch.ts:39-42` 在 attach 时先读 `engine.getRun(handle.runId).result`，同步 `applyResult`，不再出现“completed + nodes pending”。

### 2.2 运行中从开始 watch：单调，通过

`P1_MONOTONIC`（两个独立慢节点，从 run 开始就订阅）：

```text
streams:{
  a:["pending","ready","running","completed"],
  b:["pending","ready","running","completed"]
}
monotonic:true
finalStatus:"completed"
```

change 回调没有终态→待定倒退；snapshot 最终与 final 一致。

### 2.3 运行中途挂载：仍不准确（缺口）

`P1_MID_WATCH`：先启动 `a`（60ms）+ `b`（150ms），等 `a` 已 completed，再 `canvas.watch(handle)`：

```text
immediateStatus:"running"
immediateNodes:{ a:{status:"pending"}, b:{status:"pending"} }
futureChanges:{ b:["completed"] }        // a 没有 change
monotonic:true
finalNodes:{ a:{status:"completed"}, b:{status:"completed"} }
finalStatus:"completed"
```

- 新 attach 的 projection 把**所有节点**播种为 `pending`（`watch.ts:28-38`），不缓存/回放 attach 前的事件；已经 completed 的 `a` 在 immediate snapshot 里仍是 pending，且 future change 里没有 `a`，只能等 `finished` 的 `applyResult`。
- 这不是同一 projection 内的“终态→待定”change 倒退（future changes 是单调的），但对“运行中途才打开面板”的 UI 来说，快照会短暂错误，直到 run 结束。
- README 的契约明确“watch 必须尽快调用；不缓存 attach 前事件”，所以这是**已声明的限制**，不是本轮新回归；但如果要求“任意时刻 watch 都立刻得到准确 snapshot”，它还没有收口。

**结论：after-finish 的 late watch 修好了；mid-run late attach 仍有 stale pending。UI 应使用 `run()` 或尽早 `watch()`；若 UI 需要在运行中途挂载，需要额外的 hydration/重放层。**

---

## 3. 兜底可观测（重点 2）

独立探针 flow：`gate`（fail + errorBranch）→ `recover`（error 端口）→ `tail`；`gate` 默认边 → `normal`。

```text
P2_RECOVERED {
  status:"completed",
  topLevelHasError:true, topLevelError:undefined,
  gate:{
    status:"completed",
    output:{ error:{code:"NODE_FAILED",message:"node failed"} },
    recovered:{code:"NODE_FAILED",message:"node failed"},
    error:undefined
  },
  recover:{status:"completed", output:{...}},
  normal:{status:"skipped", skipReason:"upstream-condition"},
  tail:{status:"completed"},
  finalGate:{status:"completed", recovered:{code:"NODE_FAILED",message:"node failed"}, ...},
  flowGateCompleted:[{status:"completed", recovered:{...}}],
  canvasGateCompleted:[{status:"completed", recovered:{...}}],
  canvasFinalGate:{status:"completed", recovered:{...}}
}
```

逐点核对：

- `FlowRunResult.nodes.gate.recovered`：有，值稳定；`error` 值为 undefined。
- `flow/node-status` 的 gate completed 事件：带 `recovered`；没有把 gate 变成 failed。
- canvas 的 change 回调：gate completed change 带 `recovered`。
- canvas 的 final snapshot：gate `recovered` 存在。
- 验收 #8 原语义：
  - gate 仍 `completed`；
  - `recover` 经 error 端口 completed；
  - `normal` 默认边 `skipped/upstream-condition`；
  - `tail` 在 recover 后 completed，下游继续；
  - 顶层 `FlowRunResult.error` 未被 recovered 污染——值是 `undefined`。
- **一个 API 小坑**：`FlowRunResult` 的 mapper 保留了 `error: undefined` own property，所以 `'error' in result` 为 true；JSON 会省略。UI 应判断 `result.error !== undefined`，不要用 `in`。这不是 recovered 值污染，但容易被误读。

结论：**三处都能读到失败事实，且 #8 原语义没有变。**

---

## 4. errorBranch 默认边 + predicate（重点 3）

`P3_CONDITION`：

```text
gate:out->target => {
  kind:"error-branch-default",
  hasPredicate:true,
  closedByErrorPort:true,
  summary:"default output (closed when the error port is active) with declared predicate"
}
a:out->b        => {kind:"predicate", hasPredicate:true, closedByErrorPort:false, ...}
a:error->b      => {kind:"port", port:"error", hasPredicate:false, closedByErrorPort:false, ...}
a:out->b~1      => {kind:"always", hasPredicate:false, closedByErrorPort:false, ...}
roundTripEqual:true
stringHasFunction:false
```

- errorBranch 默认边 + predicate 在 JSON 往返后仍是 `error-branch-default`、`hasPredicate:true`、`closedByErrorPort:true`。
- 普通 predicate、port、always 没有被这次改动带歪；`closedByErrorPort` 都是 false。
- 代码路径：`project.ts:130-158` 先判 port，再判 errorBranch 默认边（优先于 predicate），最后才是 predicate/always。
- 这一条通过；注意这是**静态语义描述**，运行期仍由 flow 引擎按 error 端口/谓词顺序求值。

---

## 5. bundle 包含 canvas（重点 4）

### 5.1 清单事实

```text
bundle dependencies: 10 个 file: 依赖
bundle patch rows:   8 个 insert 行
canvas tarball:      deepseek-ai-dsh-graph-flow-canvas-0.1.0.tgz 存在（22,842 bytes）
bundle README:       “read-only projection service ... no renderer, no layout algorithm, no persisted coordinates”
```

`bundle/package.json` 的 10 个依赖包括 canvas；`cordis.patch.yml` 的 8 行包括 `graph-flow-canvas`；README 的说法与源码一致（canvas 只读投影，不做 UI/布局）。

### 5.2 真实安装/import

在仓库外临时目录执行：

```text
npm install deepseek-ai-dsh-graph-flow-canvas-0.1.0.tgz \
  --ignore-scripts --no-audit --no-fund --legacy-peer-deps
→ added 6 packages, exit 0

# 只装 canvas 时 root import：
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-graph-flow-engine'
```

这符合 canvas 的 peer 契约：canvas 的 root entry 需要 graph-engine/core/api。补装 bundle 里对应的三个 graph peer tarball：

```text
npm install graph-core.tgz flow-api.tgz flow-engine.tgz ...
→ added 3 packages, exit 0

import('@deepseek-ai/dsh-graph-flow-canvas') 成功
projectFlow({...}) => {flowId:"x", nodes:1, layout:{viewport:null,nodes:{},edges:{}}}
```

- canvas tarball 真实存在、可安装；tarball 的 `lib/watch.js` 含 late `getRun` 修复，`lib/project.js` 含 `closedByErrorPort`，说明 tarball 不是旧构建。
- 单独安装 canvas 后 root import 不是自包含的；需要其声明的 graph peer，bundle 正是携带这些 peer 的组合件。README 也明确“bundle 以目录安装，不按 tarball 安装”，所以这不是 bundle 的缺陷，但“拿 canvas tarball 单独 import”不能算自包含通过。

结论：**bundle 的 canvas 行/tarball 不是只写在清单里；实际安装和 import 能跑。**

---

## 6. 回归（重点 5）

### 6.1 事实

- 8 包 build：exit 0。
- 递归 spec：exit 0，**102**；旧 98 计数保留（canvas 12→16，其他包不变）。
- e2e：flow-storage 1 / node-tool 1 / tools 4 通过；graph-core/flow-engine/flow-yaml/flow-canvas 空套件 exit 0。
- demo：PowerShell 下 exit 0，显示 port 边、layout 空、`gate: completed (recovered=NODE_FAILED)`、`normal skipped`、`fatal failed`、`join skipped`。

### 6.2 断言有没有放松

- #8 原 engine 测试仍在：`engine.spec.ts` 的 errorBranch 用例仍断言 `status completed`、`recover completed`、`normal skipped/upstream-condition`；只新增 recovered，不改变旧断言。
- `watch.spec.ts` 新增 late watch 用例，断言 immediate status/result/nodes 与 result 一致；但只断言 `toEqual`，没有断言 `result` 同一对象（我们的 P1 探针补了 `===`，为 true）。
- `watch.spec.ts` 新增 recovered 用例，断言 final gate recovered、result gate recovered、change gate recovered；未断言顶层 `result.error` 未污染（我们的 P2 补了，值为 undefined）。
- `project.spec.ts` 新增 errorBranch+predicate 用例，断言 kind/hasPredicate/closedByErrorPort 和 JSON 往返；普通 `always` 用精确对象断言 `closedByErrorPort:false`，普通 predicate/port 的 `closedByErrorPort:false` 由我们的 P3 探针补证。
- `bundle.spec.ts` 只检查 manifest 的 file 依赖、patch 文本、tarball 存在；**不实际安装/import**。我们的临时安装补了这个缺口。
- 没有发现“为了变绿而放松”的断言；但 **mid-run late watch** 没有测试，是当前最明显的覆盖缺口。

### 6.3 仍存在的缺口

1. **运行中途挂载**：如上，snapshot 先把所有节点 pending；已完成的节点没有回放，要等 finished。README 的“watch promptly”是明确契约，但 UI 若允许中途打开面板，需要 hydration。
2. **bundle.spec 只验证清单**：真实 tarball 安装/import 没有进入测试；本轮我们手工补了。建议把“安装 + import”做成可重复的 smoke test。
3. **顶层 error own property**：`result.error` 值为 undefined，但 `'error' in result` 为 true；UI 不要用 `in` 判断失败。这是既有 mapper 行为，不是 recovered 引入的。
4. 旧的 canvas 数据面缺口仍在（不属于本轮四点）：边执行历史、运行中节点 I/O、分组/子图、多运行 patch、retry attempt、输入 schema 细节。

---

## 7. UI 层明确不做 / 由 UI 负责的清单

- **布局**：坐标、自动布局、缩放、节点尺寸、边 waypoints、布局持久化——全部由 UI/调用方负责；数据面只给 `layout:null` 和空容器。
- **渲染与交互**：节点/边组件、主题、多语言、选择、拖拽、右键菜单、画布缩放——UI 层。
- **运行中挂载策略**：优先用 `canvas.run()` 或 run 开始后立即 `watch()`；若面板可能在运行中途打开，需要 UI 自己做 hydration（拉当前 result/重放），不能假设 projection 会回放 attach 前事件。
- **边历史/节点 I/O**：当前数据面只有节点状态；边激活历史、运行中 input/output 不在里面，UI 需要隐藏这些面板或由后续数据层补。
- **分组/子图**：`subflow` 只有 `type:'subflow'` + `config.flow`；UI 可自行递归 `project(childFlowId)`，但数据面没有 group/parent 模型。
- **多运行对比/patch**：UI 自己管理多个 handle/历史；没有跨 run 的增量 patch。
- **表达式求值**：谓词只显示为“声明了谓词”，UI 不要求值/不解析表达式。
- **input schema**：`hasInputSchema` 只是布尔；UI 若要表单，需要从 flow definition 或节点 schema 另取。

---

## 8. 最后一句

**现在可以开工画“只读静态图 + 节点状态板”，但还不能说“任意时刻挂到运行中 run 上的完整画布”已经够用。**

具体地：跑完再 watch 的一致性、recovered 三面、errorBranch+predicate 条件、bundle canvas 安装、102 spec/build/e2e/demo 都实测通过；唯一没完全收口的是 **运行中途 attach**——已完成的节点会先以 pending 出现在新 snapshot，直到 finished 才补齐。UI 只要遵守 `run()`/尽早 watch 的契约，可以开工；若 UI 需要中途挂载或做完整调试画布，还需要补 hydration/边历史/节点 I/O 这几层。
