# flow-canvas 第三轮画布数据面复核（收尾）

- 复核对象：`getRun().nodes` 实时面、`watch()` 任意时刻 hydration、可选键省略。
- 复核方式：只读源码/测试；独立探针在仓库外验证三种挂载时刻、迟到事件、拷贝语义、可选键；复跑 8 包 build、104 spec、e2e、demo。探针与日志已清理。
- 不碰前五份报告：`graph-acceptance-review*.md`、`graph-canvas-review*.md` 均未改。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。

---

## 0. 结论速览

| # | 收口点 | 结论 | 证据 |
|---|---|---|---|
| 1 | 运行中挂载 hydration | **通过** | 等 b 真正 running 后 watch：立即 `running / a=completed / b=running`，没有已完成节点显示 pending；人为迟到 pending/ready 不回退；change 只有 `b:completed`；a 刚完成时挂载、b 完成后挂载、run 结束后挂载都正确。 |
| 2 | `getRun().nodes` 实时 + 拷贝 + 旧 API | **通过（有浅拷贝 caveat）** | 运行中 `getRun` 返回 `running / a=completed / b=running`、`result` undefined；完成后 `getRun().result === awaitCompletion()`，nodes 是记录级浅拷贝；顶层改字段不影响内部，但嵌套 `error`/`recovered` 对象和 `result` 本身仍共享。旧 `status/result` 读取正常。 |
| 3 | 缺失可选键省略 | **部分通过** | `FlowRunResult.nodes[x]`、`getRun` 终态、canvas runtime 的 `error/skipReason/startedAt/endedAt/recovered` 都按值省略；顶层 `result.error` 成功时省略、失败时存在。**但 canvas runtime 根本没有 `output` 字段**：completed 节点的 result 有 output，canvas snapshot/change 里没有，`'output' in canvasNode` 永远 false。 |
| 4 | 回归 | **通过** | 8 包 build exit 0；递归 test exit 0，**104 spec**；旧 102 计数保留；e2e 全 exit 0；demo 在 PowerShell 下照 README 可跑。 |

**总评一句话：可以开工画只读结构/状态 UI；节点 output 必须从 `snapshot.result` 取，`getRun` 只保证浅拷贝——把这两条写进 UI 契约，才可以直接开工。**

---

## 1. 复跑记录

### 1.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

8 个包 `tsc` 全部通过，`EXIT=0`。

### 1.2 递归 spec

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，**104 spec**：

| 包 | 通过数 |
|---|---:|
| flow-api | 6 |
| graph-core | 18 |
| flow-engine | 36（新增 live-run.spec 1） |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas | 17（新增 mid-run.spec 1） |
| **合计** | **104** |

旧 102 计数保留：flow-engine 35→36，flow-canvas 16→17，其余包不变。

### 1.3 e2e

| 包 | 结果 |
|---|---|
| flow-storage | 1 passed |
| node-tool | 1 passed |
| tools | 4 passed |
| graph-core / flow-engine / flow-yaml / flow-canvas | `No test files found, exiting with code 0`（空套件） |

### 1.4 demo

```powershell
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

PowerShell 下 `EXIT=0`；输出仍包含 port 条件边、空 layout，以及：

```text
status gate: completed (recovered=NODE_FAILED ...)
status normal: skipped (skip=upstream-condition)
status recover: completed ...
status fatal: failed (error=NODE_FAILED ...)
status join: skipped (skip=upstream-failure)
```

---

## 2. 运行中挂载 hydration（重点 1）

### 2.1 a 已完成、b running 时挂载：通过

独立探针 `P1_MID`：`a`（noop）→ `b`（hold-open），等 b 的 `started` gate 真正打开后 `watch()`：

```text
immediate:{status:"running", a:"completed", b:"running"}
afterLate:{status:"running", a:"completed", b:"running"}
changes:["b:completed"]
final:{status:"completed", a:"completed", b:"completed"}
lateImmediate:{status:"completed", a:"completed", b:"completed"}
lateFinal:{status:"completed", a:"completed", b:"completed"}
lateResultSame:true
aHasStarted:true, aHasEnded:true, aHasError:false, aHasSkip:false
bHasStarted:true
```

- 立即 snapshot 是 `a completed / b running`，**没有“已完成节点显示 pending”**。
- 挂载后人为 emit `a:pending`、`a:ready`、`b:pending`、`b:ready`，`afterLate` 完全不变；rank/terminal 保护生效。
- change 回调只收到 `b:completed`，没有 a 的 pending/ready 倒退。
- `finished` 后是 `completed/completed/completed`，late after finish 也是终态；`late.snapshot().result` 与 `awaitCompletion()` 同一对象（`lateResultSame:true`）。

### 2.2 a 刚完成那一瞬挂载：通过

`P1_JUST_A`：`a` 是 60ms slow-a，`b` 是 hold-b；在 `flow/node-status` 收到 `a:completed` 的回调里立即 `watch()`：

```text
immediate:{status:"running", a:"completed", b:"running"}
final:{status:"completed", a:"completed", b:"completed"}
```

a 已 completed、b 已 running；没有 a pending。

### 2.3 b 完成 / run 结束后挂载：通过

- 先 watch 等 b 完成：`finished` 后 `a/b` 都 completed；之后 `watch()` 立即终态。
- run 结束后再 `watch()`：immediate snapshot 直接是 `completed/completed`，`result` 与 `awaitCompletion()` 同一对象。
- **边界**：在 `finished` 回调里再取 snapshot 也是 final；`applyResult` 在 `finished.then` 中先执行，cleanup 之后不会再有 status 事件。

### 2.4 结论

**mid-run hydration 这次真正收口了。** 早/中/晚三个挂载时刻、迟到重复事件、change 单调性、run-end 边界都实测通过；实现路径是 `watch.ts:62-70` 先读 `engine.getRun().nodes` 同步播种，`watch.ts:90-105` 再用 `TERMINAL` + `STATUS_RANK` 吸收迟到/低序事件。

---

## 3. `getRun().nodes` 实时、拷贝与旧 API（重点 2）

### 3.1 实时性

`P2_GETRUN`（a noop → b hold，b 已 running 时读取）：

```text
liveStatus:"running"
liveA:"completed"
liveB:"running"
liveResultUndefined:true
liveKeysA:["endedAt","startedAt","status"]
liveKeysB:["startedAt","status"]
```

- `getRun().nodes.a` 是 completed，`b` 是 running；不是等到 run 结束才有数据。
- 运行中 `result` 为 undefined；`status` 仍为 running。
- 旧 `getRun().status/result` 调用方不受影响；完成后 `doneStatus:"completed"`、`doneResultSame:true`。

### 3.2 拷贝语义

- 顶层记录拷贝：`live.nodes.a.status = 'failed'` 后，再次 `getRun().nodes.a.status` 仍是 `completed`；`live.nodes.b.startedAt = -1` 不影响内部。
- 完成后 `getRun().nodes.a` 不是 `result.nodes.a` 同一记录（`doneNodesSameRecord:false`），说明节点记录有拷贝。
- **浅拷贝 caveat**：`getRun` 用 `{...record}` 复制节点，但 `record.error` / `record.recovered` 是嵌套对象，仍与内部共享。探针：

```text
nestedBeforeCode:"NODE_FAILED"
nested.nodes.bad.error.code = "HACKED"
getRun().nodes.bad.error.code => "HACKED"
result.nodes.bad.error.code     => "HACKED"
```

  `getRun().result` 本身也是 `entry.result` 同一对象，外部直接改 result 会改引擎内部。代码符合“浅拷贝”描述，但“外部改了不影响引擎内部”只对顶层字段成立；UI 必须把返回对象当只读。

### 3.3 结论

**实时面和旧 API 扩展通过；拷贝只到记录级浅拷贝。** 这是设计上可接受的，但 UI 不能依赖深隔离。

---

## 4. 缺失可选键是否真的省略（重点 3）

`P3_KEYS` 同时检查 `FlowRunResult.nodes`、canvas runtime、顶层 result：

| 表面 | completed ok | failed bad | skipped down | recovered gate | 结论 |
|---|---|---|---|---|---|
| `FlowRunResult.nodes.ok` | keys `status,startedAt,endedAt,output`；无 error/skip | — | — | — | 正确 |
| `FlowRunResult.nodes.bad` | — | keys `status,startedAt,endedAt,error`；无 output/skip | — | — | 正确 |
| `FlowRunResult.nodes.down` | — | — | keys `status,skipReason`；无 startedAt/endedAt/error/output | — | 正确 |
| `FlowRunResult.nodes.gate` | — | — | — | keys `status,startedAt,endedAt,output,recovered`；无 error | 正确 |
| canvas runtime ok | keys `id,status,startedAt,endedAt`；**无 output** | — | — | — | **缺口** |
| canvas runtime bad | keys `id,status,startedAt,endedAt,error` | — | — | — | 正确 |
| canvas runtime down | keys `id,status,skipReason` | — | — | — | 正确 |
| canvas runtime gate | keys `id,status,startedAt,endedAt,recovered` | — | — | — | 正确 |
| 顶层 `result.error` | 成功 flow `'error' in result === false` | 失败 flow true | — | — | 正确 |

具体：

- `'error' in node`、`'skipReason' in node` 在终态、顶层 result、canvas runtime 中，缺失时都是 **false**；有值时存在（bad.error、down.skipReason、gate.recovered）。
- `startedAt/endedAt` 在 skipped 节点上不存在；completed 节点上存在。
- **`output` 是唯一没对齐的项**：`FlowRunResult.nodes.ok.output` 有值（`{}`），`FlowRunResult.nodes.gate.output` 有值；但 `CanvasNodeRuntime` 类型里没有 `output`，`watch.ts:34-42` 的 `toRuntime` 也没有拷贝它，所以 canvas snapshot/change 里 completed 节点永远没有 output。用户点的“canvas runtime 省略 output”并不成立——它是“根本没有 output”。
  - 若 UI 要节点 output，必须从 `snapshot.result.nodes[id].output` 取；`snapshot.nodes` 只承担状态/时间/错误面。
  - `getRun().nodes` 运行中 completed 记录也只有 status/时间，没有 output；output 只在最终 result（或完成后 getRun 从 result 回写）出现。
- 顶层 `result.error` 成功时省略、失败时存在；`FlowNodeRecord` 不再保留 `error: undefined` own property，`'error' in result` 成功为 false。
- README 已写“按值判断/缺失键省略”，与 `FlowRunResult` 一致；但与 canvas runtime 的 `output` 缺失不一致。

**结论：`FlowRunResult` 和 canvas 的状态类可选键通过；canvas runtime 的 `output` 未实现，按本条声称算部分不通过。**

---

## 5. 回归 / 测试质量

### 5.1 事实

- build：8 包 exit 0。
- spec：104 全绿；旧 102 计数保留（flow-engine +1 live-run，flow-canvas +1 mid-run）。
- e2e：flow-storage 1 / node-tool 1 / tools 4 通过；四个空套件 `No test files found, exiting with code 0`。
- demo：PowerShell 下 exit 0，输出 recovered/port/skip/failed 状态。

### 5.2 断言是否放松

- `mid-run.spec.ts` 是强断言：`viewOf(mid) = {running, a:completed, b:running}`，人工迟到 pending 后仍 completed，change 只有 `b:completed`，late watch 终态，rank 全程不下降。
- `live-run.spec.ts` 断言运行中 a completed、b running、result undefined、`'error' in` / `'skipReason' in` false，终态同样省略；覆盖了顶层 `result.error` 缺失。
- `watch.spec.ts` 原有 7 个状态/清理/recovered 用例保留；`project.spec.ts` 7 个条件/布局/序列化用例保留；`bundle.spec.ts` 1 个；demo 1 个。
- #8 原 engine errorBranch 用例仍保留，旧断言没有删；recovered 是加法。
- **没有发现“放松断言”**；新增测试比旧测试更严格。

### 5.3 覆盖缺口

1. `mid-run.spec.ts` 只测 a completed、b running 一个时刻；没有逐个覆盖 a 刚完成/ b 完成/ run 结束的正式用例（我们的探针补了）。
2. `live-run.spec.ts` 只测浅拷贝的顶层字段；没有测嵌套 `error/recovered` 共享和 `result` 同一对象（我们的探针发现）。
3. `FlowRunResult` 可选键测试只覆盖 error/skip；没有测 output/recovered/startedAt/endedAt 的缺失/存在（我们的 P3 补了）。
4. Canvas runtime output 缺失没有测试；这是本轮唯一实质未收口项。
5. `getRun` 旧 API 的 status/result 由现有测试覆盖，但 nodes 是新增 API，已有测试基本够。

---

## 6. 最后直答

**现在能不能说这份数据面可以直接开工画 UI 了？**

**可以开工画只读结构/状态 UI，但不能无条件地把它当完整节点数据面：**

- 结构/状态/挂载/停止/恢复这些核心路径都已经稳定；mid-run hydration、rank 保护、`getRun` 实时状态都实测通过。
- **节点 output 不在 canvas runtime**：completed 节点的 `snapshot.nodes[id]` 没有 output；要从 `snapshot.result.nodes[id].output` 取。UI 如果做“节点详情/输出面板”，必须按这个契约走。
- **`getRun` 是浅拷贝**：顶层字段改了不影响引擎，但嵌套 `error/recovered` 和 `result` 本身共享；UI 必须把返回对象当只读，不要原地改。
- **最容易再出问题的点**：hydration 与增量事件的时序（finished 边界、迟到/重复事件、rank 吸收）仍是最容易出 bug 的地方；其次是“runtime 状态面”和“result 数据面”两个对象边界的混用——尤其 output 和浅拷贝嵌套字段。

**一句话：现在可以开工画 UI；把“canvas runtime 只管状态/时间/错误，output 从 result 取，getRun/result 只读不深拷贝”写进 UI 契约，就可以比较稳地开画。**
