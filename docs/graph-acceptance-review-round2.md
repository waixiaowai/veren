# packages/graph 第二轮验收复核报告

- 复核对象：`packages/graph/` 下 7 个可安装包 + `bundle/` 发布件。
- 复核依据：`flow-engine-prompt.md` 末尾「验收」12 条（以 prompt 为准）；设计意图参考 `flow-engine-design.md`；第一轮报告 `docs/graph-acceptance-review.md` 未改动。
- 复核方式：只读源码/测试，执行修复方声明的 build、递归 test、各包 e2e；另外在仓库外写独立探针，专门验证第一轮钉死的缺陷和修复方新测试没有覆盖的分支。探针与执行日志已清理。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。
- 结论口径：**通过** = 可复现证据成立；**不通过** = 仍有硬缺口；**无法判定** = 证据不足。

---

## 0. 结论速览

| # | 验收条目（摘要） | 第二轮结论 | 一句话证据 |
|---|---|---|---|
| 1 | graph-core：拓扑顺序、并发上限、cancel 全部 cancelled、fail-fast 下游 skipped 且兄弟跑完 | **通过** | `cancel.spec.ts` 现在等 executor 真正启动后才 cancel；独立探针 K1（executor 忽略 signal 后自然结束）得到 `slow/down` 均 `cancelled`、无 `node-error`；`kernel.spec.ts` 并发断言已从 `<=2` 改为 `peak===2`。 |
| 2 | YAML 并行分支加载并注册进引擎 | **通过** | `yaml.spec.ts:84-94` 真实 Loader + 轮询 `hasFlow`，输出 `L`/`R`；新增 `yaml.spec.ts:96-104` 验证 fiber 卸载会注销 flow。 |
| 3 | 并行 → 汇聚 → 一路失败 → fail-fast（下游 skipped、兄弟跑完、flow failed、事件序列正确） | **不通过** | 普通 `slow` 兄弟已修好（F1：`sib completed`、`join skipped/upstream-failure`、事件精确、耗时 92ms）；但**同样是内置节点的 `subflow` 兄弟仍被取消**：F2 中 `sub` 记 `failed/NODE_FAILED`，子 flow 运行 `cancelled`，额外发 `node-error:sub`。 |
| 4 | post-execute waterfall 改写产出，下游黑板读到改写值 | **通过** | `composition.spec.ts:69-89` 仍断言 `up.output={out:'REWRITTEN'}` 且 `sink.output={v:'REWRITTEN'}`。 |
| 5 | 卸载节点插件后再运行 → `NODE_TYPE_NOT_FOUND` | **通过** | `composition.spec.ts:91-106`；独立探针 E2 用真实 `fiber.dispose()` 复核得到 `NODE_TYPE_NOT_FOUND`。 |
| 6 | 引用不存在节点的 Edge 注册 → `GRAPH_DANGLING_EDGE` | **通过** | `engine.spec.ts:37-65` 对 dangling 边断言该 code。 |
| 7 | 条件边：false 分支 skipped（`upstream-condition`），true 分支正常执行 | **通过** | 仓库内仍只有 kernel 级测试；独立 flow 级探针 `FLOW_COND`：`take completed`、`drop/child skipped/upstream-condition`。 |
| 8 | onError fallback / errorBranch / 未失败时 error 端口不触发 | **通过** | `engine.spec.ts:160-217` 三组用例通过；但仍保留“errorBranch 节点记 completed、无 error；未声明 error 端口也不报错”的残余缺口（见 §2 验收 8）。 |
| 9 | retry tries=3 前两次失败第三次成功；subflow 可运行；互相引用报 `FLOW_REFERENCE_CYCLE` | **通过** | `engine.spec.ts:112-143` 断言 `attempts=[1,2,3]` 和上界 `[1,2]`；`semantics.spec.ts:121-146` 证明并行 subflow 引同一子 flow 不再误报；`engine.spec.ts:67-74` 互引用仍报 `FLOW_REFERENCE_CYCLE`。 |
| 10 | mocks 指定节点不执行、直接产出 mock 值 | **通过** | `engine.spec.ts:96-110` 断言 `attempts.length===0` 且输出 `{attempt:99}`。 |
| 11 | 同第 5 条（prompt 重复） | **通过** | 同 #5。 |
| 12 | 全部 spec 并发通过；dispose 测试证明无注册泄漏 | **通过** | 递归命令 exit 0，78 个 spec 全绿；`registry.spec.ts:47-57` 覆盖旧 disposer 不删新 handler；独立探针 R1/H1/E1 全部通过。 |

**总评：从第一轮的“不能当地基”进了一步：普通 flow 路径已经基本修好，12 条里 11 条通过；但 fail-fast 下 subflow 兄弟仍会被引擎自己取消，这是地基级缺口，修掉之前仍不敢无条件在上面盖东西。**

---

## 1. 复跑记录

### 1.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

结果：7 个包 `tsc` 全部通过，`EXIT=0`。

### 1.2 递归 spec（修复方声称 78 spec exit 0）

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

结果：`EXIT=0`，分项如下：

| 包 | spec 文件 | 通过数 |
|---|---|---:|
| graph-core | kernel.spec.ts + cancel.spec.ts | 12 + 4 = 16 |
| flow-api | flow-api.spec.ts | 6 |
| flow-engine | registry.spec.ts / composition.spec.ts / engine.spec.ts / semantics.spec.ts | 6 + 3 + 14 + 8 = 31 |
| flow-yaml | yaml.spec.ts | 5 |
| flow-storage | storage.spec.ts | 4 |
| node-tool | node-tool.spec.ts | 8 |
| tools | graph-tools.spec.ts | 8 |
| **合计** | | **78** |

关键输出：

```text
packages/graph/flow-api test:  ✓ tests/flow-api.spec.ts (6 tests)
packages/graph/graph-core test:  ✓ tests/cancel.spec.ts (4 tests)
packages/graph/graph-core test:  ✓ tests/kernel.spec.ts (12 tests)
packages/graph/flow-engine test:  ✓ tests/semantics.spec.ts (8 tests)
...
EXIT=0
```

第一轮的 `flow-api: No test files found` 已消失，递归门禁真正绿了。

### 1.3 e2e

```powershell
pnpm --dir packages/graph/<pkg> test:e2e
# node-tool 连续执行 3 次
```

| 包 | 命令结果 | 说明 |
|---|---|---|
| flow-storage | **1 passed** | 真实 storage，无凭据，实际执行。 |
| tools | **4 passed** | 真实 ToolRuntime，无凭据，实际执行。 |
| node-tool | **连续 3 次各 1 passed** | 真实 ToolRuntime / 子进程 / storage；第一次就通过，3 次均 exit 0。 |
| graph-core | **exit 0，`No test files found`** | `passWithNoTests: true`；空套件，不是实际测试。 |
| flow-engine | **exit 0，`No test files found`** | 同上。 |
| flow-yaml | **exit 0，`No test files found`** | 同上。 |
| flow-api | 无 e2e 配置 | — |

`node-tool` 三次关键输出一致：

```text
✓ tests/real-flow.e2e.ts (1 test) 214ms
Test Files  1 passed (1)
     Tests  1 passed (1)
EXIT=0
```

第一轮的 ENOENT `graph_flow.json` 已消失。原因是 `real-flow.e2e.ts:115-123` 现在先等 `FlowStorageToken` 就绪再装引擎，并且 `FlowEngineService.resolveStorage()` 改成按次解析晚到的存储能力。

关于 `passWithNoTests`：它确实把三个空 e2e 配置从 `exit 1` 变成 `exit 0`，但输出明确是 `No test files found`，配置里也写了“本包没有独立 e2e”。因此这**是诚实的空套件声明，不是假装测试通过**；但不能把它算作这三个包的 e2e 覆盖。修复报告若把“e2e 全 exit 0”说成“全部包都有 e2e 验证”，那是夸大。

### 1.4 lockfile

```powershell
pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only
```

结果：`Done in 259ms`，`EXIT=0`，lockfile hash 未变化。另用脚本逐包比对 `package.json` 的 dependencies/devDependencies 与 `pnpm-lock.yaml` importer specifier，7 个包全部 `OK`。没有旧 `@veren/graph-*` 名字。

---

## 2. 逐条验收

### 验收 1 —— graph-core 调度 / cancel / fail-fast

**结论：通过。**

- 拓扑顺序：`graph-core/tests/kernel.spec.ts:28-50`（diamond）仍断言 `end:a` 在 `start:b/c` 前、`end:b/c` 在 `start:d` 前。
- 并发上限：`kernel.spec.ts:52-75` 已把旧断言 `peak <= 2` 改成 `expect(peak).toBe(2)`，既证上限也证真的并发；串行实现不会过。
- cancel：`graph-core/tests/cancel.spec.ts:40-67` 使用一次性 gate，等 executor 真正 `started.open()` 后才 `handle.cancel()`；断言 `slow` 和未启动的 `never` 都是 `cancelled`，且 `never.skipReason` 为 `undefined`。这正好覆盖第一轮“取消退化成 skipped”的缺陷。
- cancel 期间 executor 拒绝：`cancel.spec.ts:69-94` 的 executor 在 abort 时 `reject`，断言节点仍是 `cancelled`、`error` 为 `undefined`、`node-error` 事件为空。内核 `scheduler.ts:263-265` / `278-280` 对 `isExternalCancel` 分支做了兜底。
- fail-fast：`cancel.spec.ts:96-137` 的 sibling 是 80ms 长任务，断言 `sibling: completed`、`down/join: skipped/upstream-failure`、事件精确 `['error:bad','end:failed']`、`elapsed>=80`。第一轮“兄弟被记 failed/FLOW_CANCELLED”在内核层已消失。
- 独立探针 K1（executor 完全忽略 signal，80ms 后自然返回）：

```text
K1_IGNORE_SIGNAL_CANCEL {"elapsed":96,"status":"cancelled",
 "slow":{"status":"cancelled","output":"late"},
 "down":{"status":"cancelled"},"events":[]}
```

即使 executor 不响应 abort，内核也会等它自然结束，再把运行中节点和下游都落成 `cancelled`，且不发 node-error。修复到位。

### 验收 2 —— YAML 并行 flow 加载并注册

**结论：通过。**

- `flow-yaml/tests/yaml.spec.ts:84-94` 真实 Loader 组合（kernel + engine + yaml-parser + yaml 插件），新增 `waitForFlow()` 轮询替代旧 `setTimeout(10)`，断言 `hasFlow('yaml-demo')`，运行后 `output.l==='L'`、`output.r==='R'`。
- `yaml.spec.ts:96-104` 新增 fiber 卸载测试：`fiber.dispose()` 后 `hasFlow('yaml-demo')===false`。这既证明加载/注册，也补上了第一轮缺失的卸载路径。
- 测试仍是 5 个；空 e2e 的 passWithNoTests 不影响本条。

### 验收 3 —— 并行 → 汇聚 → 一路失败 → fail-fast

**结论：不通过。**

普通节点路径确实修好了。独立探针 F1（`slowFail` 10ms 失败，`slow` 80ms 完成，`join` 汇聚）：

```text
F1_FAILFAST {"elapsed":92,"status":"failed",
 "nodes":{"bad":{"status":"failed","error":{"code":"NODE_FAILED"}},
          "sib":{"status":"completed"},
          "join":{"status":"skipped","reason":"upstream-failure"}},
 "events":["flow-start","start","error:bad","end:failed","flow-end:failed"]}
```

这与新测试 `semantics.spec.ts:17-57` 一致：兄弟 completed、无多余 node-error、事件序列正确。

但**subflow 是内置节点，作为兄弟时仍然失败**。独立探针 F2：父 flow 的 `bad` 10ms 失败，`sub` 是运行 80ms 子 flow 的 `subflow` 节点：

```text
F2_FAILFAST_SUBFLOW {"status":"failed",
 "nodes":{
   "bad":{"status":"failed","error":{"code":"NODE_FAILED","message":"branch failed"}},
   "sub":{"status":"failed","error":{"code":"NODE_FAILED",
          "message":"subflow \"slow-child\" ended with status cancelled"}}},
 "childRuns":[{"flowId":"ff-sub","status":"failed"},{"flowId":"slow-child","status":"cancelled"}],
 "events":["error:bad","error:sub"]}
```

根因在 `flow-engine/src/service.ts:279-297` 的 `runSubflow`：

```ts
const onAbort = (): void => handle.cancel();
nctx.signal.addEventListener('abort', onAbort, { once: true });
```

`nctx.signal` 在 fail-fast 时收到的是 `FAILURE_REASON`（`graph-core/src/scheduler.ts:286-289`），不是外部取消；`runSubflow` 没有用 `isExternalCancel()` 区分，于是 fail-fast 的通知被当成取消，子 flow 被 `handle.cancel()`，父 subflow 节点随后失败并发出 `node-error:sub`。这直接违反验收 #3 的“兄弟分支跑完”和“事件序列正确”。

新增的 `semantics.spec.ts` 只测了 `slow` handler 兄弟（`semantics.spec.ts:17-57`），没有测 subflow 兄弟；所以这是**测试变绿但语义没有全覆盖**的典型：普通路径修了，subflow 路径漏了。

**差在哪 / 补起来要动哪里：**

- `service.ts:285` 的 `onAbort` 改成只在 `isExternalCancel(nctx.signal)` 时 `handle.cancel()`；fail-fast 通知应让子 flow 自然结束。
- 在 `semantics.spec.ts` 增加“fail-fast + subflow 兄弟”用例：断言 sub 节点 `completed`/子 run `completed`、join `skipped/upstream-failure`、事件没有 `node-error:sub`、整体 `failed`。

### 验收 4 —— post-execute waterfall 改写产出

**结论：通过。**

- `flow-engine/tests/composition.spec.ts:69-89`：监听器把 `up` 的 envelope 改成 `{out:'REWRITTEN'}`，断言 `result.nodes.up.output` 和下游 `sink.output.v` 都是 `REWRITTEN`。
- 代码路径：`graph-core/src/scheduler.ts:267-277` 触发 `runCtx.waterfall` 并用 envelope 落 record；`flow-engine/src/service.ts:61-68` 的引擎监听器在 `next()` 返回后写回黑板。
- 第一轮就通过；本轮没有退化。仍需注意 `scheduler.ts:270` 不 `await` waterfall，异步监听器不会被等待（类型上也没有承诺异步，属于已知限制）。

### 验收 5 —— 卸载节点插件后 `NODE_TYPE_NOT_FOUND`

**结论：通过。**

- `flow-engine/tests/composition.spec.ts:91-106` 仍然验证卸载 `upper` 后运行得到 `NODE_TYPE_NOT_FOUND`。
- 独立探针 E2 不走内部 `ctx.registry.delete`，而是保存 `ctx.plugin(nodePlugin)` 返回的 fiber 并 `await fiber.dispose()`：

```text
E2_NODE_UNINSTALL {"status":"failed",
 "node":{"code":"NODE_TYPE_NOT_FOUND",
         "message":"node \"u\" references unregistered type \"upper2@1\""}}
```

- 代码路径：`flow-engine/src/registry.ts:190-196` 每次尝试重新 `registry.get`，拿不到抛 `NODE_TYPE_NOT_FOUND`。
- 第一轮的缺陷已修复。测试本身仍用内部 `ctx.registry.delete` 而不是 fiber disposal，但独立探针证明真实卸载路径也正确；建议把测试改成 fiber.dispose()。

### 验收 6 —— 悬挂边 `GRAPH_DANGLING_EDGE`

**结论：通过。**

- `flow-engine/tests/engine.spec.ts:37-65` 对 `edges: [{from:'a',to:'ghost'}]` 断言 `GRAPH_DANGLING_EDGE`。
- 代码路径：`graph-core/src/validate.ts:26-39`，`flow-engine/src/runtime.ts:114-118` 在 `compileFlow` 中调用并透传。无退化。

### 验收 7 —— 条件边

**结论：通过。**

- 仓库内仍只有 kernel 级测试：`graph-core/tests/kernel.spec.ts:155-173`。
- 独立 flow 级探针 `FLOW_COND`（真实引擎，`a` 两个出边一真一假，`drop` 还有子节点 `child`）：

```text
FLOW_COND {"trace":["a","take"],"status":"completed",
 "nodes":{"a":{"status":"completed"},
          "take":{"status":"completed"},
          "drop":{"status":"skipped","reason":"upstream-condition"},
          "child":{"status":"skipped","reason":"upstream-condition"}}}
```

- 代码路径：`flow-engine/src/runtime.ts:191-210` 的 `toKernelGraph` 把端口结论和声明谓词组合进 kernel edge 的 `when`。
- 实现正确；测试缺口仍是“没有 flow 层的正式条件边用例”，建议补 `semantics.spec.ts`。YAML 目前不能表达函数谓词，这是已知限制。

### 验收 8 —— onError fallback / errorBranch

**结论：通过（有残余缺口，不影响本条按验收文字判通过）。**

- fallback：`engine.spec.ts:160-174`，`bad` 失败后 `fallbackValue` 生效，`next` 读到 `safe`，run `completed`。
- errorBranch：`engine.spec.ts:176-196`，`recover` 经 `error` 端口完成，`normal` 被 `skipped/upstream-condition`。
- 未失败时 error 端口不触发：`engine.spec.ts:198-217`，健康节点 `recover` skipped、默认输出继续。
- 代码路径：`flow-engine/src/registry.ts:218-230` 的 `settleFailure`；`runtime.ts:191-210` 的端口条件。

残余缺口（与第一轮相同，修复方未处理）：

1. errorBranch 的失败节点在结果里是 `completed`、无 `error`，不发 `graph/node-error`。独立探针仍得到 `gate.status==='completed'`、`output.error={code:'NODE_FAILED'}`。如果执行记录要区分“真成功”和“走了 error 端口”，这里需要改。
2. 设计说“声明了 error 端口才可配 errorBranch”，`compileFlow` 仍不校验。独立探针 E1 在没有任何 `port:'error'` 边时仍注册成功并 completed：

```text
E1_ERRORBRANCH_NO_PORT {"registration":"registered","status":"completed",
 "gate":{"status":"completed","startedAt":...,"endedAt":...,
          "output":{"error":{"code":"NODE_FAILED","message":"node failed"}}}}
```

验收 #8 的文字只要求错误走 error 端口、未失败不触发；这两点通过，所以本条判通过。但“misconfiguration fails loud”仍不成立，属于交付质量缺口。

### 验收 9 —— retry / subflow / 引用环

**结论：通过。**

- retry 成功：`engine.spec.ts:112-126`，`flakyHandler` 改成读 `nctx.attempt`，前两次失败第三次成功，断言 `attempts=[1,2,3]`、输出 `{attempt:3}`、run completed。第一轮“硬编码 3 次”的测试缺陷已修复。
- retry 上界：`engine.spec.ts:128-143`，`tries:2` 且每次失败，断言 `attempts=[1,2]`、run failed、`NODE_FAILED`。这是新增的严格断言。
- subflow：`semantics.spec.ts:102-119`，父 flow 的 `subflow` 节点执行 child，输出 `{status:'completed',output:{said:'from-child'}}`。
- 并行 subflow 引同一子 flow：`semantics.spec.ts:121-146`，断言 `left/right` 都 completed、输出都是 child 结果；独立探针 S1 也通过：

```text
S1_PARALLEL_SUBFLOW {"status":"completed",
 "nodes":{"l":{"status":"completed"},"r":{"status":"completed"}},...}
```

- 互引用：`engine.spec.ts:67-74` 仍报 `FLOW_REFERENCE_CYCLE`；`service.ts:119-143` 的注册期 DFS 未退化。
- 运行期递归防护已从引擎级 `activeRefs` 改成 per-run `ancestry`（`service.ts:279-297` + `types.ts:111-118`），第一轮“并行 subflow 误报 cycle”已修复。
- 注意：F2 的 fail-fast + subflow 兄弟问题属于 #3，不是 #9 的“subflow 能执行”失败；但它是同一 `runSubflow` 的另一个分支，修复时应一并改。

### 验收 10 —— mocks

**结论：通过。**

- `engine.spec.ts:96-110`：`mocks:{a:{attempt:99}}`，断言 `a.output={attempt:99}`、`attempts.length===0`、下游 `b` 仍执行。
- 代码路径：`flow-engine/src/registry.ts:149` 在进入执行/重试前直接 `settle(deps,nodeId,deps.mocks[nodeId])`。
- 覆盖充分证明“不执行 + 直接产出”。测试仍没有让下游从 `${a.out}` 读 mock 值（b 没有 input 映射），建议补一个下游读取断言，但不是本条失败。

### 验收 11 —— 同验收 5（prompt 重复项）

**结论：通过。**

- 证据同 #5：`composition.spec.ts:91-106` + 独立 fiber.dispose 探针 E2。
- prompt 第 5 和第 11 条文字相同，是 prompt 重复，不是新增要求。

### 验收 12 —— 全部 spec 并发通过 + dispose 无泄漏

**结论：通过。**

- 递归命令 `pnpm -r --no-bail --filter "./packages/graph/*" test` exit 0，78 个 spec 全绿（见 §1.2）。
- `flow-api` 现有 6 个测试，第一轮“flow-api 无测试导致门禁 exit 1”已消失。
- HMR 生产实现：`flow-engine/src/registry.ts:33-49` 的 disposer 现在校验 `current.get(version) === handler`；`registry.spec.ts:47-57` 用生产 `NodeRegistryImpl` 断言旧 disposer 返回 false 且新 handler 仍在。独立探针 R1：

```text
R1_HMR {"oldResult":false,"afterOld":true,"newResult":true,"afterNew":"undefined"}
```

- `registerNodeHandler` 的 helper 路径：独立探针 H1 使用生产 registry + 两个真实 fiber：

```text
H1_HELPER_HMR {"before":true,"afterOld":true,"afterNew":false}
```

- 引擎内置节点卸载：独立探针 E1：

```text
E1_BUILTIN_DISPOSE {"before":[["noop",true],["fail",true],["echo",true],["subflow",true]],
 "after":[["noop",false],["fail",false],["echo",false],["subflow",false]]}
```

- 其余 dispose 测试：`registry.spec.ts:72-91`、`node-tool.spec.ts:145-163`、`graph-tools.spec.ts:144-149`、`yaml.spec.ts:96-104` 均通过。
- 测试质量残余（不推翻本条）：
  - `composition.spec.ts:98` 和 `node-tool.spec.ts:138` 仍用 `ctx.registry.delete(...)` 而不是 `fiber.dispose()`；独立 E2 已证明真实 fiber 路径也对。
  - `graph-tools.spec.ts:80` 在根 ctx 上 `registerNodeHandler(ctx, slowHandler)` 后没有卸载；每个测试新建 Context，不会跨测试污染，但“无泄漏”叙事仍不完整。
  - 引擎内置节点卸载没有专门的 committed 测试，只有独立探针 E1；建议补一条。
  - `flow-storage` 的 domain close 没有卸载测试；不影响本轮 12 条的核心结论。

---

## 3. 测试是否被放松？

结论：**没有发现实质放松，反而多处更严格。**

具体更严格的地方：

1. `kernel.spec.ts:52-75`：`peak <= 2` → `peak === 2`，串行实现不再能过。
2. `cancel.spec.ts:40-67` / `69-94`：用 gate 等 executor 真正启动；覆盖“取消期间 reject 不记 failed”。
3. `cancel.spec.ts:96-137`：sibling 从瞬时任务改成 80ms 长任务，断言 `elapsed>=80`；事件从 `toContain` 改成 `toEqual(['error:bad','end:failed'])`。
4. `semantics.spec.ts:17-57`：flow 层精确事件序列 `['flow-start','start','node-error:bad','end:failed','flow-end:failed']`，并断言 sibling 没有 `error`。
5. `semantics.spec.ts:59-98`：mid-run cancel 等 gate，断言全部 `cancelled` 且无 node-error。
6. `engine.spec.ts:112-143`：retry 断言 `nctx.attempt` 序列 `[1,2,3]`，并新增 `[1,2]` 上界测试。
7. `registry.spec.ts:47-57`：新增生产 registry 的旧 disposer 不删新 handler 测试。
8. `semantics.spec.ts:121-146`：新增并行 subflow 同子 flow 测试。
9. `yaml.spec.ts:64-104`：`setTimeout(10)` → 轮询；新增 fiber 卸载注销测试。
10. `storage.spec.ts:89-100`：新增晚到 FlowStorage 能力测试。
11. `node-tool/real-flow.e2e.ts:115-123`：新增 `FlowStorageToken` 就绪等待；3 次 e2e 均通过，旧 ENOENT 已消失。

仍存在的覆盖缺口 / 测试弱点：

1. **fail-fast + subflow 兄弟没有测试**：`semantics.spec.ts:17-57` 只覆盖 slow handler；F2 证明 subflow 路径仍失败。这是本轮判 #3 不通过的直接依据。
2. `flow-api.spec.ts:118-136` 的 HMR 测试用的是测试内自造的 `createRegistry`（同文件 28-56），不是生产 `NodeRegistryImpl`；生产实现由 `registry.spec.ts:47-57` 覆盖，因此聚合结果不是假绿，但该测试本身的 HMR 证明力有限。
3. `composition.spec.ts:98`、`node-tool.spec.ts:138` 用 `ctx.registry.delete` 模拟卸载，不是 fiber.dispose；独立 E2 补证。
4. `graph-tools.spec.ts:80` 根 ctx 注册不清理；测试局部的泄漏。
5. `engine.spec.ts:238-259` 的 getRun cancel 仍然是“启动前 cancel”的退化路径；mid-run cancel 由 `semantics.spec.ts:59-98` 覆盖，所以不是无覆盖，但该单独用例仍弱。
6. `errorBranch` 的两条残余缺口（无端口校验、失败节点记 completed）没有测试。
7. 三个 `passWithNoTests` 空 e2e：输出 `No test files found, exiting with code 0`，是诚实的空套件，但不能算 e2e 覆盖。
8. 状态机“全迁移路径”仍没有直接断言：`kernel.spec.ts:176-194` 的测试名说 exposes `RunStatusToken`，实际只检查了 `runCtx.graphId` / `signal.addEventListener`，没有调用 `setStatus`；也没有测试观察 `pending → ready → running` 的中间态。验收 #1 只要求最终状态，所以不推翻本条，但这是交付里“状态机全迁移”叙事的覆盖缺口。
9. `README.i18n.yaml` / 中文文件名 / `.ts` 导入后缀等交付项见 §4，不属于测试放松，但仍未完全对齐 prompt。

---

## 4. 交付面核验

### 4.1 包名 / 产物 / exports

| 检查项 | 结果 |
|---|---|
| 包名 | 7 个可安装包全部 `@deepseek-ai/dsh-graph-*`；`bundle` 为 `@deepseek-ai/dsh-graph-bundle` |
| `main` / `types` | 全部 `lib/index.js` / `lib/index.d.ts` |
| `exports` | 全部含 `.` 与 `./types`；`./types` 指向 `lib/types.js` / `lib/types.d.ts` |
| `./types` 可解析 | 7/7 `lib/types.js` 存在；从各包 cwd 执行 `import('@deepseek-ai/dsh-graph-*/types')` 均成功（空类型模块，`Object.keys` 为 0） |
| `files` | 7 个包均为 `["lib"]`；`bundle` 为 patch/tarballs/README*/LICENSE |
| 旧 `dist/` 引用 | `packages/graph` 内无 `dist/`、`"dist"`、`./dist` 引用 |
| 旧 `@veren/graph-*` 引用 | `packages/graph`、`plugins`、`apps`、`pnpm-lock.yaml` 的文本搜索无匹配 |
| 旧 tarball | **残留 5 个旧包 tarball**（flow-api/flow-engine/flow-storage/graph-core/node-tool），内容仍是 `@veren/graph-*` + `dist`；被 `.gitignore` 的 `*.tgz` 忽略、未跟踪，但如果按整个工作区交付会自相矛盾，应删除 |
| bundle tarballs | 7 个新 `deepseek-ai-dsh-graph-*.tgz`，内部 package name/ main/ exports 均为新形态，无旧引用；`bundle/package.json` 的 9 个 file: 依赖全部存在 |
| `bundle/cordis.patch.yml` | 全部指向新包名 |

### 4.2 lockfile

- `pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only` exit 0，lockfile 未变化。
- 逐包比对 dependencies/devDependencies vs importer specifier，7 个包全部 OK。
- `peerDependencies` 不出现在 pnpm importer 中（v9 lockfile 的正常形态），frozen install 通过。
- lockfile 无旧 `@veren/graph-*`。

### 4.3 文档 / LICENSE

| 检查项 | 结果 |
|---|---|
| `README.md` | 8/8 存在，包名已更新为新名 |
| 中文 README | 8/8 是 `README.cn.md`；`README.zh.md` **0/8**。AGENTS 写的是 `.cn.md`，prompt 写的是 `.zh.md`，design §2 自己承认两者冲突并以仓库现状裁决；本轮修复方选择保留 `.cn.md`，算仓库约定，但与 prompt 字面仍不一致 |
| `README.i18n.yaml` | 8/8 存在、可被 YAML 解析、非空（每份 10 行）；但内容只是 `package/default/readme/scope` 语言索引，映射 `zh: README.cn.md`，不是 prompt 所说的“怎么用”使用说明。存在性通过，内容深度不足 |
| 英文 description | 7/7 可安装包 + bundle 都是英文 `Use when …` 句式；无中文正文（个别中文标点不算） |
| MIT LICENSE | 8/8 都存在，内容 MIT；`tools`、`bundle` 已补齐 |
| README 非目标 | graph-core / flow-engine 仍有 `Non-goals (phase 2)`；一期范围没有被扩大 |

### 4.4 源文件 / 行数 / 类型

| 检查项 | 结果 |
|---|---|
| 单包源文件 ≤5 | 通过：graph-core 5、flow-engine 5、flow-storage 4、flow-yaml 3、flow-api 2、node-tool 2、tools 3 |
| 单文件 ≤300 | 通过：`flow-engine/src/service.ts` 实测 **299** 行（修复报告说 292，数字不准，但仍 ≤300）；`graph-core/src/scheduler.ts` 292；测试最大 `engine.spec.ts` 260；无文件超 300 |
| `src/types.ts` 只放类型 | 通过：7 个 `types.ts` 的运行时声明扫描为 0；均为 interface/type/declare module |
| 禁止 default export | 通过：源码 0 个 `export default`（只有 vitest 配置的标准 default） |
| 本地导入 `.ts` 后缀 | **未对齐**：源码仍全部 `.js`（如 `service.ts:13-16`、`registry.ts:13-26`）。AGENTS 要求 `.ts`；当前 tsconfig 没有 `allowImportingTsExtensions`，改 `.ts` 会与 `tsc` 冲突，属于规范冲突而非编译错误 |
| 包结构 | 7 个可安装包 + `bundle`，仍多于 prompt 的 5 个（node-tool/tools/bundle 是扩展）；不是功能错误，但验收范围要写清 |

### 4.5 文档 / 设计 / 实现冲突（仍未解决）

| 冲突点 | 状态 |
|---|---|
| `graph/node-pre-execute` 返回 false 跳过 vs 真值否决 | **仍未解决**：prompt/design 写 false；实现/README 是真值否决（`scheduler.ts:246-254`，Cordis `isBailed`）。第一轮已记录，本轮未改 |
| flow 层 `ctx.extend({flowId})` 黑板作用域 | 仍未落地：实际是独立 `FlowBlackboard` Map（`runtime.ts:69-76`），node ctx 仍是 kernel run ctx（`registry.ts:197-206`） |
| `NodeRegistry.register(type, handler)` vs `register(handler)` | 仍未改：`registry.ts:33` |
| flow 事件都带黑板快照 | 仍只有 `flow/run-end` 带（`service.ts:257`）；`flow/run-start` 只带 input |
| errorBranch 端口校验 / 失败节点可观测性 | 仍未改（§2 验收 8） |
| `README.zh.md` vs `README.cn.md` | 仍未统一；本轮按仓库约定保留 `.cn.md` |
| `.ts` 本地导入后缀 | 仍未改 |
| `passWithNoTests` | 3 个空 e2e 显式空套件通过；诚实但没有覆盖 |

---

## 5. 总评

**普通 flow 路径已经从“不能当地基”修到“基本可用”：** 12 条里 11 条通过；cancel、HMR、flow-api 门禁、并行 subflow、node-tool e2e 都真正修好了，78 个 spec 并发绿、build 绿、真实 e2e 绿。

**但 fail-fast + subflow 兄弟仍是地基级缺口：** 引擎自己的 `runSubflow` 把 fail-fast 的 abort 当成取消，导致 subflow 兄弟被取消、多出 `node-error`。这与验收 #3 的“兄弟分支跑完”直接冲突，而修复方的 `semantics.spec` 只测了 slow handler 兄弟，没有测 subflow。

所以现在**不敢无条件地把它当通用地基继续盖**：修掉 `runSubflow` 的 `isExternalCancel` 判断并补一条 fail-fast + subflow 测试之后，可以比较有把握地继续；在此之前，至少不要在一个 flow 里把 subflow 当 fail-fast 兄弟使用。
