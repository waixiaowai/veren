# packages/graph 第三轮验收复核报告（定向收口）

- 复核对象：`packages/graph/` 下 7 个可安装包 + `bundle/` 发布件。
- 复核依据：`flow-engine-prompt.md` 末尾「验收」12 条；前两轮报告 `docs/graph-acceptance-review.md`、`docs/graph-acceptance-review-round2.md` 保持原样。
- 复核方式：只读源码/测试，执行 build 与递归 test；另外在仓库外写独立探针，复现第二轮 F2、F1/K1/H1/S1 和新增的 node-tool `deriveToolSignal` 行为。探针与执行日志已清理。
- 测试环境：Windows / Node v24.13.0 / pnpm 10.28.2 / vitest 5.0.4。
- 结论口径：**通过** = 有独立可复现证据；**不通过** = 仍有硬缺口；**无法判定** = 证据不足。

---

## 0. 结论速览

| # | 验收条目（摘要） | 第三轮结论 | 一句话证据 |
|---|---|---|---|
| 1 | graph-core：拓扑顺序、并发上限、cancel 全部 cancelled、fail-fast 下游 skipped 且兄弟跑完 | **通过** | K1 运行中 cancel（executor 忽略 signal 后自然结束）得到 `slow/down` 均 `cancelled`；`kernel.spec.ts` 并发断言 `peak===2`；cancel.spec 先等真实启动。 |
| 2 | YAML 并行分支加载并注册进引擎 | **通过** | `yaml.spec.ts` 真实 Loader + `waitForFlow`，输出 `L`/`R`；fiber 卸载注销测试通过。 |
| 3 | 并行 → 汇聚 → 一路失败 → fail-fast（下游 skipped、兄弟跑完、flow failed、事件序列正确） | **通过** | F2 一层 subflow：`sub completed`、子 run `completed`、子内部 `slow completed`、`join skipped/upstream-failure`、父 run `failed`、事件精确为 `flow-start → start → error:bad → end:failed → flow-end:failed`、全局 node-error 仅 `bad`。嵌套两层同样通过。 |
| 4 | post-execute waterfall 改写产出，下游黑板读到改写值 | **通过** | `composition.spec.ts:69-89` 仍断言 `up.output={out:'REWRITTEN'}` 且 `sink.output={v:'REWRITTEN'}`。 |
| 5 | 卸载节点插件后再运行 → `NODE_TYPE_NOT_FOUND` | **通过** | `composition.spec.ts:91-106`；真实 fiber.dispose 探针仍得到 `NODE_TYPE_NOT_FOUND`。 |
| 6 | 引用不存在节点的 Edge 注册 → `GRAPH_DANGLING_EDGE` | **通过** | `engine.spec.ts:37-65` 对 dangling 边断言该 code。 |
| 7 | 条件边：false 分支 skipped，true 分支正常执行 | **通过** | flow 级探针：`take completed`、`drop/child skipped/upstream-condition`。 |
| 8 | onError fallback / errorBranch / 未失败时 error 端口不触发 | **通过** | `engine.spec.ts:160-217` 三组通过；errorBranch 的端口校验/失败可观测性仍是残余缺口（见 §5）。 |
| 9 | retry tries=3 前两次失败第三次成功；subflow 可运行；互相引用报 `FLOW_REFERENCE_CYCLE` | **通过** | 重试断言 `attempts=[1,2,3]` 与上界 `[1,2]`；并行 subflow 同子 flow 通过；互引用仍报 `FLOW_REFERENCE_CYCLE`。 |
| 10 | mocks 指定节点不执行、直接产出 mock 值 | **通过** | `engine.spec.ts:96-110` 断言 `attempts.length===0` 且输出 `{attempt:99}`。 |
| 11 | 同第 5 条（prompt 重复） | **通过** | 同 #5。 |
| 12 | 全部 spec 并发通过；dispose 测试证明无注册泄漏 | **通过** | 递归命令 exit 0，**83 个 spec** 全绿；HMR 生产实现、flow-api、内置节点卸载、node-tool/tools/yaml dispose 均通过。 |

**额外修复项核验：**

| 额外项 | 结论 | 证据 |
|---|---|---|
| fail-fast 下一层 subflow 兄弟不再被取消 | **通过** | F2 探针；`subflow.spec.ts:99-146`。 |
| fail-fast 下两层嵌套 subflow 不被取消 | **通过** | F2_NESTED：mid/leaf 均 completed，mid 的 `inner`、leaf 的 `slow` 均 completed。 |
| 外部取消仍传播进 subflow 子 run | **通过** | C1：父 `cancelled`、sub `cancelled`、子 run `cancelled`、子内部 `hold cancelled`、父事件精确 `flow-start → start → end:cancelled → flow-end:cancelled`。 |
| node-tool fail-fast 下工具 signal 从未 abort、工具兄弟 completed | **通过** | T1：`toolSignalAborted=false`、`run completed`、`join skipped`、事件仅 `error:bad`。 |
| node-tool 外部取消时工具收到 abort | **通过** | T2：`sawAbort=true`、`toolSignalAborted=true`、节点 `cancelled`。 |
| F1 普通兄弟 fail-fast / K1 cancel / H1 HMR / S1 并行 subflow 回归 | **通过** | 四个独立探针全部通过（详见 §3）。 |
| 旧 `@veren/graph-*` tarball 清零 | **通过** | `packages/graph` 内旧 graph tarball 数量为 **0**。 |
| bundle tarballs 与 7 个新包名对齐 | **通过** | 7 个 `deepseek-ai-dsh-graph-*.tgz` 的 package name/main 全为 `@deepseek-ai/dsh-graph-*` / `lib/index.js`。 |
| service/runtime/scheduler/subflow LF 行数 <300 | **通过** | node 计数：service 273、runtime 282、scheduler 292、subflow.spec 293。 |
| README.i18n.yaml 8 份可解析且可照着用 | **通过** | 8/8 YAML 解析成功，每份含 `readme` 与 4 条 en/zh `how-to-use` 步骤。 |

**总评：12 条验收全部通过；现在敢在上面盖东西，剩余是 errorBranch 可观测性、README.zh/`.ts` 口径和空 e2e 等非阻塞收尾项。**

---

## 1. 复跑记录

### 1.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

7 个包 `tsc` 全部通过，`EXIT=0`。

### 1.2 递归 spec（声称 83 spec）

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，分项：

| 包 | spec 文件 | 通过数 |
|---|---|---:|
| graph-core | kernel.spec.ts + cancel.spec.ts | 12 + 4 = 16 |
| flow-api | flow-api.spec.ts | 6 |
| flow-engine | registry 6 / composition 3 / engine 14 / semantics 2 / subflow 9 | 34 |
| flow-yaml | yaml.spec.ts | 5 |
| flow-storage | storage.spec.ts | 4 |
| node-tool | node-tool.spec.ts | 10 |
| tools | graph-tools.spec.ts | 8 |
| **合计** | | **83** |

关键输出：

```text
flow-engine: ✓ tests/subflow.spec.ts (9 tests)
flow-engine: Test Files 5 passed (5), Tests 34 passed (34)
node-tool:   ✓ tests/node-tool.spec.ts (10 tests)
EXIT=0
```

### 1.3 e2e

| 包 | 结果 |
|---|---|
| node-tool | **1 passed**（真实 ToolRuntime / 子进程 / storage） |
| flow-storage | **1 passed**（真实 storage） |
| tools | **4 passed**（真实 ToolRuntime） |
| graph-core / flow-engine / flow-yaml | `No test files found, exiting with code 0`（`passWithNoTests` 空套件） |
| flow-api | 无 e2e 配置 |

`node-tool` 真实 e2e 在 `deriveToolSignal` 改动后仍通过，说明工具 signal 的派生没有破坏真实工具调用。

### 1.4 lockfile

```powershell
pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only
```

`EXIT=0`，lockfile hash 未变化。7 个包的 dependencies/devDependencies 与 importer specifier 全部一致；无旧 `@veren/graph-*`。

---

## 2. 逐条验收

### 验收 1 —— graph-core 调度 / cancel / fail-fast

**结论：通过。**

- 拓扑：`graph-core/tests/kernel.spec.ts:28-50` 的 diamond 顺序断言仍成立。
- 并发：`kernel.spec.ts:52-75` 用 `expect(peak).toBe(2)`，串行实现不能过。
- cancel：`cancel.spec.ts:40-67` 先等 `started.open()` 再 cancel；断言运行中节点和未启动下游都是 `cancelled`、下游 `skipReason` 为 undefined。`cancel.spec.ts:69-94` 覆盖“取消期间 executor reject 仍记 cancelled、不记 failed、不发 node-error”。
- 独立 K1（executor 完全忽略 signal，80ms 后自然返回）：

```text
K1_REGRESSION {"status":"cancelled",
 "slow":{"status":"cancelled","output":"late"},
 "down":{"status":"cancelled"}}
```

- fail-fast：`cancel.spec.ts:96-137` 的 sibling 是 80ms 长任务，断言 `sibling completed`、`down/join skipped/upstream-failure`、事件只含 `error:bad` 和 `end:failed`、`elapsed>=80`。第一轮“兄弟被记 failed/FLOW_CANCELLED”已消失。

### 验收 2 —— YAML 并行 flow 加载并注册

**结论：通过。**

- `flow-yaml/tests/yaml.spec.ts:84-94` 真实 Loader + `waitForFlow()`（轮询而非固定 sleep），断言 `hasFlow('yaml-demo')`，运行后 `L`/`R`。
- `yaml.spec.ts:96-104` 新增 fiber 卸载注销 flow 测试。
- `flow-yaml` e2e 仍是空套件，但 flow-storage/tools/node-tool 的真实 e2e 覆盖了组合路径；本条本身通过。

### 验收 3 —— 并行 → 汇聚 → 一路失败 → fail-fast（重点）

**结论：通过。**

修复点：`flow-engine/src/service.ts:248-271` 的 `runSubflow` 现在只在 `isExternalCancel(nctx.signal)` 时取消子 flow：

```ts
const onAbort = (): void => {
    if (isExternalCancel(nctx.signal)) handle.cancel();
};
if (isExternalCancel(nctx.signal)) handle.cancel();
else nctx.signal.addEventListener('abort', onAbort, { once: true });
```

独立 F2 一层 subflow（`bad` 10ms 失败、`sub` 运行 80ms 子 flow、`join` 汇聚）：

```text
F2_ONE_LEVEL {"elapsed":90,"status":"failed",
 "nodes":{"bad":{"status":"failed","error":{"code":"NODE_FAILED"}},
          "sub":{"status":"completed"},
          "join":{"status":"skipped","reason":"upstream-failure"}},
 "parentEvents":["flow-start","start","error:bad","end:failed","flow-end:failed"],
 "allNodeErrors":["error:bad"],
 "childEnds":[{"flowId":"slow-child","status":"completed"}],
 "childInternal":{"slow":{"status":"completed",...}}}
```

F2b 两层嵌套（top → mid → leaf，leaf 内 80ms 慢任务）：

```text
F2_NESTED {"elapsed":93,"status":"failed",
 "nodes":{"bad":{"status":"failed"},"sub":{"status":"completed"},
          "join":{"status":"skipped","reason":"upstream-failure"}},
 "parentEvents":["flow-start","start","error:bad","end:failed","flow-end:failed"],
 "allNodeErrors":["error:bad"],
 "childEnds":[{"flowId":"leaf","status":"completed"},
              {"flowId":"mid","status":"completed"}],
 "midInternal":{"inner":{"status":"completed",...}},
 "leafInternal":{"slow":{"status":"completed",...}}}
```

验收判据逐项对上：

- `sub completed`、无 error：是；
- 子 run `completed`：是（一层 `slow-child`，嵌套 `mid`/`leaf`）；
- 子 flow 内部节点不被记 cancelled：一层 `slow completed`；嵌套 `mid.inner completed`、`leaf.slow completed`；
- `join skipped/upstream-failure`：是；
- 父 run `failed`：是；
- 父事件精确：`flow-start → start → error:bad → end:failed → flow-end:failed`：是；
- 全局 node-error 只有 `bad`：是。

新增 `subflow.spec.ts` 有 9 个用例，其中 3 个 fail-fast/cancel 用例用 `record()` 精确 `toEqual` 父事件和 `allNodeErrors`（`subflow.spec.ts:134`、`184`、`224`）。独立探针与测试结论一致；F2 已真正修复，不是只把测试写绿。

### 验收 4 —— post-execute waterfall 改写产出

**结论：通过。**

- `composition.spec.ts:69-89`：envelope 改成 `{out:'REWRITTEN'}`，`result.nodes.up.output` 与下游 `sink.output.v` 都验证。
- 代码路径：`scheduler.ts:267-277` 触发 waterfall，`service.ts:61-68` 引擎监听器写回黑板。无退化。
- 残余限制：`scheduler.ts:270` 不 await waterfall，异步监听器不支持；类型/README 未承诺异步，属于已知边界。

### 验收 5 —— 卸载节点插件后 `NODE_TYPE_NOT_FOUND`

**结论：通过。**

- `composition.spec.ts:91-106` 仍通过。
- 独立 E2 用真实 `fiber.dispose()`：`status failed`，`node.error.code === 'NODE_TYPE_NOT_FOUND'`。
- 代码路径：`registry.ts:190-196` 每次尝试重新 `registry.get`。

### 验收 6 —— 悬挂边 `GRAPH_DANGLING_EDGE`

**结论：通过。**

- `engine.spec.ts:37-65` 对 `from:'a',to:'ghost'` 断言 `GRAPH_DANGLING_EDGE`。
- 代码路径：`validate.ts:26-39`、`runtime.ts:114-118`。无退化。

### 验收 7 —— 条件边

**结论：通过。**

- 仓库内仍只有 kernel 级正式测试（`kernel.spec.ts:155-173`）；独立 flow 级探针 `FLOW_COND`：

```text
FLOW_COND {"trace":["a","take"],"status":"completed",
 "nodes":{"a":{"status":"completed"},"take":{"status":"completed"},
          "drop":{"status":"skipped","reason":"upstream-condition"},
          "child":{"status":"skipped","reason":"upstream-condition"}}}
```

- 代码路径：`runtime.ts:191-210` 的 `toKernelGraph`。实现正确；仍建议补 flow 层正式测试。

### 验收 8 —— onError fallback / errorBranch

**结论：通过。**

- fallback：`engine.spec.ts:160-174`，`bad` 失败后兜底值 `safe` 流到 `next`，run completed。
- errorBranch：`engine.spec.ts:176-196`，`recover` 经 error 端口完成，`normal` skipped。
- 未失败时：`engine.spec.ts:198-217`，healthy 节点 error 端口不触发。
- 残余缺口（不影响本条验收文字，但仍是交付质量项）：
  - `errorBranch` 失败节点在结果里仍记 `completed`、无 `error`，不发 `node-error`；执行记录无法区分“真成功”和“走了 error 端口”。
  - `compileFlow` 仍不校验“配置 errorBranch 必须声明 error 端口”；独立探针在无 error 边时仍注册成功并 completed。
  - 这两点第一轮已记录，本轮未改；按验收 #8 的文字（错误走 error 端口、未失败不触发）仍判通过。

### 验收 9 —— retry / subflow / 引用环

**结论：通过。**

- retry：`engine.spec.ts:112-126` 读 `nctx.attempt`，断言 `[1,2,3]`；`128-143` 断言上界 `[1,2]`。
- subflow：`subflow.spec.ts:26-43` 普通引用；`45-70` 并行引同一子 flow；均通过。
- 并行引用不再误报：S1 探针 `status completed`、`l/r completed`。
- 互引用：`engine.spec.ts:67-74` 仍报 `FLOW_REFERENCE_CYCLE`。
- per-run `ancestry`（`service.ts:248-253`、`types.ts:111-118`）保留；并行同 child 不冲突。

### 验收 10 —— mocks

**结论：通过。**

- `engine.spec.ts:96-110`：`mocks:{a:{attempt:99}}`，`a.output={attempt:99}`、`attempts.length===0`、下游 `b` 执行。
- 代码路径：`registry.ts:149` 在进入执行/重试前直接 settle mock。
- 测试仍没有让下游从 `${a.out}` 读 mock 值；建议补，但不影响本条。

### 验收 11 —— 同验收 5（prompt 重复项）

**结论：通过。**

- 证据同 #5：`composition.spec.ts:91-106` + 独立 fiber.dispose E2。

### 验收 12 —— 全部 spec 并发通过 + dispose 无泄漏

**结论：通过。**

- 递归命令 exit 0，83 个 spec 全绿（§1.2）。
- `flow-api` 6 个测试，无“空包导致门禁红”。
- HMR 生产实现：`registry.ts:33-49` 身份校验；`registry.spec.ts:47-57` 断言旧 disposer 不删新 handler；R1 探针：

```text
R1_HMR {"oldResult":false,"afterOld":true,"newResult":true,"afterNew":"undefined"}
```

- helper HMR：H1 生产 registry + 真实 fiber：`{"before":true,"afterOld":true,"afterNew":false}`。
- 引擎内置节点卸载 E1：`noop/fail/echo/subflow` 卸载后全部 false。
- 其余 dispose：`registry.spec.ts:72-91`、`node-tool.spec.ts:155-173`、`graph-tools.spec.ts:144-149`、`yaml.spec.ts:96-104` 通过。
- 测试质量残余：
  - `composition.spec.ts:98`、`node-tool.spec.ts:148` 仍用 `ctx.registry.delete` 模拟卸载；独立 E2 证明真实 fiber 路径也对。
  - `graph-tools.spec.ts:80` 根 ctx 注册 slowHandler 后不清理；每个测试新建 ctx，不会跨测试污染。
  - 状态机“全迁移路径”仍缺直接测试：`kernel.spec.ts:176-194` 的测试名说 exposes `RunStatusToken`，实际没有调用 `setStatus`，也没有观察 `pending → ready → running` 中间态。验收 #1 只看最终态，所以不推翻本条，但交付叙事仍偏宽。

---

## 3. 额外修复项与回归

### 3.1 node-tool `deriveToolSignal`

代码：`node-tool/src/index.ts:42-49`：

```ts
function deriveToolSignal(nctx) {
    const controller = new AbortController();
    const forward = () => { if (isExternalCancel(nctx.signal)) controller.abort(); };
    if (isExternalCancel(nctx.signal)) controller.abort();
    else nctx.signal.addEventListener('abort', forward, { once: true });
    return { signal: controller.signal, dispose: () => nctx.signal.removeEventListener('abort', forward) };
}
```

独立 T1（fail-fast 工具兄弟）：

```text
T1_TOOL_FAILFAST {"status":"failed",
 "toolSignalAborted":false,
 "nodes":{"bad":{"status":"failed"},
          "run":{"status":"completed"},
          "join":{"status":"skipped","reason":"upstream-failure"}},
 "parentEvents":["flow-start","start","error:bad","end:failed","flow-end:failed"],
 "allNodeErrors":["error:bad"]}
```

独立 T2（外部取消）：

```text
T2_TOOL_CANCEL {"status":"cancelled","sawAbort":true,
 "toolSignalAborted":true,
 "node":{"status":"cancelled",...}}
```

两条都符合要求：fail-fast 下工具 signal 从未 abort、工具兄弟 completed；外部取消时工具收到 abort。`node-tool/tests/node-tool.spec.ts:175-234` 也有对应测试，断言 `abortedAtEnd=false` / `sawAbort=true`，没有放松。

### 3.2 回归

| 回归 | 探针输出摘要 | 结论 |
|---|---|---|
| F1 普通兄弟 fail-fast | `sib completed`、`join skipped/upstream-failure`、事件仅 `error:bad` | 通过 |
| K1 运行中 cancel（忽略 signal） | `status cancelled`、`slow/down` 均 cancelled | 通过 |
| H1 旧 disposer | `oldResult false`、`afterOld true`、`afterNew false` | 通过 |
| S1 并行 subflow 同子 flow | `status completed`、`l/r completed` | 通过 |
| C1 外部取消 subflow | 父/子 run cancelled、子内部 `hold cancelled`、父事件 `end:cancelled` | 通过 |

### 3.3 收尾事实

- `packages/graph` 内旧 `@veren/graph-*` tarball：**0 个**；只剩 bundle 下 7 个新 graph tarball + 2 个 `@veren/*` 依赖 tarball。
- bundle tarballs 的 package name/main：
  - `deepseek-ai-dsh-graph-core-0.1.0.tgz` → `@deepseek-ai/dsh-graph-core` / `lib/index.js`
  - flow-api / flow-engine / flow-storage / flow-yaml / node-tool / tools 同样匹配。
- LF 行数（node `match(/\n/g)`）：
  - `flow-engine/src/service.ts`：**273**
  - `flow-engine/src/runtime.ts`：**282**
  - `graph-core/src/scheduler.ts`：**292**
  - `flow-engine/tests/subflow.spec.ts`：**293**
  - 全部 `<300`；全包最大 LF 也是 293。
- `README.i18n.yaml`：8/8 可解析；每份含 `package`、`readme.en/zh`、4 条 en/zh `how-to-use`、`naming`、`reviewed`。内容可照着用：先读 `README.md`，中文读 `README.cn.md`，按 usage/configuration 顺序执行，改一侧同步另一侧。
- `README.zh.md` 仍是 0/8；i18n 的 `naming` 明确写本仓库用 `README.cn.md`（AGENTS 约定），与原 prompt 的 `.zh.md` 字面仍冲突，但不再是空壳/缺文件。
- `main/types` 全 `lib/*`，`files` 全 `["lib"]`；`./types` 7/7 可解析；lockfile frozen 校验通过。
- `README.i18n.yaml` 8 份 package 字段与 package.json 全部一致。

---

## 4. 新测试是否放松？

**结论：没有发现“写得更绿但语义不变”的放松。**

更强的地方：

1. `subflow.spec.ts` 9 个用例；3 个 fail-fast/cancel 用例用 `toEqual` 精确断言父事件和 `allNodeErrors`（`134`、`184`、`224`），并检查子 run/子内部节点状态。
2. 一层和两层嵌套 subflow 都有；nested 断言 `mid`/`leaf` 两个 child run 都 completed。
3. 外部取消 subflow 单独用例，断言 child run cancelled、child 内部节点 cancelled、父事件 `end:cancelled`。
4. node-tool 新增 2 个测试：fail-fast 工具 signal 未 abort + 工具 completed；外部取消工具收到 abort。
5. 旧普通 fail-fast/cancel/retry/HMR 断言没有放松；`semantics.spec.ts` 从 8 个变成 2 个，但其余用例移动到 `subflow.spec.ts`，总数从 78 增至 83。

仍需记录的覆盖缺口（非阻塞）：

1. `subflow.spec.ts:148-193` 的 nested 用例只检查 `mid`/`leaf` child run 状态，没有直接检查 `leaf` 内部节点；我们的独立探针补了 `leafInternal.slow completed`。
2. `subflow.spec.ts:99-146` 的 child internal 只检查了一层 `slow`，没有检查 child 里再嵌 subflow 的中间节点（nested 探针补了）。
3. `node-tool.spec.ts:175-213` 的 fail-fast 工具测试只在结束时检查 `abortedAtEnd`，没有在 40ms 中间点采样；signal 不会“反 abort”，所以结论仍成立，但可再加时间点断言。
4. `node-tool.spec.ts:215-234` 外部取消只断言 `sawAbort`，没有精确父事件序列；本轮独立 T2 补了状态。
5. `subflow.spec.ts` 的 nested 用例没有断言 child `mid` 内部 `inner` 的 output；探针有。
6. 三个空 e2e 仍是 `passWithNoTests`，输出 `No test files found`；诚实空套件，但不算覆盖。
7. `errorBranch` 无端口校验、失败节点记 completed 仍无测试/未修。
8. 状态机中间态（pending/ready/running）仍无直接测试。

这些是覆盖增强项，不是本轮 12 条验收的失败。

---

## 5. 仍然存在的非阻塞缺口

| 项 | 状态 | 影响 |
|---|---|---|
| errorBranch 失败节点记 `completed`、无 `error`、不发 node-error | 未修 | 逐节点执行记录无法区分“真成功”和“走 error 端口”；建议后续把失败事实保留在 record 里。 |
| errorBranch 无 error 端口仍允许注册 | 未修 | misconfiguration 不 fails loud；设计说“声明了端口才可配”。 |
| `graph/node-pre-execute` false vs truthy | 未修 | prompt/design 写 false，实现/README 是 truthy 否决；文档与实现口径仍冲突。 |
| flow 黑板 `ctx.extend({flowId})` | 未实现 | 实际是独立 FlowBlackboard Map；数据传递可用，但 context 作用域承诺未落地。 |
| `NodeRegistry.register(type, handler)` | 未改 | 实际 `register(handler)`；API 与 prompt 不一致。 |
| `README.zh.md` | 0/8 | 仓库用 `README.cn.md`，i18n 已说明命名；与原 prompt 字面冲突。 |
| 本地导入 `.ts` 后缀 | 未改 | 仍 `.js`；当前 NodeNext tsc 构建可行，但与 AGENTS/prompt 字面冲突。 |
| 空 e2e | 3 个 `passWithNoTests` | 诚实空套件，但不提供覆盖。 |
| 状态机中间态 / RunStatusToken | 无直接测试 | 内核 `setStatus` 能力没有被测试实际调用。 |

---

## 6. 总评

**现在敢在上面盖东西。**

第三轮最关键的 #3 已经用独立探针复现并确认修复：一层 subflow、两层嵌套 subflow 的 fail-fast 兄弟都自然完成，父事件精确、全局 node-error 只有 `bad`；外部取消仍正确传播进子 run；node-tool 的 fail-fast/外部取消 signal 语义也符合要求；F1/K1/H1/S1 回归全过；83 个 spec、build、真实 e2e 都是绿的。

剩余的 errorBranch 可观测性/端口校验、README 命名与 `.ts` 后缀口径、空 e2e 和状态机中间态测试，都是收尾与二期前应该补的质量项，不阻塞当前 12 条验收的“可当地基”判断。
