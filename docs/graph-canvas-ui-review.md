# flow-canvas-ui 第一版验收（真打开、真点运行、真看懂）

- 对象：`packages/graph/flow-canvas-ui`，声称跑在 `http://127.0.0.1:4780/`，不碰 3080、不写 profile。
- 方式：先在 4780 找到旧进程并确认不是自己起的 → 杀掉 → 重新 build → 自己启动 → 无头 Chrome/CDP 真点运行 + HTTP/SSE 侧证 + 交付截图人工看 + 静态契约检查。
- 边界：只读复核，没有改 UI 源码/测试；临时探针、日志、Chrome、4780 服务已清理；3080 进程未动；前六份报告未改。

---

## 0. 结论速览

| 项 | 结论 | 关键证据 |
|---|---|---|
| 真打开 | **通过** | 4780 上原有一个 `node lib/server.js` 旧进程（PID 33272，20:45 启动）；杀掉后重新 build/启动自己的 PID 32312，stdout 打印 `http://127.0.0.1:4780/`；页面返回真实 DOM，不是静态占位。 |
| 真点运行 / SSE | **通过** | paced flow 点 Run 后无刷新（`window.__reviewMarker='alive'` 保留）；浏览器看到 1 个 `tone-running`，summary `运行中 · 1/6 已落定`；SSE 有 `state/node/finished`，最终 20 条 status 行，无 JS 异常。 |
| 真看懂：静态图/三色边 | **通过** | 6 nodes / 5 edges；`tone-port`、`tone-predicate`（predicate flow）、`tone-error-branch-default` 三类边均存在，标注 `port: error` / `predicate` / `default closes on error`。 |
| 真看懂：失败/兜底/跳过 | **通过** | fatal 红 + `NODE_FAILED: demo fatal failure`；gate 是 `tone-recovered` + `completed · recovered` + `recovered NODE_FAILED`；normal/join 是 `tone-skipped` + `skip: upstream-condition` / `upstream-failure`。 |
| 摘要数字 | **通过** | 最终 summary 精确为 `3 completed (1 recovered) · 1 failed · 2 skipped`；逐节点数：start/gate/recover completed，fatal failed，normal/join skipped，正好 3/1/2，gate 是 1 recovered。 |
| output 来源 | **通过** | 点 gate：inspector 显示 `{"error":{"code":"NODE_FAILED","message":"demo recoverable failure"}}`，来源文字 `source: snapshot.result.nodes["gate"].output`；fatal/normal 明确说“没有 output 键”，没有编造。 |
| 只读 | **通过（代码 + frozen 探针）** | 静态 grep 没有对 `snapshot.nodes/result` 的赋值，只有 `state.snapshot = message.snapshot` 的指针替换；把 snapshot/result 深冻结后 `withLiveChanges` 返回新 snapshot、原对象不变，`nodeOutput` 仍可读。 |
| 服务端事件边界 | **基本通过（措辞要收窄）** | UI `src` 没有 `flow/node-status` / `graph/node-status` / `flow/run-*` 的直接订阅；状态走 canvas projection。但服务端在 setup/listing 用了 `engine.hasFlow/listFlows/getFlow/registerFlow`，不是字面上“只用 canvas API”。 |
| 截图 30 秒 | **run-final 通过；run-predicate 只是 idle 条件图** | `run-final.png` 30 秒内能答失败/兜底/跳过；`run-predicate.png` 是 `尚未运行`，能看 predicate 颜色但不能回答“哪里失败/兜底/跳过”。 |
| 3080 / profile | **通过** | 3080 仍是 PID 16080（16:00 启动），UI 只监听 4780；UI 没有 DSH profile 写入；README 的 3080 三步所用 `FlowCanvasToken`、`HostObservable`、`ctx.slots`、`ctx.locale`、`ctx.remote` 在 DSH 代码中都存在。 |
| 回归 | **通过** | 9 包 build exit 0；递归 test exit 0，**129 spec**（旧 104 + UI 25）；`flow-canvas` demo 在 PowerShell 下 exit 0。 |
| 包规范 | **不通过** | `src/*.ts` 有 **10 个**（规范 ≤5）；`public/styles.css` **546 行**（单文件 ≤300）；README 三件套/英文 description/无前端依赖污染三项通过；没有 LICENSE 文件（README 只写 MIT）。 |

**总评：页面功能上已经可以给人看；按包规范还不能直接交付。** 最小必须补的是把源文件数/单文件行数收到规范内（或明确申请例外），不是页面功能。

---

## 1. 4780 进程：先确认旧进程，再自己起

检查时 4780 已有监听：

```text
PID 33272
node.exe packages/graph/flow-canvas-ui/lib/server.js
CreationDate 2026/10/17 20:45:05
```

这不是本轮起的进程，不能拿它当新代码证据。处理：

1. 只停 4780 的 PID 33272（未动 3080）；
2. `pnpm -r --filter "./packages/graph/*" build`（9 包，含 UI，exit 0）；
3. 自己启动 `node packages/graph/flow-canvas-ui/lib/server.js`，PID 32312，stdout：

```text
[flow-canvas-ui] http://127.0.0.1:4780/
```

之后所有页面/HTTP 证据都来自 PID 32312，最后已停止。3080 始终是原 PID 16080。

---

## 2. 真打开：静态图、节点、边、条件标注

无头 Chrome（CDP）打开 `http://127.0.0.1:4780/`，真实 DOM：

```text
title: Flow Canvas · flow-canvas-ui
summary: 尚未运行 · Run has not started

nodes: start, gate, recover, normal, fatal, join   (6)
edges: start→gate, gate→recover, gate→normal, recover→fatal, fatal→join (5)
```

边类名/标注：

```text
start → gate      edge tone-always
gate → recover    edge tone-port               label: port: error
gate → normal     edge tone-error-branch-default dashed
                                                label: default / closes on error
recover → fatal   edge tone-always
fatal → join      edge tone-always
```

切到 `canvas-demo-predicate` 后：

```text
recover → fatal   edge tone-predicate
                  label: predicate
```

三色边不是只存在于 README：DOM 里确实是 `tone-port`、`tone-predicate`、`tone-error-branch-default dashed`，并且标签可见。默认图没有 predicate 是正常的，predicate 入口专门提供第三色。

图例包含 7 个状态 + 4 个边条件（共 11 项）。它偏重，但节点卡自身已带 `completed/failed/skipped/recovered` 文字和 `skip:`/`NODE_FAILED` 细节，所以图例不是看懂失败/兜底的必需品；只是查颜色时有用。

---

## 3. 真点运行：SSE、running、无刷新

浏览器切到 `canvas-demo-pacing`，点 Run，先设置：

```js
window.__reviewMarker = 'alive'
```

运行中（paced fail 节点有 3×240ms retry，所以 running 真可见）：

```text
marker: "alive"
running nodes: 1
summary: 运行中 · 1/6 已落定
         1 completed · 0 failed · 0 skipped · 1 running · 4 waiting
statuses:
  start    tone-completed
  gate     tone-running
  recover  tone-pending
  normal   tone-pending
  fatal    tone-pending
  join     tone-pending
```

运行结束：

```text
marker: "alive"                  // 页面没有刷新
runningNow: 0
summary: 运行失败 · fatal (NODE_FAILED)
         3 completed (1 recovered) · 1 failed · 2 skipped
         首个失败 / first failure: fatal — demo fatal failure
         skipped: normal (upstream-condition), join (upstream-failure)
counts:  3 completed | 1 recovered | 1 failed | 2 skipped
```

状态流面板有 **20 条** transition 行，包括：

```text
gate    ◉ running
gate    ! completed · recovered   recovered NODE_FAILED: demo recoverable failure
fatal   ◔ ready
fatal   ◉ running
fatal   ✕ failed                  NODE_FAILED: demo fatal failure
normal  – skipped                 skip: upstream-condition
join    – skipped                 skip: upstream-failure
```

浏览器 `Runtime.exceptionThrown` / `Log.entryAdded` 没有 JS 错误。

HTTP/SSE 侧证（另起一次 `canvas-demo-pacing`）：

```text
POST /api/runs -> 201
GET /api/runs/:id/events -> 200 text/event-stream
events: state, node×9, finished
runningSeen: true
finished: true
```

SSE 的 `state` 事件带完整 snapshot；非常快的 start/gate 初始迁移可能已经包含在 state 快照里而不是逐条 node 事件里，但页面显示和终态一致。这是“晚订阅 + 全量 state”的设计，不是刷新丢失。

---

## 4. 语义：失败、recovered、skip、摘要

### 4.1 失败

fatal 节点：

```text
class: node tone-failed
text:  fatal · fail · failed
       ✕ failed
       NODE_FAILED: demo fatal failu…
```

点 fatal：

```text
失败 Failed
NODE_FAILED: demo fatal failure
节点 output
该节点记录没有 output 键（失败/跳过节点通常如此）。
source: snapshot.result.nodes["fatal"].output
status failed / duration 506 ms / type fail / onError failFast
```

红卡、失败原因、无 output 的原因三者一致。

### 4.2 recovered 与干净成功

- gate：`node tone-recovered`，文案 `! completed · recovered`、`recovered NODE_FAILED`，虚线/琥珀色（截图可见），与 `tone-completed` 的 start/recover 明显不同。
- gate inspector：`失败已兜底 Recovered` + `NODE_FAILED: demo recoverable failure`；output 显示 `{"error":{...}}`。
- 点 gate 的来源：`source: snapshot.result.nodes["gate"].output`。
- 干净成功 start/recover 是绿色 `✓ completed`，没有 `!`/recovered 文案。

### 4.3 skipped

normal：

```text
node tone-skipped
– skipped
skip: upstream-condition
```

join：

```text
node tone-skipped
– skipped
skip: upstream-failure
```

inspector 也显示 `跳过 Skipped` + `skipReason: ...`；没有 output，并明确解释“没有 output 键”。

### 4.4 摘要数字对账

真实 result 节点：`start completed`、`gate completed+recovered`、`recover completed`、`normal skipped`、`fatal failed`、`join skipped`。

- completed = 3（start、gate、recover；含 recovered）；
- recovered = 1（gate）；
- failed = 1（fatal）；
- skipped = 2（normal、join）。

summary 的 `3 completed (1 recovered) · 1 failed · 2 skipped` 与逐节点数完全一致；`首个失败 / first failure: fatal` 也正确。

---

## 5. output 契约与只读

### 5.1 output 真的只来自 result

`nodeOutput` 的实现是唯一入口：

```ts
if (!snapshot.result) return { available:false, reason:'running' };
const record = snapshot.result.nodes[nodeId];
if (!Object.prototype.hasOwnProperty.call(record, 'output')) return { available:false, reason:'no-output' };
return { available:true, value: record.output };
```

浏览器 gate 面板同时显示了：

```text
{"error":{"code":"NODE_FAILED","message":"demo recoverable failure"}}
source: snapshot.result.nodes["gate"].output
```

fatal/normal 显示“没有 output 键”，与 result 中确实没有 output 一致。没有从 `snapshot.nodes` 偷 output 的路径：`CanvasNodeRuntime` 本身没有 output，`withLiveChanges` 也不写 output。

### 5.2 只读证明

静态 grep：

- 只有 `state.snapshot = message.snapshot` / `state.snapshot = null` 这种**指针替换**；
- 没有 `snapshot.nodes[...] =`、`snapshot.result =`、`result.nodes[...] =`；
- `withLiveChanges` 每次都 `{...snapshot, nodes}` 并新建每个被改节点。

独立 frozen 探针：

```text
frozen: true
originalUnchanged: true
newSnapshot: true
originalGateStillCompleted: completed
liveGateStatus: running
outputRecover: { available:true, value:{message:"RECOVERED"} }
summaryHeadline: 运行失败 · Run failed
```

即：把 snapshot/nodes/result 全部 `Object.freeze` 后，`withLiveChanges` 仍返回新对象，`nodeOutput` 仍能读，原 snapshot 一个字节没变。UI 的 model/summary 面是只读的。

### 5.3 服务端事件边界（措辞要收窄）

UI `src` 中 **没有** `flow/node-status`、`graph/node-status`、`flow/run-*` 的直接订阅；运行状态来自 `canvas.run()` 返回的 projection。`runs.ts` 只 subscribe `projection` 的 change，不碰内核。

但“服务端只用 canvas 公开 API”不是字面成立：

- `runtime.ts` 用 `FlowEngine` 的 `getFlow`/`registerFlow`/`listFlows` 做注册与描述；
- `server.ts` 用 `engine.hasFlow` 做 404 校验。

这些是 **FlowEngine 公开 API**，不是内核事件；如果契约要求“只用 canvas”，应改成“运行状态/output 只用 canvas；flow 注册与清单用 engine”。目前没有直接订阅内核/flow 事件，这一点通过。

---

## 6. 交付截图：陌生人 30 秒判断

看了 `docs/run-final.png` 和 `docs/run-predicate.png`。

### run-final.png

**30 秒内可以回答：**

- 哪里失败：顶部红条 `运行失败 · fatal (NODE_FAILED)`；fatal 红卡 + `NODE_FAILED: demo fatal failure`。
- 哪里被兜底：gate 琥珀虚线 + `! completed · recovered`；摘要 `1 recovered`。
- 哪里跳过：normal/join 虚线 `– skipped` + `skip: upstream-condition` / `skip: upstream-failure`。
- 数字：`3 completed (1 recovered) · 1 failed · 2 skipped`，chips 同样。

图例偏大（11 项），但不看也能答，因为卡片和摘要都带文字。**这一张过关。**

### run-predicate.png

这张是 `尚未运行` 的 idle 图，只能证明 predicate 边是橙色并带 `predicate` 标签；陌生人无法从这张图回答“哪里失败/哪里被兜底/哪里跳过”。如果它的用途只是“展示第三色条件边”，那没问题；如果拿它当运行语义的第二张证据，它不合格——应该重拍一张 predicate flow 跑完的图，或和 run-final 配对说明。

**结论：run-final 可以给人看；run-predicate 只能当颜色示例，不能当运行结果示例。**

---

## 7. 3080 / profile / README 三步

### 7.1 边界

- UI 只监听 `127.0.0.1:4780`；3080 仍是原 PID 16080（16:00 启动），没有替换/写 profile。
- UI 服务用内存 Context，没有挂 flow-storage；`src` 没有 `~/.dsh` 写入，也没有 `DSH_HOME` 写操作。
- 没有安装到任何 profile；没有改 3080 本体。
- 4780 的旧进程被停掉，最后自己的 PID 32312 也停了。

### 7.2 README 的“接进 3080 三步”

三步是：

1. Host 插件 inject `FlowCanvasToken`，暴露 `list/project/startRun/subscribe` 的 Remote namespace；
2. Client 通过 `ctx.slots.inject/register`、`ctx.locale`、`HostObservable` 接侧栏/主面板；
3. 安装到 `~/.dsh_test_2` 测试节点并 reload 3080。

核对 DSH 现状：

- `FlowCanvasToken` 存在于 `@deepseek-ai/dsh-graph-flow-canvas`；
- `HostObservable` 存在于 `@deepseek-ai/dsh-client-ui-slots`，形式就是 `{getSnapshot, subscribe}`；
- `ctx.slots.inject` / `ctx.slots.register`、`ctx.locale.register`、`ctx.remote` 在 DSH client 代码中大量存在；
- `DSH_HOME=~/.dsh_test_2` 是测试节点，不是 `~/.dsh`；README 明确“never ~/.dsh”。

所以这三步**不是空头支票**，API 名称和方向对得上；但它只是计划，没有实际接进 3080。真正做的时候要注意：`~/.dsh_test_2` 是稳定测试节点，不是一次性节点，若要反复试装应使用一次性 `~/.dsh_test/编号` 并清理，避免污染稳定节点。README 的步骤 3 对“测试节点”的表述值得补一句。

---

## 8. 回归

### 8.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

9 个包（8 旧 + flow-canvas-ui）全部 `tsc` 通过，`EXIT=0`。

### 8.2 递归 test

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，**129 spec**：

| 包 | 数 |
|---|---:|
| flow-api | 6 |
| graph-core | 18 |
| flow-engine | 36 |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas | 17 |
| flow-canvas-ui | **25（model 13 / layout 5 / server 7）** |
| **合计** | **129** |

旧 104 的计数原样保留：UI 是新增 25，不改旧 spec。UI 的 `server.spec` 走真实 Loader/engine/canvas + 真实 HTTP，覆盖 SSE、终态、recovered/skip、output 只在 result；`model.spec` 覆盖只读 overlay、falsy output、不可用原因；`layout.spec` 覆盖分层/不重叠/并行边。

### 8.3 demo

```powershell
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

PowerShell 下 exit 0，输出 `gate: completed (recovered=NODE_FAILED...)`、`normal skipped`、`fatal failed`、`join skipped`，与 UI 终态一致。

没有跑 UI 的浏览器自动化进 `129`：UI 的 25 个 spec 不包含真实浏览器点击；本轮的真实浏览器证据是我自己的 Chrome/CDP 探针，已清理。

---

## 9. 包规范

| 项 | 结果 |
|---|---|
| `src/*.ts` ≤5 | **不通过：10 个**（server/runtime/runs/model/summary/layout/graph/panels/client/dom） |
| 单文件 ≤300 行 | TS 全部通过（最大 `panels.ts` 261）；**`public/styles.css` 546 行不通过**，若 CSS 也算单文件 |
| README 三件套 | 通过：`README.md` / `README.cn.md` / `README.i18n.yaml`，i18n 里 package/en/zh/reviewed 齐全 |
| 英文 description | 通过：package.json 的 description 是英文、说明“何时使用/何时跳过” |
| 无前端依赖污染其它包 | 通过：dependencies 只有 cordis + graph 包 + veren core/yaml，没有 React/浏览器框架；UI 不反向修改其他包 |
| LICENSE | 文件缺失；README 只写了 MIT，`package.json` license=MIT。若包规范要求 LICENSE 文件，这也要补 |

**这是本轮最明确的交付问题：页面功能过关，但包结构没过 ≤5 源文件规范。** 这不是“代码漂亮不漂亮”，而是项目 AGENTS 的硬性规范。

---

## 10. 最后直答

**这个第一版现在能不能给人看？**

**功能上能给人看：** 真页面、真运行、真 SSE、无刷新、失败/兜底/跳过都能看懂，output 确实来自 `snapshot.result.nodes[id].output`，只读契约也站得住；`run-final.png` 30 秒内能答出全部关键问题。

**但按当前包规范不能直接交付：** 10 个 `src` 文件超过 ≤5，`styles.css` 546 行超过 ≤300。给人看之前必须补的最小一项，是**把 UI 包的结构收到规范内（拆分/合并到 ≤5 源文件并处理 CSS 行数，或为这个 app-like 包明确申请例外）**——这不需要改页面行为，是交付门槛。

如果只挑一个**给人看的素材**问题：`run-predicate.png` 是 idle 图，不能证明 predicate 运行语义；建议补一张 predicate flow 跑完的截图（或明确它只是颜色示例）。`run-final.png` 本身已经够用。

**最容易在真实画布里再出问题的点：状态/结果两套数据面的时序与共享引用。** 页面这次表现正确，但一旦 UI 在运行中挂载、重跑、切 flow，或有人原地改 `snapshot.result`，就可能出现“状态来自新 run、output 来自旧 result”的假象；只读 + 每次 overlay 到副本这条契约必须一直守住。其次是服务端 run registry 的早期事件/全量 state 边界：页面靠 state 快照补齐，若未来去掉 state 或改成纯增量，很容易丢开头几帧。
