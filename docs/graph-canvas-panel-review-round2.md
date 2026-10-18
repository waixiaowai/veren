# flow-canvas-panel 第二轮验收（刷新修复 + ownerCtx + 安全事件）

- 对象：`packages/graph/flow-canvas-panel`、`flow-canvas-node-echo`，以及 graph-core/flow-engine/flow-canvas 的 `ownerCtx` 改动。
- 方式：只读检查 `~/.dsh` 与 3080；自己在隔离 test node 起 3097；CDP 真做运行中整页刷新；独立 probe 重跑核心语义与 Remote 调用者上下文；对照 README/`README.i18n`；复跑 11 包 build、161 spec。
- 边界：没有写 `~/.dsh`、没有碰 3080；3097/Chrome/临时 probe/临时 tarball 已清理；未改源码与测试；前七份报告未改。

---

## 0. 结论速览

| 维度 | 结论 | 证据 |
|---|---|---|
| 安全事件 | **无残留，3080 未受影响** | `.dsh/profiles/desktop` 与 `web` 的 package/lock 无 graph/panel/destiny 依赖；desktop package mtime `10/16 15:44:26`、lock `15:43:41`，web package `8/14 08:24:34`；无 3 小时内新写入；3080 仍 PID 16080（16:00 启动）。 |
| 刷新修复 | **通过** | 自己起 3097；运行中整页刷新后 flow 列表自动恢复，sessionStorage 保留同一 runId，面板重新 subscribe 并继续显示 `运行中…`；stale runId 自动丢弃且不把面板打成 error；多订阅者测试 2/2 通过。 |
| 数据面 ownerCtx | **通过** | 子 context（模拟 Remote 调用）启动 run 时 owner 上的 `graph/node-status` 与 `flow/node-status` 都收到完整序列，且顺序一致；cancel/fail-fast/subflow/errorBranch/skipReason 全部回归通过。 |
| 文档/摘要 | **通过** | 摘要文案已改成“干净完成 / 兜底”；panel/echo 的 `README.i18n.yaml` 存在且 YAML 可解析，`files` 包含；但 3080 recipe 仍缺 graph bundle 安装步骤。 |
| 3080 recipe | **不能原样照抄** | `pnpm pack` 能产出 0.1.9 tarball；但 README 明说 profile 必须先有 graph bundle 目录及 overrides，而当前 `~/.dsh/profiles/desktop` 没有 graph bundle。只装 panel 会缺 `graphFlowCanvas`/engine 服务。 |
| 回归 | **通过** | 11 包 build exit 0；递归 test exit 0，**161 spec**；旧 104 + 旧 4780 25 保留；panel 28、echo 2、graph-core 19、flow-canvas 18。 |

**总评：ownerCtx 修法没有伤已通过语义；刷新恢复是真的；安全事件没有留下 graph/panel 依赖。可以装 3080，但必须先补 graph bundle 目录/overrides，并且在桌面完全退出后写 profile。**

---

## 1. 安全事件核实（第一优先）

### 1.1 `~/.dsh` 当前状态

检查了 `C:\Users\imeep\.dsh` 的 desktop/web profile：

| 检查 | desktop | web |
|---|---|---|
| `package.json` mtime | **2026-10-16 15:44:26** | **2026-08-14 08:24:34** |
| `pnpm-lock.yaml` | 存在，mtime 2026-10-16 15:43:41 | 不存在 |
| `node_modules` | 存在（正常 desktop 依赖） | 不存在 |
| graph/panel 依赖 | **无** | **无** |
| `destiny-ai`/`flow-canvas` 字样（package/lock/cordis） | **无** | **无** |
| 3 小时内新写入 | 没有发现 | 没有发现 |
| 孤立 tarball | 没有发现 | 没有发现 |

desktop 的 dependencies 是正常的 desktop 依赖（dsh-base/web-app/subagent/person-agent 等），不含 `@deepseek-ai/dsh-graph-*`、`flow-canvas-panel`、`flow-canvas-node-echo`、`destiny-ai`。

web profile 的 `package.json` 只有：

```json
{
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}
```

没有 lockfile、没有 node_modules，也没有 graph/panel。

### 1.2 3080 是否被影响

```text
127.0.0.1:3080  LISTEN  PID 16080
node --import tsx/esm apps/cli/src/bin.ts web --port 3080 --no-open
CreationDate 2026/10/17 16:00:51
```

**3080 仍是原 PID 16080**，启动时间早于事故时段；没有替换、没有重启。`~/.dsh/profiles/desktop/package.json` 的最后修改时间是 15:44，事故发生在之后，未变。

### 1.3 结论

一次丢了 `DSH_HOME` 的 pnpm 可能让进程短暂读取了默认 `~/.dsh` web profile，但**没有留下 graph/panel 安装**：web profile 仍是空依赖、无 lockfile；desktop 没有 graph/panel；没有孤立 tarball；3080 未受影响。安全事件没有造成 profile 污染。

---

## 2. 刷新修复独立验证（3097）

### 2.1 自己起 3097

3097 没有现成进程；用隔离节点：

```powershell
$env:DSH_HOME='C:\Users\imeep\.dsh_test_flow_canvas_fresh'
node --import tsx/esm apps/cli/src/bin.ts web --port 3097 --no-open
```

自己起的 PID 51600，stdout：

```text
dsh web: http://127.0.0.1:3097/?token=...
```

安装的面板 client 里能看到 `LIST_RETRIES=8`、`sessionStorage`、`resume`、`STORAGE_KEY='dsh.flow-canvas.view'`，不是旧代码。

### 2.2 运行中整页刷新

CDP 步骤：

1. 打开 Flow 画布，选 `canvas-demo-pacing`；
2. 点运行，等 sessionStorage 出现 runId；
3. `Page.reload`；
4. 再打开面板，不手动点刷新。

结果：

```text
savedBefore:
{"flowId":"canvas-demo-pacing","runId":"9a859c5f-da14-439f-815b-bd3b2dd823a8"}
runningBefore: true

after reload:
options: ["canvas-demo","canvas-demo-pacing","canvas-demo-predicate"]
saved: 同一 runId
statusLine: "运行中…"
summary: "运行 运行中 · 干净完成 1 · 兜底 0 · 失败 0 · 跳过 0"
start: 完成；gate: 运行中
hasError: false
```

关键点：

- **列表自动恢复**：没有点“刷新”，3 个 flow 自动出现；`LIST_RETRIES=8` 的冷启动重试生效。
- **同一 runId 续订**：sessionStorage 的 runId 没变，没有新开 run；状态从刷新前继续推进（start completed → gate running）。
- **stale run 不报错**：把 sessionStorage 改成 `{flowId:'canvas-demo', runId:'stale-run'}` 后刷新，面板保留 flow、run 变 undefined，sessionStorage 里 stale runId 被移除，页面没有 error。
- **多订阅者**：panel `subscription.spec.ts` 2 条独立通过（一个 subscriber abort 只移除自己的 listener；共享 projection 不被 dispose；后挂载的 subscriber 能拿 final snapshot）。代码 `runFrames` 的 finally 只 `unsubscribe()`/移除 abort listener，不再 `projection.dispose()`。

**没有复用对方 shot-07/08/09/10 当证据**；以上来自我自己的 3097/CDP。

---

## 3. 数据面 ownerCtx 回归（最重要）

### 3.1 修改内容

`GraphKernelService`、`FlowEngineService`、`FlowCanvasService` 各保存构造期 `ownerCtx`：

- kernel `run()` 用 `ownerCtx` 建 run 子 context；
- engine 的 `flow/node-status`、`flow/run-start*`、`flow/run-end`、storage/log 用 `ownerCtx`；
- canvas `watch()` 用 `ownerCtx` 挂 `flow/node-status` 监听。

公开方法签名/返回形状未改；`ownerCtx` 是 private。

### 3.2 独立 probe：核心语义

```text
CORE
cancel:
  status cancelled
  slow cancelled / never cancelled
failFast:
  status failed
  bad failed
  sibling completed
  down skipped / upstream-failure
  graphErrors: bad (no sibling error)
parent (fail-fast + subflow sibling):
  bad failed
  child completed
  down skipped / upstream-failure
recovered:
  status completed
  gate completed
  gate.recovered {code:NODE_FAILED,message:node failed}
  normal skipped / upstream-condition
  topLevelError: absent
getRun detail keys: flowId,nodes,result,runId,startedAt,status
```

逐项对照：

- **cancel 后全 cancelled**：`slow`/`never` 都是 `cancelled`，没有 failed。
- **fail-fast 兄弟 completed**：sibling `completed`，down `skipped/upstream-failure`；没有 sibling 的 `graph/node-error`。
- **fail-fast + subflow 兄弟**：subflow 节点 `child` completed，父 bad failed，down skipped。
- **errorBranch recovered**：gate 仍 completed，带 `recovered`；normal 默认边 skipped/upstream-condition；顶层 `error` 不存在。
- **skipReason**：上游失败/条件不满足都保留。
- **事件序列**：graph 和 flow 的 status 序列都完整；没有因 ownerCtx 改动改变内容/顺序。

### 3.3 独立 probe：Remote 调用方上下文

用一个 child context 模拟 Remote 调用（在 child fiber 内 `scope.get(FlowCanvasToken).run('owner-flow')`），在 **root/owner context** 上监听：

```text
OWNER
status: completed
rootGraph: ["a:pending","a:ready","a:running","a:completed"]
rootFlow:  ["a:pending","a:ready","a:running","a:completed"]
sameOrder: true
```

owner 上的 graph/flow 监听都收到完整序列且顺序一致。修复确实只改“事件归属”，没有改事件内容/顺序；`getRun` 的新 `nodes` 形状也正常，旧 `status/result` 字段仍在。

### 3.4 公开 API 形状

- `FlowEngineService.getRun` 增加 `nodes`，旧 `status/result` 未删；类型/返回结构是加法。
- `FlowCanvasService.watch/run`、`FlowEngineService.run/cancel/registerFlow` 签名未变。
- `GraphKernelService.run` 签名未变。
- 161 spec 中旧测试全部保留，新增 graph-core 19、flow-canvas 18、panel 28、echo 2。

结论：**ownerCtx 修法通过；没有伤害已通过语义。**

---

## 4. 文档 / 摘要 / recipe

### 4.1 摘要文案

`locales.ts` 已改为：

```text
运行 {status} · 干净完成 {clean} · 兜底 {recovered} · 失败 {failed} · 跳过 {skipped}
```

浏览器终态/运行中显示 `干净完成 1 · 兜底 0`，不再把 recovered 混进普通 completed。上一轮指出的口径已修正。

### 4.2 README 三件套

panel 和 echo 都有：

```text
README.md
README.cn.md
README.i18n.yaml
```

YAML 解析结果：

```text
panel: package=@deepseek-ai/dsh-graph-flow-canvas-panel, en=README.md, zh=README.cn.md, steps=4/4, reviewed=2026-10-17
echo:  package=@deepseek-ai/dsh-graph-flow-canvas-node-echo,  en=README.md, zh=README.cn.md, steps=4/4, reviewed=2026-10-17
```

两个 package.json 的 `files` 都包含 `README.md`、`README.cn.md`、`README.i18n.yaml`。**文档缺口已收口。**

### 4.3 3080 recipe：不能原样照抄

panel README 的 install 段：

```powershell
pnpm --dir packages/graph/flow-canvas-panel pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-panel-0.1.9.tgz
```

我实测 `pnpm --dir ... pack` 成功，产出 `deepseek-ai-dsh-graph-flow-canvas-panel-0.1.9.tgz`（721,754 bytes）。但 README 同时写明 **profile 必须先有 graph bundle 目录和 overrides**；当前 `~/.dsh/profiles/desktop` 没有 graph bundle，只有普通 desktop 依赖。也就是说：

- **只照抄两条 panel 命令不够**：3080 缺 `@deepseek-ai/dsh-graph-bundle` 及 graph family，panel 启动后没有 `graphFlowCanvas`/`graphFlowEngine` 服务。
- README 没有给出把 graph bundle 目录 + overrides 装进 desktop profile 的可复制命令；它把这一步写成“profile must already carry”。
- 在干净 test node 上，这个前提是满足的（profile 有 graph bundle 目录和 workspace overrides），所以 test node 能跑；真正的 3080 不是。

**结论：pack 命令可用，panel 安装命令可用；3080 recipe 作为整体不能原样照抄，必须先补 graph bundle 目录/overrides 的安装步骤。**

---

## 5. 回归

### 5.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

11 个包 exit 0。panel client 62.91 kB（gzip 16.68），Host 24.54 kB；echo client 5.86 kB。

### 5.2 test

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，**161 spec**：

| 包 | 数 |
|---|---:|
| flow-api | 6 |
| graph-core | **19（+1 owner-context）** |
| flow-engine | 36 |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas | **18（+1 owner-context listener）** |
| flow-canvas-ui（旧 4780） | 25 |
| flow-canvas-panel | **28（model 11 / host 3 / store 9 / subscription 2 / registration 2 / jsdom 1）** |
| flow-canvas-node-echo | 2 |
| **合计** | **161** |

- 旧 104 数据面 spec 的计数保留：6+18+36+5+4+10+8+17=104；新增 graph-core/flow-canvas 两个 owner 测试后为 106。
- 旧 4780 的 25 spec 原样通过。
- panel 28 / echo 2 全绿；`subscription.spec.ts` 2 条覆盖多订阅者；store 9 条覆盖 reload retry/resume/stale；jsdom 1 条覆盖真实面板行为。

### 5.3 没有旧 spec 被删/弱化

- graph-core 的 cancel/fail-fast 旧断言原样；
- flow-canvas 的 watch/mid-run 旧断言原样；
- flow-engine/flow-api/storage/yaml/tools/node-tool 原样；
- 旧 UI 25 原样；
- 新增测试是加法，没有把旧测试改宽。

---

## 6. 最后直答

**(a) 现在敢不敢把 graph bundle + panel 装进用户真正的 3080？**

**敢装，但不能只照 panel 的两条安装命令装。** 数据面 ownerCtx 回归通过，刷新恢复真实可用，panel/echo 文档与摘要也收口了；但真正的 3080 desktop profile 当前没有 graph bundle，必须先按 graph bundle 的目录依赖 + overrides 把 graph family 装进去，再装 panel，否则 panel 没有 `graphFlowCanvas`/`flowGraphEngine` 服务。

**(b) 装之前是否还必须有桌面完全退出的窗口？这个窗口里做什么？**

**必须有。** `~/.dsh/profiles/desktop` 是活动桌面 profile，桌面进程在跑时写它会有 shared inode ctime 导致白屏的风险。窗口里按验证过的顺序做：

1. 完全退出桌面（含托盘），确认 3080 的 PID 16080 不在监听；
2. 显式设置 `DSH_HOME=C:\Users\imeep\.dsh`（不要靠默认值）；
3. 先把 graph bundle 以**目录依赖**装进 desktop profile，并放置其 overrides（graph-core / flow-engine / flow-canvas / veren 等）；
4. 再装 panel 的 `0.1.9` tarball（可选 echo `0.1.1`）；
5. 冷启动桌面，打开 3080，确认 Flow 画布、三个 flow、运行/刷新恢复；
6. 如果失败，先检查 profile 的 package/lock 与 graph bundle 目录，不要在桌面运行时重装/relink。

**一句话：现在可以装 3080，但先把 graph bundle 目录/overrides 补进 desktop profile，并且只在桌面完全退出、显式 `DSH_HOME` 的窗口里写 profile。**
