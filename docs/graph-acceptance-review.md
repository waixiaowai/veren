# packages/graph 验收复核报告

- 复核对象：`packages/graph/` 下 7 个可安装包 + `bundle/` 发布件。
- 复核依据：`flow-engine-prompt.md` 末尾「验收」12 条（以 prompt 为准）；设计意图参考 `flow-engine-design.md`；冲突单独记录。
- 复核方式：只读源码与测试，执行仓库现有测试命令（分 spec / e2e），并额外用独立探针验证测试没有真正覆盖的行为。没有改 `packages/graph` 下的任何源码或测试。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。
- 结论口径：**通过** = 有可复现证据证明该条成立；**不通过** = 实测违反或有硬缺口；**无法判定** = 证据不足。测试存在不等于该条被证明，测试写得太松会单独指出。

---

## 0. 结论速览

| # | 验收条目（摘要） | 结论 | 一句话证据 |
|---|---|---|---|
| 1 | graph-core：拓扑顺序、并发上限、cancel 全部 cancelled、fail-fast 下游 skipped 且兄弟跑完 | **不通过** | 拓扑/并发/fail-fast 通过；但真实运行中 cancel 后下游是 `skipped/upstream-cancel` 而非 `cancelled`，现有 cancel 测试在节点启动前就取消了。 |
| 2 | YAML 并行分支加载并注册进引擎 | **通过** | `yaml.spec.ts:76-87` 真实 Loader 装载后 `hasFlow('yaml-demo')` 为 true，运行得到 `L`/`R`。 |
| 3 | 并行 → 汇聚 → 一路失败 → fail-fast（下游 skipped、兄弟跑完、flow failed、事件序列正确） | **不通过** | 独立探针中兄弟分支被记为 `failed / FLOW_CANCELLED`，并额外发出 `graph/node-error:sib`；根因是 fail-fast abort 与 flow 层 `withTimeout` 叠加。 |
| 4 | post-execute waterfall 改写产出，下游黑板读到改写值 | **通过** | `composition.spec.ts:69-89` 断言 `up.output={out:'REWRITTEN'}` 且 `sink.output={v:'REWRITTEN'}`。 |
| 5 | 卸载节点插件后再运行 → `NODE_TYPE_NOT_FOUND` | **通过** | `composition.spec.ts:91-106`；独立用 `fiber.dispose()` 复核同样得到该 code。 |
| 6 | 引用不存在节点的 Edge 注册 → `GRAPH_DANGLING_EDGE` | **通过** | `engine.spec.ts:64-92` 对 dangling 边断言该 code。 |
| 7 | 条件边：false 分支 skipped（`upstream-condition`），true 分支正常执行 | **通过** | 仓库内只有 kernel 级测试；独立 flow 级探针得到 `take: completed`、`drop: skipped/upstream-condition`。 |
| 8 | onError fallback / errorBranch / 未失败时 error 端口不触发 | **通过** | `engine.spec.ts:175-232` 三组断言均通过；但 errorBranch 节点被记成 completed 且无 error，属于可观测性缺口。 |
| 9 | retry tries=3 前两次失败第三次成功；subflow 可运行；互相引用报 `FLOW_REFERENCE_CYCLE` | **通过** | `engine.spec.ts:145-158`、`236-253`、`94-107` 分别通过；并发两个 subflow 引用同一子 flow 会误报 cycle（额外缺陷）。 |
| 10 | mocks 指定节点不执行、直接产出 mock 值 | **通过** | `engine.spec.ts:129-143` 断言 `attempts.length===0` 且输出 `{attempt:99}`。 |
| 11 | 同第 5 条（prompt 重复） | **通过** | 同 #5。 |
| 12 | 全部 spec 并发通过；dispose 测试证明无注册泄漏 | **不通过** | 64 个 spec 并发全绿，但递归测试命令因 `flow-api` 无测试文件 exit 1；且 registry 的旧 disposer 会删掉新注册（HMR 不安全），现有测试未覆盖。 |

**总评：现在不能把 packages/graph 当成地基继续往上盖。** 设计面很完整、测试数量也不少，但 fail-fast / cancel 的核心语义、HMR 安全、并发 subflow 和测试门禁都还存在会直接伤到上层的问题。

---

## 1. 测试执行记录

### 1.1 仓库现有 spec 命令

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

结果：

```text
Summary: 1 fails, 6 passes

C:\Users\imeep\Documents\cursour\packages\graph\flow-api:
 ERROR  @veren/graph-flow-api@0.1.0 test: `vitest run`
Exit status 1
```

失败原因原文：

```text
packages/graph/flow-api test: No test files found, exiting with code 1
packages/graph/flow-api test: include: **/*.{test,spec}.?(c|m)[jt]s?(x)
```

分项结果（并发执行）：

| 包 | spec 文件 | 通过数 | 结果 |
|---|---|---:|---|
| graph-core | kernel.spec.ts | 15 | 通过 |
| flow-engine | registry.spec.ts / composition.spec.ts / engine.spec.ts | 5 + 3 + 18 = 26 | 通过 |
| flow-yaml | yaml.spec.ts | 4 | 通过 |
| flow-storage | storage.spec.ts | 3 | 通过 |
| node-tool | node-tool.spec.ts | 8 | 通过 |
| tools | graph-tools.spec.ts | 8 | 通过 |
| flow-api | 无 | 0 | **失败：No test files found** |

即：**有测试的 64 个 spec 全部并发通过，但递归测试命令整体非零**。作为交付门禁，这不算“全部 spec 通过”。

### 1.2 e2e

e2e 用各包配置执行：

```powershell
pnpm --dir packages/graph/<pkg> exec vitest run --config vitest.e2e.config.ts
```

| 包 | e2e 文件 | 结果 | 说明 |
|---|---|---|---|
| flow-storage | storage.e2e.ts | **1 passed** | 真实 dsh storage hub + json 后端 + 临时目录；无凭据，实际执行，不是跳过。 |
| tools | graph-tools.e2e.ts | **4 passed** | 真实 dsh-tools ToolRuntime；无凭据，实际执行，不是跳过。 |
| node-tool | real-flow.e2e.ts | **1 failed（retry x2，共 3 次）** | 真实 ToolRuntime / 子进程 / storage；无凭据，实际执行，不是跳过。 |
| graph-core | 无 `*.e2e.ts` | **exit 1** | `No test files found`，不是跳过。 |
| flow-engine | 无 `*.e2e.ts` | **exit 1** | 同上。 |
| flow-yaml | 无 `*.e2e.ts` | **exit 1** | 同上。 |
| flow-api | 无 e2e 配置 | — | 无 e2e。 |

node-tool e2e 关键失败输出：

```text
× executes a YAML-loaded parallel flow end to end and records the history 346ms (retry x2)

Error: ENOENT: no such file or directory, open
'C:\Users\imeep\AppData\Local\Temp\veren-real-flow-...\graph_flow.json'
 ❯ runScenario tests/real-flow.e2e.ts:153:17
```

注意：这不是“无凭据自跳过”。它实际跑了三次，三次都失败在读取持久化文件。

### 1.3 构建

```powershell
pnpm -r --filter "@veren/graph-*" build
```

7 个包 `tsc` 全部通过，`EXIT=0`。说明至少类型检查与产物构建是绿的。

---

## 2. 逐条验收

### 验收 1 —— graph-core 调度 / cancel / fail-fast

**结论：不通过。**

支持通过的证据：

- 拓扑顺序：`packages/graph/graph-core/tests/kernel.spec.ts:57-79`（`runs a diamond in topological order and reports completed`）断言 `end:a` 在 `start:b/c` 前、`end:b/c` 在 `start:d` 前。
- 并发不超上限：`kernel.spec.ts:81-102` 断言 `peak <= 2`。注意这个断言只证明“没有超过”，不证明“真的并发”；独立探针 K2 用 6 个裸节点 + `concurrency:2` 测得 `peak=2`，补上了这一点。
- fail-fast：`kernel.spec.ts:159-185` 断言 `down: skipped/upstream-failure`、`sibling: completed`、`join: skipped`、run `failed`。该测试的 sibling 是瞬时返回；独立探针把 sibling 改成 80ms 长任务，结果 `sibling: completed`，run 在 86ms 后才结束，证明内核确实等兄弟自然跑完。

不通过的部分（cancel）：

- `kernel.spec.ts:137-157` 在 `runGraph()` 返回后立刻 `handle.cancel()`。此时 `schedule()` 还停在 `await runCtx.serial(...)`，executor 根本没有启动；测试通过的是“未启动节点全部 cancelled”的退化路径，不是“运行中 cancel 传播”。
- 独立探针 K1 在节点真正启动后 10ms 取消：

```text
K1 {"started":true,"sawAbort":true,"status":"cancelled",
    "slow":{"status":"cancelled",...},
    "never":{"status":"skipped","skipReason":"upstream-cancel"}}
```

`never` 是下游节点，状态为 `skipped`，不是验收要求的 `cancelled`。根因在 `graph-core/src/scheduler.ts:253-263`（`settleSkip('cancelled','upstream-cancel')` 会级联 `skipDownstream`，把下游标成 skipped）和 `scheduler.ts:164-170`（收尾只处理仍在 `pending` 的节点）。

**差在哪 / 补起来要动哪里：**

- 若按验收原文“各节点进入 cancelled”：`scheduler.ts` 的 cancel 级联应把下游也落成 `cancelled`（而不是 `skipped/upstream-cancel`），收尾逻辑同步调整；`kernel.spec.ts:137-157` 要在 executor 已启动后再 cancel，并断言 trace 里确实出现过 executor。
- 若产品意图其实是“下游 skipped/upstream-cancel 也算取消”，则应改验收措辞；当前按原文不能判通过。

### 验收 2 —— YAML 并行 flow 加载并注册

**结论：通过。**

- 证据：`packages/graph/flow-yaml/tests/yaml.spec.ts:76-87`（`loads the parallel-branch flow through the real Loader into the engine`）。真实 Loader 组合见同文件 `55-62`，先装 kernel/engine/yaml-parser，再装 yaml 插件；断言 `engine.hasFlow('yaml-demo')===true`，运行后 `output.l==='L'`、`output.r==='R'`。
- 代码路径：`flow-yaml/src/index.ts:51-75` 读文件 → `flowFromYaml` → `engine.registerFlow`；`loader.ts:32-47` 校验结构。
- 覆盖是否充分：对“加载并注册 + 并行分支可运行”是充分的。瑕疵是测试用 `setTimeout(10)` 等注册（`yaml.spec.ts:78`），属于时序脆弱写法；`flow-yaml` 没有任何 e2e，e2e 配置存在但空跑会 exit 1。

### 验收 3 —— 并行 → 汇聚 → 一路失败 → fail-fast

**结论：不通过。**

- 仓库内没有 flow 层的这条测试：`flow-engine/tests/engine.spec.ts` 没有并行分支 + 失败 + join 的用例；只有 kernel 级 `kernel.spec.ts:159-185`。
- 独立探针 PROBE1 用内置 `noop` + 自定义 `slow`/`slowFail` 跑：

```text
"status": "failed",
"nodes": {
  "bad":  { "status": "failed",  "error": { "code": "NODE_FAILED" } },
  "sib":  { "status": "failed",  "error": { "code": "FLOW_CANCELLED", "message": "cancelled" } },
  "join": { "status": "skipped", "reason": "upstream-failure" }
},
"events": [
  "flow/run-start:ff",
  "graph/run-start:ff",
  "graph/node-error:bad:NODE_FAILED",
  "graph/node-error:sib:FLOW_CANCELLED",
  "graph/run-end:failed",
  "flow/run-end:failed"
]
```

兄弟分支 `sib` 没有跑完，而是被记成 `failed / FLOW_CANCELLED`；事件里多了一条 `graph/node-error:sib`。这同时违反“兄弟分支跑完”和“事件序列正确”。

**根因（代码级）：**

- `graph-core/src/scheduler.ts:300-303`：任一节点 fail-fast 时直接 `controller.abort()`，把同一个 signal 广播给所有兄弟节点。
- `flow-engine/src/runtime.ts:288-303`：flow 层每个节点都被 `withTimeout` 包裹，`signal.abort` 会无条件 `reject(flowError('FLOW_CANCELLED'))`。于是 flow 层兄弟节点“自愿响应”了 abort，立刻变成失败节点。
- `flow-engine/src/service.ts:203` 把 kernel 的 signal 原样交给所有 executor，问题因此贯穿 flow 层。

**差在哪 / 补起来要动哪里：**

- 要么 fail-fast 不 abort 兄弟（只标记失败、让已在运行的节点自然结束），要么 flow 层的 `withTimeout` 只在“外部 cancel”时响应 abort，对 fail-fast 的 abort 不把它转成节点失败。
- 加一条 flow 层测试：并行两个分支，一路失败，断言兄弟 `completed`、下游 `skipped/upstream-failure`、run `failed`，并断言事件序列没有兄弟的 `node-error`。

### 验收 4 —— post-execute waterfall 改写产出

**结论：通过。**

- 证据：`flow-engine/tests/composition.spec.ts:69-89`（`node-post-execute waterfall rewrites outputs and downstream blackboard reads see it`）。监听器把 `up` 的 envelope 改成 `{out:'REWRITTEN'}`，断言 `result.nodes.up.output` 和下游 `sink.output.v` 都是 `REWRITTEN`。
- 代码路径：`graph-core/src/scheduler.ts:283-293` 触发 `runCtx.waterfall` 并用 `envelope.output` 落 record；`flow-engine/src/service.ts:69-76` 的引擎监听器在 `next()` 返回后把最终产出写回黑板。
- 覆盖是否充分：对同步监听器充分。风险：`scheduler.ts:286` 调用 `runCtx.waterfall(...)` 没有 `await`；如果监听器返回 Promise，改写结果不会被等待。验收没有要求异步 waterfall，但这是未来扩展的坑。

### 验收 5 —— 卸载节点插件后 `NODE_TYPE_NOT_FOUND`

**结论：通过。**

- 证据：`flow-engine/tests/composition.spec.ts:91-106`（`uninstalling the node plugin makes later runs fail with NODE_TYPE_NOT_FOUND`），`ctx.registry.delete(upperPlugin)` 后 run 的 `up.error.code==='NODE_TYPE_NOT_FOUND'`。
- 独立复核：本次不用内部 `ctx.registry.delete`，而是保存 `ctx.plugin(nodePlugin)` 返回的 fiber 并 `await fiber.dispose()`，结果：

```text
E2 {"stillRegistered":false,"status":"failed",
    "node":{"status":"failed","error":{"code":"NODE_TYPE_NOT_FOUND",...}},
    "error":{"code":"NODE_TYPE_NOT_FOUND",...}}
```

- 代码路径：`flow-engine/src/runtime.ts:234-239` 在每次尝试时重新 `registry.get`，拿不到就抛 `NODE_TYPE_NOT_FOUND`。
- 覆盖是否充分：行为本身充分；测试使用 `ctx.registry.delete` 这一 Cordis 内部结构，不如 `fiber.dispose()` 真实，建议改测试写法。

### 验收 6 —— 悬挂边 `GRAPH_DANGLING_EDGE`

**结论：通过。**

- 证据：`flow-engine/tests/engine.spec.ts:64-92`（`detects graph cycles as FLOW_CYCLE_DETECTED and dangling edges loudly`）对 `edges: [{from:'a',to:'ghost'}]` 断言 `GRAPH_DANGLING_EDGE`。
- 代码路径：`graph-core/src/validate.ts:26-39` 抛 `GRAPH_DANGLING_EDGE`；`flow-engine/src/runtime.ts:114-118` 在 `compileFlow` 里调用 `validateGraph` 并透传。
- 覆盖是否充分：直接、充分。

### 验收 7 —— 条件边

**结论：通过（但仓库内没有 flow 层的正式测试）。**

- 仓库内只有 kernel 级：`graph-core/tests/kernel.spec.ts:252-270`（`a false edge condition skips the downstream subtree`），验证 `when: () => false` 的下游为 `skipped/upstream-condition`。
- flow 层的 `edge.when` 在 `flow-engine/src/service.ts:209-227` 被包进 kernel edge 的 `when`，并叠加端口结论。独立探针 PROBE3（真实 flow 引擎，两个 `tap` 分支）结果：

```text
PROBE3 {"trace":["tap","tap"],"status":"completed",
 "nodes":{"a":{"status":"completed"},"take":{"status":"completed"},
          "drop":{"status":"skipped","reason":"upstream-condition"}}}
```

- 覆盖是否充分：实现是对的，但验收要求的“带条件边的 flow”没有对应 flow 层测试；建议补 `engine.spec.ts`，不要只靠 kernel 测试。YAML 目前无法表达 `when`（函数不可序列化），这是已知限制，不是本条失败。

### 验收 8 —— onError fallback / errorBranch

**结论：通过。**

- 证据：
  - `engine.spec.ts:175-189`（`onError fallback keeps the flow running with the declarative value`）：`bad` 失败后 `fallbackValue` 生效，`next` 读到 `safe`，run `completed`。
  - `engine.spec.ts:191-211`（`onError errorBranch routes failures along the error port only`）：`recover` 经 `error` 端口完成，`normal` 被 skipped/upstream-condition。
  - `engine.spec.ts:213-232`（`keeps the error port inactive when the node does not fail`）：健康节点的 `recover` skipped，默认输出继续。
- 代码路径：`flow-engine/src/runtime.ts:262-273` 的 `settleFailure`；`service.ts:214-225` 的端口结论。
- 需要记录的缺口（不影响本条判定，但影响可观测性/交付质量）：
  - errorBranch 的失败节点在结果里是 `completed`，没有 `error` 字段，也不发 `graph/node-error`（探针 E3 的 `gate.status==='completed'`）。如果“失败走 error 端口”要求在逐节点执行记录里保留失败事实，这里需要改 `runtime.ts` 的落定方式。
  - 设计说“声明了 error 端口才可配 errorBranch”，但 `compileFlow` 不校验。探针 E3 在没有任何 `port:'error'` 边的情况下仍注册成功并跑完（`registration: registered`，`status: completed`）。这是 misconfiguration 没有 fails loud。

### 验收 9 —— retry / subflow / 引用环

**结论：通过。**

- retry：`engine.spec.ts:145-158`（`retries failures until success within the try budget`），`tries:3`，测试 handler 前两次抛错、第三次成功，断言 `attempts.length===3`、输出 `{attempt:3}`、run `completed`。测试的缺陷：handler 用 `attempts.length < 3` 硬编码，而不是读 `nctx.attempt` 或配置；它不证明“tries 是上界”，也不验证 `backoffMs`。
- subflow：`engine.spec.ts:236-253`（`runs a referenced flow as a subflow node`），父 flow 的 `subflow` 节点执行 child，输出 `{status:'completed', output:{said:'from-child'}}`。
- 引用环：`engine.spec.ts:94-107`（`reports mutual subflow references as FLOW_REFERENCE_CYCLE`），A 引用 B、B 引用 A 时第二次注册抛该 code；`service.ts:117-140` 的 DFS 是实际路径。
- 额外缺陷（本条未要求，但影响“地基”）：`runSubflow` 用全局 `this.activeRefs` 做递归防护（`service.ts:47,294-317`）。同一个 flow 里两个并行 subflow 节点引用同一个子 flow 时，第二个会被误判为递归。独立探针：

```text
{"status":"failed",
 "s1":{"status":"failed","error":{"code":"FLOW_CANCELLED"}},
 "s2":{"status":"failed","error":{"code":"FLOW_REFERENCE_CYCLE",
       "message":"recursive subflow reference to \"child\" at runtime"}}}
```

  `activeRefs` 应该是 per-run（或 per-run 栈），不能是引擎级全局集合。

### 验收 10 —— mocks

**结论：通过。**

- 证据：`engine.spec.ts:129-143`（`mocks skip execution and produce pinned values`）。`mocks:{a:{attempt:99}}`，断言 `result.nodes.a.output` 为 mock 值、`attempts.length===0`、下游 `b` 仍执行。
- 代码路径：`runtime.ts:194` 在进入执行/重试前直接 `settle(deps, nodeId, deps.mocks[nodeId])`。
- 覆盖是否充分：证明“不执行 + 直接产出”充分；没有断言下游节点真的从 mock 产出的 slot 读值（测试里 `b` 没有 `input` 引用 `a`）。建议补一个 `${a.out}` 的下游断言。

### 验收 11 —— 同验收 5（prompt 重复项）

**结论：通过。**

- 证据同 #5：`composition.spec.ts:91-106` + 独立 `fiber.dispose()` 探针 E2。
- prompt 第 5 和第 11 条文字完全相同，这是 prompt 的重复，不是额外要求；报告保留两条编号，结论一致。

### 验收 12 —— 全部 spec 并发通过 + dispose 无泄漏

**结论：不通过。**

通过的部分：

- 64 个 spec 在 6 个有测试的包中并发执行全部通过（见 §1.1 分项表）。
- `registry.spec.ts:60-79`（`registerNodeHandler cleans up in reverse order with the fiber (no leaks)`）通过。
- `node-tool.spec.ts:145-163`（`keeps the registration disposable without leaking`）通过。
- `graph-tools.spec.ts:144-149`（`disposing the plugin fiber removes every tool registration`）通过。
- 独立探针 E1 验证引擎 fiber 卸载后内置节点注册全部移除：

```text
E1 {"before":{"noop":true,"fail":true,"echo":true,"subflow":true},
    "after":{"noop":false,"fail":false,"echo":false,"subflow":false}}
```

不通过的部分：

1. **递归测试命令非零**：`flow-api` 没有测试文件，`vitest run` 直接 exit 1；`pnpm -r --no-bail --filter "./packages/graph/*" test` 汇总 `1 fails, 6 passes`。一个包“没有测试”不应让整套门禁红，但也不应把“没有测试”算成通过；当前是红。
2. **HMR 安全性实际不成立**：`flow-engine/src/registry.ts:20-31` 的 disposer 只按 `(type, version)` 删除，不校验当前 handler 是不是自己注册的那个。旧 disposer 在新 handler 覆盖后执行，会删掉新 handler。独立探针：

```text
before new
after old dispose, get= undefined
```

   而 `registry.spec.ts:36-45` 的“HMR reload”测试只调用了**新** handler 的 disposer，从未调用旧 disposer，所以没有证明 HMR 安全；它反而掩盖了这个问题。
3. **flow-api 没有任何测试**，而它包含 `registerNodeHandler` 运行时逻辑；dispose/HMR 承诺没有在该包侧验证。
4. `flow-yaml` / `flow-storage` 的卸载路径（flow 注销、domain 关闭）没有测试；不算直接失败，但“无注册泄漏”的证据链不完整。

**差在哪 / 补起来要动哪里：**

- `registry.ts` 的 disposer 改为身份校验（例如 `if (versions.get(version) !== handler) return false`）或使用注册 token；`registry.spec.ts` 补“新注册覆盖后调用旧 disposer，仍能取到新 handler”的测试。
- `flow-api` 增加至少一个 spec（`registerNodeHandler` 注册/卸载），或把 `test` 脚本改为有测试后自然通过，而不是 `No test files found`。
- 补 `flow-yaml`/`flow-storage` 的卸载测试；把 e2e 配置为空的问题一并处理（要么删掉空配置，要么加 `passWithNoTests` 并明确说明）。

---

## 3. 测试本身的缺陷（同样算结论）

1. **kernel cancel 测试是退化的**：`kernel.spec.ts:137-157` 在节点启动前 cancel，executor 从未执行；它证明的是“pending 节点 cancelled”，不是“运行中 cancel 传播”。独立 K1 才暴露下游 `skipped/upstream-cancel`。
2. **engine cancel 测试同样是退化的**：`engine.spec.ts:278-302` 和 `329-350` 都在 `engine.run()` 后立即 `handle.cancel()`；`drive()` 还在 `flow/run-starting` 的 await 处，handler 没启动。独立 PROBE2 在 20ms 后 cancel（handler 已启动且忽略 signal）得到 `status:'failed'`、`a.error.code:'FLOW_CANCELLED'`，而不是 `cancelled`。这说明 flow 层 cancel 语义与 API 直觉不一致。
3. **并发测试只证上限，不证并发**：`kernel.spec.ts:81-102` 只断言 `peak<=2`；如果实现串行，peak=1 也会过。独立 K2 测得 peak=2，补了证据，但测试本身应改为 `expect(peak).toBe(2)` 或至少断言曾同时运行。
4. **fail-fast 的兄弟分支是瞬时任务**：`kernel.spec.ts:159-185` 的 `sibling` 立刻返回，不能证明“等待正在运行的兄弟自然结束”；独立长任务探针才证明。建议把 sibling 改成延时任务。
5. **事件序列只做 `toContain`**：`kernel.spec.ts:171-184` 对 `events` 用 `toContain('error:bad')` / `toContain('end:failed')`，没有断言顺序和“不应出现的事件”。验收 #3 要求“事件序列正确”，这个测试不足以证明。
6. **retry 测试硬编码次数**：`engine.spec.ts:28-37` 的 `flakyHandler` 用 `attempts.length < 3` 决定失败，不读 `nctx.attempt`，也不验证 `tries` 上界与 `backoffMs`；把 `tries` 改成 5 测试仍会过。
7. **errorBranch 只测“路由”，不测失败事实**：`engine.spec.ts:191-211` 没有断言 `gate.status` / `gate.error` / 是否发 `node-error`。实现把失败节点记成 completed，测试不会发现。
8. **没有 flow 层的 #3 和 #7 测试**：并行 fail-fast 只在 kernel 层；条件边只在 kernel 层。验收 #3 的“flow failed / 事件序列”、#7 的“flow 条件边”都缺少正式用例。
9. **HMR 测试漏掉旧 disposer**：`registry.spec.ts:36-45` 只测新注册覆盖后新 disposer 删除；旧 disposer 删除新 handler 的路径未测，且实现确实有 bug。
10. **node-tool e2e 缺少 storage 就绪等待**：`node-tool/tests/real-flow.e2e.ts:104-119` 装完 `flow-storage` 后立即装 engine；`flow-storage/tests/storage.e2e.ts:34-36` 明确轮询 `FlowStorageToken`，node-tool 没有。结果 engine 构造时 `get(ctx, FlowStorageToken)` 为 undefined，运行记录不会落盘，读 `graph_flow.json` 必然 ENOENT。这是测试缺陷，但也暴露了产品层的时序脆弱（见 §4）。
11. **空 e2e 配置会让命令红**：graph-core/flow-engine/flow-yaml 有 `vitest.e2e.config.ts` 但没有 `*.e2e.ts`，执行直接 `No test files found` exit 1。验收只要求 storage e2e，但“有配置无测试”应清理或显式跳过。
12. **测试用内部 API 模拟卸载**：`composition.spec.ts:98`、`node-tool.spec.ts:138` 用 `ctx.registry.delete(...)`，不是 `fiber.dispose()`。行为本次独立复核是对的，但测试路径不够真实。
13. **YAML 测试用 `setTimeout(10)` 等注册**（`yaml.spec.ts:78`），属于时序脆弱；应轮询 `hasFlow`。
14. **graph-tools.spec 在根 ctx 上注册 slowHandler 后不卸载**（`graph-tools.spec.ts:80`），虽然每个测试新建 Context 不会跨测试污染，但“无泄漏”叙事不完整。
15. **waterfall 只测同步监听器**；`scheduler.ts:286` 不 await，异步 waterfall 会静默丢失改写。验收没要求，但应在 README 里写明“waterfall 仅同步”。

---

## 4. 额外发现的产品级缺陷（超出 12 条，但影响“地基”判断）

1. **fail-fast 把兄弟分支打成失败**：见验收 #3。根因是 kernel 的 `controller.abort()`（`scheduler.ts:300-303`）与 flow `withTimeout` 的 abort 拒绝（`runtime.ts:288-303`）叠加。这是最严重的问题。
2. **flow 层 cancel 可能报 failed 而不是 cancelled**：见测试缺陷 #2。非协作 handler 在 cancel 时被 `withTimeout` 拒绝，node 记 failed，run 记 failed；API 的 `FlowRunHandle.cancel()` 语义不可靠。
3. **并发 subflow 误报 `FLOW_REFERENCE_CYCLE`**：`service.ts:47` 的 `activeRefs` 是引擎级全局 Set；同一子 flow 的并行 subflow 会互相误伤。应改为 per-run 栈。
4. **storage 能力晚到，engine 捕获不到**：`flow-engine/src/index.ts:77` 在 apply 时 `get(ctx, FlowStorageToken)` 一次；`flow-storage/src/index.ts:57-65` 通过 async effect 晚一步 provide。独立探针：

```text
S1 token immediately after await ctx.plugin: false
S2 engine storage token at apply: false file: no:ENOENT
```

   这解释了 node-tool e2e 的 ENOENT，也说明 engine 的“可选 storage”在组合顺序变化时会静默失效。应改为按 run 解析能力，或让 engine 显式等待 `FlowStorageToken`，或让 storage 在插件 apply 完成前就绪。
5. **errorBranch 缺少端口声明校验**：设计要求“声明了 error 端口才可配”，实现 `runtime.ts:262-273` 不检查；探针 E3 无 error 边仍注册成功并 completed。应把“errorBranch 必须至少有一条 `port:'error'` 出边”放到 `compileFlow` 的 fail-loud 校验里。
6. **errorBranch 丢失失败事实**：失败节点被记为 `completed`、无 `error`、不发 `node-error`；逐节点执行记录无法区分“真成功”和“走了 error 端口”。若下游依赖执行记录做重试/告警，会误判。
7. **waterfall 异步不等待**：`scheduler.ts:286` 不 `await`；异步监听器的 Promise 被忽略，`envelope` 改写可能晚于 record 落定。至少要在类型/README 里声明仅同步，或改成 await。
8. **`graph/node-pre-execute` 语义与 prompt/design 冲突**：prompt `flow-engine-prompt.md:58` 和 design `flow-engine-design.md:125` 都写“返回 false 跳过”，实现与 README 是“真值否决”（`scheduler.ts:271-272`；Cordis `isBailed` 见 `cordis/src/events.ts:13-15`）。实现跟的是 Cordis `isBailed` 的真实语义，不是 prompt 的文字；这是文档/框架冲突，需要统一，否则节点插件作者会按 false 写而得到相反结果。
9. **flow 层没有 `ctx.extend({flowId})` 黑板作用域**：prompt `flow-engine-prompt.md:45-47` 要求在内核 run 子 context 之上再 `ctx.extend({flowId})`，节点在 `ctx.isolate(nodeId)` 内写 flow 级黑板；实际是独立的 `FlowBlackboard` Map（`runtime.ts:69-76`），`nctx.ctx` 仍是 kernel 的 run context（`runtime.ts:240-249`）。行为上数据传递能工作，但设计承诺的 context 作用域没有落地，未来要按 context 做隔离/追踪时会缺一层。
10. **`NodeRegistry.register` API 与 prompt 不一致**：prompt `flow-engine-prompt.md:49` 写 `register(type, handler)`；实际 `register(handler)`（`registry.ts:20`），type 在 handler 里。不是致命问题，但节点插件作者按 prompt 写会编译失败。
11. **flow 事件的黑板快照不完整**：prompt `flow-engine-prompt.md:63-64` 说 flow 事件“带 flowId 与黑板快照”；实际只有 `flow/run-end` 带 `blackboard`（`service.ts:278`），`flow/run-starting`/`flow/run-start` 只有 input（`types.ts:140-144`）。二期 UI 若要实时看黑板，需要补。

---

## 5. 交付要求记录（只记录，不改代码）

### 5.1 文档三件套

| 检查项 | 结果 |
|---|---|
| `README.md`（英文） | 8/8 目录都有（含 bundle） |
| `README.zh.md`（中文） | **0/8**；实际是 `README.cn.md`（8/8） |
| `README.i18n.yaml` | **0/8** |
| 英文 description（`package.json`） | 7/7 可安装包都有，且都是 “Use when …” 句式；bundle 也有 |
| MIT LICENSE | 5 个核心包（graph-core/flow-api/flow-engine/flow-yaml/flow-storage）都有；**`tools` 和 `bundle` 没有** |
| README “非目标” | graph-core 与 flow-engine 有 `Non-goals (phase 2)`；其他包未见完整非目标章节 |

说明：prompt 明确要求 `README.md` + `README.zh.md` + `README.i18n.yaml`；AGENTS.md 写的是 `README.cn.md`；design 文档 §2 自己承认两者冲突并说“以仓库现状裁决”。实际选择了 `README.cn.md`。因此按 prompt 的三件套，**中文文件名和 i18n 文件都不合格**；按 AGENTS/仓库现状，中文文件名合格但 i18n 仍缺。这个冲突应在仓库规范里统一，不能两边都算对。

### 5.2 源文件数与行数

| 检查项 | 结果 |
|---|---|
| 单包源文件 ≤5 | **通过**：graph-core 5、flow-engine 5、flow-api 2、flow-yaml 2、flow-storage 3、node-tool 1、tools 3；无超 5 |
| 单文件 ≤300 行 | **不通过**：`flow-engine/src/service.ts` 315 行；测试 `flow-engine/tests/engine.spec.ts` 349 行、`graph-core/tests/kernel.spec.ts` 301 行；`scheduler.ts`/`runtime.ts` 正好 300 行（贴线） |
| `src/types.ts` 只放类型 | **通过**：`graph-core/src/types.ts`、`flow-api/src/types.ts`、`flow-engine/src/types.ts`、`tools/src/types.ts` 均为类型/declare module，无运行时导出 |
| 禁止 default export | **通过**：源码无 `export default`；只有 `vitest.config.ts` 使用标准的 `export default defineConfig` |
| 本地导入 `.ts` 后缀 | **不通过（按 prompt/AGENTS）**：源码本地导入全部是 `.js`（如 `scheduler.ts:18`、`service.ts:15-18`）；仓库既有包（yaml-parser）也用 `.js`。当前 tsconfig 没有 `allowImportingTsExtensions`，改成 `.ts` 会与 `tsc` 构建冲突，需要先统一规范 |

### 5.3 manifest / 包结构

| 检查项 | prompt 要求 | 实际 |
|---|---|---|
| 包名 | `@deepseek-ai/dsh-graph-*` | `@veren/graph-*` |
| 产物入口 | `main: lib/index.js`，`files` 只含 lib | `dist/index.js`，`files: ["dist"]` |
| `exports` | `.` + `./types` | 5 个核心包都有；`node-tool`/`tools` 只有 `.`，没有 `./types`（tools 有 `src/types.ts` 却没有该子路径） |
| cordis / 兄弟 dsh 包 | `peerDependencies`，版本锁补丁号 | 全部放 `dependencies`（cordis `^4.0.4`；dsh 包 `0.2.0-rc.2`；@veren 包 `workspace:*`），没有任何 `peerDependencies` |
| `type: module` | 是 | 是 |
| `src/types.ts` 只放类型 | 是 | 是 |
| 包结构 | 5 个包 | 实际 7 个可安装包 + 1 个 `bundle/`（`node-tool`、`tools`、`bundle` 超出 prompt 列表） |
| tarball | 不要发布 | 仓库里已有各包 `*.tgz` 与 `bundle/tarballs/*.tgz`；本次复核没有发布新 tarball |

包名/`lib`/peerDependencies 的差异与仓库现状（`@veren/*`、`dist`、`dependencies`）一致，属于“prompt 的 DSH 风格要求”与“当前 @veren 工作区约定”的冲突；但 prompt 明确写了 manifest 规范，交付时不能声称完全符合。

### 5.4 其他交付观察

- `graph-core` 确实对业务零认知：只 import cordis / core / 本地 kernel 文件，没有 flow 语义。
- 内置节点 4 个（noop/fail/echo/subflow），符合“2~3 个 + subflow”的意图（多一个 echo 作为夹具）。
- graph-core 单测用纯内存 executor，不依赖 flow 层；符合。
- Loader composition 测试存在：`composition.spec.ts`、`yaml.spec.ts`；符合。
- `flow-storage` 有 e2e 且真实 storage 通过；符合。
- Client UI 未实现，README 写了二期非目标；符合一期范围。
- `flow-api` 没有任何测试，`flow-yaml`/`flow-storage` 卸载路径无测试；与“registry 贡献必须带 dispose/HMR 安全测试”的 AGENTS 要求不完整。

---

## 6. 文档 / 设计 / 实现冲突清单

| # | 冲突点 | 文档说法 | 实现 | 影响 |
|---|---|---|---|---|
| 1 | 包名与产物 | prompt：`@deepseek-ai/dsh-graph-*` / `lib` | `@veren/graph-*` / `dist` | 与 DSH 风格不符，但与仓库现状一致；需要统一规范 |
| 2 | 依赖形态 | prompt：peerDependencies，锁补丁号 | dependencies + `^`/`workspace:*` | 多实例/版本漂移风险 |
| 3 | 中文文档名 | prompt：README.zh.md；AGENTS：README.cn.md | README.cn.md | 两套规范冲突；i18n 文件两边都缺 |
| 4 | `graph/node-pre-execute` | prompt/design：返回 false 跳过 | 真值否决（Cordis `isBailed`） | 节点作者按文档写会得到相反结果；必须改文档或改语义 |
| 5 | flow 黑板作用域 | prompt：`ctx.extend({flowId})` + isolate 写 slot | 独立 `FlowBlackboard` Map | 数据传递可用，但 context 隔离/追踪承诺未落地 |
| 6 | `NodeRegistry.register` | prompt：`register(type, handler)` | `register(handler)` | API 不一致 |
| 7 | flow 事件快照 | prompt：flow 事件带黑板快照 | 只有 `flow/run-end` 带 | 二期实时 UI 需要补 |
| 8 | errorBranch 端口校验 | design：声明 error 端口才可配 | 不校验，静默 completed | misconfiguration 不 fails loud |
| 9 | 本地导入后缀 | prompt/AGENTS：`.ts` | 全部 `.js` | 与当前 tsc NodeNext 构建方式冲突；需先统一 |
| 10 | 包结构 | prompt：5 个包 | 7 个可安装包 + bundle | 范围扩张；不一定是错，但验收范围要写清 |

---

## 7. 最终总评

**这套 `packages/graph` 现在不能当作地基继续往上盖。**

它不是“没写完”的状态：模型、事件、黑板、onError、retry、subflow、mock、YAML、storage、tools 都已经有实现，64 个 spec 并发全绿，构建也过。问题在于**核心保证不成立**：

- fail-fast 在 flow 层会把正在跑的兄弟分支打成 `FLOW_CANCELLED`，直接违反验收 #3 的“兄弟分支跑完”；
- cancel 在真实运行中会把下游记成 `skipped` 而不是验收 #1 要求的 `cancelled`，现有 cancel 测试通过“启动前取消”绕开了这条路径；
- registry 的旧 disposer 会删掉 HMR 后的新 handler，HMR 安全性实际不成立；
- 并发 subflow 会误报引用环，storage 能力晚到会让 engine 静默丢掉持久化；
- 递归测试命令因 `flow-api` 空测试直接失败。

建议先修 **fail-fast/cancel 语义（kernel + flow withTimeout）**、**registry disposer 身份校验**、**flow-api 测试门禁**，再补 flow 层的 #3/#7 测试、storage 就绪时序、并发 subflow 测试；最后统一 README/包名/peerDependencies 的规范。修完这些之前，把 graph 当公共地基会让上层替它承担失败语义和生命周期的不确定性。
