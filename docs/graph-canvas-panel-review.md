# flow-canvas-panel 验收（DSH 客户端插件形态）

- 对象：`packages/graph/flow-canvas-panel` + 扩展 `packages/graph/flow-canvas-node-echo`。
- 方式：对照 `ui-plugin.md` / `ui-jobs`，检查 `package.json`、tsx、client bundle、槽位/清理；在隔离测试节点 `C:\Users\imeep\.dsh_test_flow_canvas` 自己起 3098，真点 GUI；自己写临时 `noop` 渲染器插件安装/卸载；grep/契约检查；复跑 11 包 build、153 spec。
- 边界：没有改 `~/.dsh`，没有动 3080（PID 16080 仍在）；临时 `noop` 插件、tarball、Chrome、3098 进程和本轮日志已清理；未改前七份报告。

---

## 0. 结论速览

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 标准性 | **基本通过** | `exports["./client"]`、`dsh.client`、tsx 源、`lib/client.js` 的 `window.__ModuleLoader__.load` 工厂、无 `document.body`/第二应用/重复 React；`main` keyed/root + `sidebar.panellist` list/root + `flow.canvas.node` keyed/root；locale 走 `ctx.effect`。 |
| 真在 GUI | **通过** | 自己在隔离测试节点起 3098（旧 PID 50632 先停），侧栏“Flow 画布”打开面板；paced 运行中 `运行中…` 可见；运行中切走再切回状态仍在；终态/输出/摘要正确；无刷新标记保持。 |
| 扩展点 | **通过（我独立写插件验证）** | 临时写了一个只注册 `noop` 的 `@deepseek-ai/dsh-graph-flow-canvas-node-review-noop`，安装后 start/join 显示 `REVIEW-NOOP`；卸载重启后回落默认卡。第一次 tarball 因我自己的 patch 注释吞了 `- insert` 行而没加载，修好 patch 后通过——不是面板扩展点的失败。 |
| 契约 | **基本通过，有 reload caveat** | 浏览器 store 只调 `list/project/run/subscribe`；`src` 没有 `flow/node-status`/内核事件；output 来自 `snapshot.result.nodes[id].output`；`withChange` 生成新 nodes 映射；SPA 内关闭/重开保持运行订阅。**整页刷新后首次 flow 列表为空，需要点“刷新”才恢复，且运行中的 run 不会自动续订。** |
| 边界 | **通过** | 3098 是本次起的进程，`DSH_HOME=C:\Users\imeep\.dsh_test_flow_canvas`；3080 原 PID 16080 未动；没有对 `~/.dsh` 执行插件安装。 |
| 回归 | **通过** | 11 包 build exit 0；递归 test exit 0，**153 spec**；旧 104 + 旧 4780 25 保留；面板 22、扩展 2、jsdom 1 全绿。 |
| 包规范 | **部分通过** | description/无前端依赖/双语 README 通过；**缺少 `README.i18n.yaml`**；旧“≤5 源文件”不适用于 DSH UI 客户端插件（DSH 自己的 ui-workspace 24、ui-goal 11），面板 17 个 ts/tsx（+1 CSS）不应机械判死。 |

**总评：形态是 DSH 客户端插件，不是独立页面；扩展点真实可用；能装进 3080。装之前最小要补的是“整页刷新/重新打开后的首次 flow 列表为空”这个恢复问题（以及顺手补 README.i18n）。**

---

## 1. 标准性硬核对

### 1.1 package.json / 产物

对照 `ui-plugin.md` 和 `ui-jobs`：

| 项 | 结果 | 证据 |
|---|---|---|
| `exports["./client"]` | 是 | panel `package.json` 有 `"./client": { types, default: "./lib/client.js" }` |
| `dsh.client.platform` | 是 | `"platform": "web"` |
| `dsh.client.inject` | 是 | 列出 `dsh-api-gateway`、locale、layout、renderer、sidebar、slots |
| `dsh.bundle.patch` | 是 | `./cordis.patch.yml`，一行 panel Loader row |
| 主入口/类型 | 是 | `main: lib/index.js`，`types: lib/types/index.d.ts` |
| tsx 源 | 是 | `Panel.tsx`、`FlowGraph.tsx`、`Inspector.tsx`、`DefaultNodeCard.tsx`、`panel-plugin.tsx` |
| client bundle 形态 | 是 | `lib/client.js` 首行 `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-graph-flow-canvas-panel", factory: (require) => ... })` |
| React 来源 | 是 | 工厂内 `require("react/jsx-runtime")`，没有 `react-dom`、CDN、UMD 搜索 |
| 不追加第二应用 | 是 | 无 `document.body.appendChild`/`createRoot`；只有 CSS Module 的 `document.head.appendChild(tag)`（样式标签，正常） |
| Host 半 | 是 | `lib/index.js` 是 Node Loader 入口；`FlowCanvasController extends TypertRemoteService`，`@Remote` 四方法 |
| 槽位参数 | 是 | `main`: `{name:'main', key, locale, children:{'flow.canvas.node':{kind:'keyed',scope:'root'}}, inject}`；`sidebar.panellist`: `{name, id, order, locale, label}`；`flow.canvas.node` keyed/root |
| locale 注册/清理 | 是 | `ctx.effect(() => ctx.locale.register(NS,{zh,en}), ...)`；store/controller 也在 `ctx.effect` |
| 卸载清理 | 是 | `PanelPlugin` 的 `slots.inject`/`register` 走 Cordis effect；`apply` 返回 `panel.dispose()` + `remote.$mount` unmount；`FlowCanvasController` 用 effect 清理 projections |

对照 `ui-jobs`：ui-jobs 也是 `exports . + ./client`、`dsh.client.inject`、tsx、`lib/client.js`、`ctx.effect` locale + `ctx.slots.inject/register`；panel 的形态一致。

**结论：形态真实，不是“独立页面套壳”。**

### 1.2 槽位语义

`ui-layout` 的 `main` 是 `{kind:'keyed', scope:'root'}`；panel 用 `ctx.slots.inject('main', () => ctx.slots.register({name:'main', key:PANEL_ID, children:...}))`，并按需声明唯一的子槽位 `flow.canvas.node`。`ui-sidebar` 的 `sidebar.panellist` 是 `{kind:'list', scope:'root'}`；panel 用 `id/order/label` 注册叶条目，没有乱声明 children。扩展 `flow.canvas.node` 是 keyed/root，第三方只需 `key: '<node.type>'`。

这三点与 DSH 的 slot 契约一致；不是把页面塞进 `shell.overlay` 或自己找 DOM。

---

## 2. 真在 GUI：3098 实测

### 2.1 先确认旧进程，再自己起

检查时 3098 已有：

```text
PID 50632
node --import tsx/esm apps/cli/src/bin.ts web --port 3098 --no-open
```

先停掉；然后用：

```powershell
$env:DSH_HOME='C:\Users\imeep\.dsh_test_flow_canvas'
node --import tsx/esm apps/cli/src/bin.ts web --port 3098 --no-open
```

自己起的进程 PID 21700/35388/49160（中间重启安装扩展），stdout：

```text
dsh web: http://127.0.0.1:3098/?token=...
```

浏览器打开 token URL；侧栏出现 **Flow 画布**，点击后主面板显示：

```text
Flow 画布
只读运行视图 · 点节点看输出
Flow [canvas-demo / pacing / predicate]
运行 / 刷新
port: error
默认 · error 时关闭
start noop / gate fail / recover echo / normal echo / fatal fail / join noop
```

### 2.2 点运行、实时状态、无刷新

选 `canvas-demo-pacing`，点“运行”：

```text
运行中…
运行中 · 完成 2 · 兜底 1 · 失败 1 · 跳过 2   (最终)
```

运行中浏览器里可见 `运行中…`，paced fail 节点的 retry 让 running 持续约半秒；页面没有刷新（`window.__panelMarker='alive'` 保留）。终态：

```text
运行 失败 · 完成 2 · 兜底 1 · 失败 1 · 跳过 2
✓ 完成          start
! 完成 · 已兜底 gate  / 已兜底：NODE_FAILED
自定义渲染器    Recovery branch echo 完成
自定义渲染器    normal echo 跳过
✕ 失败          fatal / NODE_FAILED：demo fatal failure
– 跳过          join / 跳过：upstream-failure
```

- 失败红、recovered 琥珀虚线与 `! 完成 · 已兜底`、skipped 的 `skip: ...` 都能在卡片上直接看到。
- **摘要数字口径**：真实 result 里 status 为 completed 的节点是 start/gate/recover = **3**，其中 gate 带 recovered。面板显示 **“完成 2 · 兜底 1”**，即把 recovered 从 clean completed 里拆出来；`2+1=3`，和六个节点总数 6 对得上。若按 status 字面统计是“3 completed (1 recovered)”；面板的口径不是错，但和字面“完成数”不同，建议文案写清“clean completed / recovered”，否则用户会问为什么不是 3。
- **运行中切走再切回**：点侧栏“插件”再点“Flow 画布”，回来后状态行仍是“运行中…”，没有重新开始/丢失订阅。**SPA 内面板重开通过。**
- **整页刷新**：运行中 `Page.reload` 后，再打开面板首次显示“加载中… / 当前 Host 没有已注册的 flow”，point “刷新”后才恢复三个 flow；运行中的 run 没有自动续订（显然也没有 runId 持久化）。这是一个 **reload/首次加载恢复缺口**，不是 SPA 切换问题。

### 2.3 点 gate 看 output

点击 gate：

```text
节点详情
类型 fail
状态 完成 · 已兜底
失败策略 errorBranch
重试 { "tries": 3, "backoffMs": 240 }
耗时 4597 ms
Output
snapshot.result.nodes["gate"].output
{
  "error": {
    "code": "NODE_FAILED",
    "message": "demo recoverable failure"
  }
}
```

失败 fatal 点开显示 `NODE_FAILED: demo fatal failure`，没有 output 时明确说明“该节点没有 output（失败或被跳过时是正常的）”；没有拿 `snapshot.nodes` 里的状态冒充 output。

---

## 3. 扩展点：我自己的 `noop` 插件

没有跑它的 echo 测试，而是在仓库外写了临时插件：

```text
@deepseek-ai/dsh-graph-flow-canvas-node-review-noop
```

- 一个 locale 字典
- 一个 `ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({ name:'flow.canvas.node', key:'noop', locale }, ReviewNode))`
- 没有 Host 行为、没有 Remote

打包后在隔离 test node 安装：

```powershell
$env:DSH_HOME='C:\Users\imeep\.dsh_test_flow_canvas'
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add <review-noop.tgz>
```

重启 3098 后，面板的 `start`/`join`（type `noop`）显示 `REVIEW-NOOP`；`gate/fatal/normal` 仍由面板默认卡渲染。卸载：

```powershell
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web remove @deepseek-ai/dsh-graph-flow-canvas-node-review-noop
```

重启后再看：start/join 回落默认 `○ 等待 / noop`，`REVIEW-NOOP` 消失。**扩展点真的能被第三方插件使用，卸载真的回落。**

第一次临时 tarball 没生效，是我自己的 `cordis.patch.yml` 注释把 `- insert:` 吞进了同一行（YAML 只看到注释）；修正 patch 后正常。这是临时探针的打包错误，不是 panel 的扩展点问题。

HMR/注册清理由 `flow-canvas-node-echo/tests/registration.spec.ts` 覆盖（2 个 spec：register `echo`、dispose 后 entries 清空；字典 key 一致）；panel 的 `registration.spec` 也覆盖槽位注册。

---

## 4. 契约核对

### 4.1 浏览器只调四个 Remote 方法

`store.ts` 的调用只有：

```text
api.list({})
api.project({ flowId })
api.run({ flowId })
api.subscribe({ runId }, signal)
```

`remote.ts` 定义的就是这四个（`flowCanvas/list|project|run|subscribe`）；没有额外 `flowCanvas.events`、`getRun` 或内核方法。`src` grep 不到 `flow/node-status`、`graph/node-status`、`flow/run-*` 的直接订阅。

Host 侧 `FlowCanvasController` 是 `TypertRemoteService` + 四个 `@Remote`；run 状态只来自 canvas projection 的 `subscribe`/`snapshot`，没有直接监听内核事件。**“浏览器不碰内核事件”通过。**“服务端只用 canvas API”要收窄：Host 注册 demo 和 list 还用了 `FlowEngine` 的 `hasFlow/listFlows/getFlow/registerFlow`，但这是公开 engine 面，不是内核事件。

### 4.2 output 只来自 result，且不原地改

- `model.ts` 的 `nodeOutput` 从 `snapshot.result.nodes[id].output` 读；`snapshot.nodes` 没有 output。
- gate 的 inspector 显示 `source: snapshot.result.nodes["gate"].output`；fatal/normal 明确“没有 output 键”。
- `store.withChange` 每次 `{...nodes}` 后替换一个节点，不写回收到的 nodes；`applyFrame` 只发布新 `RunView`。
- panel 的 `model.spec` 11 个 spec 覆盖 output 读取、falsy output、不可用原因、只读 overlay；`store.spec` 覆盖变更不原地改。

### 4.3 运行中重开

- SPA 内“插件 → Flow 画布”切换：状态行保持 `运行中…`，说明插件级 store 和 subscription 没有随面板组件卸载而丢失。
- 整页刷新：run 不续订，且首次 flow 列表为空；点“刷新”后 list 恢复。这个不是 Remote 契约被破坏，而是客户端恢复路径缺失/首载竞态。

---

## 5. 边界 / 3080

- 3098 是自己起的，旧 PID 50632 已停；`DSH_HOME=C:\Users\imeep\.dsh_test_flow_canvas`。
- 3080 仍是原 PID 16080（未停、未改）。
- 没有对 `~/.dsh` 做任何插件安装；所有 `dsh plugin` 命令都显式 `DSH_HOME` 到 test node。test node 的 custom 插件已移除，profile 里的 panel/echo 仍在。
- 没有把 `flow-canvas-ui` 或 panel 装进 3080；本轮只在 test node 试装/卸载。

---

## 6. 回归

### 6.1 build

```powershell
pnpm -r --filter "./packages/graph/*" build
```

11 个包（旧 8 + 旧 UI + panel + echo）全部 exit 0。panel client 产物 `lib/client.js` 59.49 kB（gzip 15.72），Host `lib/index.js` 23.17 kB；echo client 5.86 kB。

### 6.2 test

```powershell
pnpm -r --no-bail --filter "./packages/graph/*" test
```

`EXIT=0`，**153 spec**：

| 包 | 数 |
|---|---:|
| flow-api | 6 |
| graph-core | 18 |
| flow-engine | 36 |
| flow-yaml | 5 |
| flow-storage | 4 |
| node-tool | 10 |
| tools | 8 |
| flow-canvas（旧数据面） | 17 |
| flow-canvas-ui（旧 4780） | 25 |
| **flow-canvas-panel** | **22（model 11 / host 3 / store 5 / registration 2 / jsdom panel 1）** |
| **flow-canvas-node-echo** | **2** |
| **合计** | **153** |

旧 104 数据面 spec 计数不变；旧 4780 的 25 spec 仍原样通过；panel 的 jsdom 端到端 1 条通过（draws flow, streams statuses, opens output, falls back when echo unloads）。

### 6.3 旧 spec 是否原样

- 旧 104 计数：flow-api 6 / graph-core 18 / flow-engine 36 / flow-yaml 5 / storage 4 / node-tool 10 / tools 8 / flow-canvas 17 =104。
- 旧 4780：25。
- 新 panel 22 + echo2 是增量，没有删旧 spec。

---

## 7. 包规范判断

| 项 | 结果 |
|---|---|
| 英文 description | 通过：panel/echo 都有“use when / skip when”英文说明 |
| README.md + README.cn.md | 通过 |
| README.i18n.yaml | **不通过：panel 和 echo 都没有**（旧 UI 有） |
| 无前端依赖污染其它包 | 通过：panel 只 peer `@deepseek-ai/cordis`；React 从 baseline；echo 同样；没有改其它包 |
| ≤5 源文件 | **机械规则不通过：panel 17 个 ts/tsx + 1 个 CSS（共 18 个 src 文件）；echo 5 个 ts/tsx + 1 个 CSS** |
| 单文件 ≤300 行 | panel TS 大多 ≤240；`panel.module.css` 358 行（CSS）；旧规则是否把 CSS 算入需项目自己定 |

**对“≤5 源文件”的判断：不要机械套到 DSH client 插件上。** 我查了 DSH 自己的 client 包：`ui-workspace` 有 **24** 个 ts/tsx，`ui-goal` 有 **11** 个，`ui-jobs` 是 5 个；`ui-plugin.md` 关心的是 package 的 `dsh.client`/`./client` 导出、lazy factory、槽位/清理，不是源文件数。panel 的 17 个 ts/tsx 文件是“一个 feature 的页面 + store + layout + remote + locale + slots”的合理拆分；**这不是本插件的标准性问题**。如果仓库仍要执行旧 ≤5，应把它作为全局规范单独治理，而不是拿它否掉这个 DSH UI 插件。

**真正的小规范缺口是 README.i18n.yaml 缺失**（如果项目要求每个包三件套）。

---

## 8. 这版明确不做什么（与 README 一致？）

README 的 “Solved / Deferred” 与本轮观察一致：

- **做**：静态分层 DAG、条件边标注、运行按钮、实时状态、recovered/skip 区分、点节点 output、只读、扩展槽位。
- **不做**：拖拽/缩放/pan、布局持久化、编辑、取消按钮（handle 暴露但 UI 未放）、搜索/过滤、谓词文本、多 YAML 文件、3080 集成。
- README 明确说布局 browser-owned、无编辑/拖拽/持久化；与代码一致。

---

## 9. 最后直答

**这套画布插件现在能不能装进用户真正的 3080？**

**能装，而且形态是对的：** 它不是独立页面，是带 `dsh.client`/`./client`/tsx/`__ModuleLoader__` 工厂的 DSH client plugin；`main` + `sidebar.panellist` + keyed `flow.canvas.node` 的槽位/清理/locale 都对；test node 上已真实运行；我自己的 `noop` 插件也装/卸成功。

**装之前还差的最小一步：** 修 **整页刷新/重新打开后的首次 flow 列表为空**（现在要手动点一次“刷新”才出现三个 flow；运行中的 run 也不会自动续订）。这是用户会立刻遇到的恢复问题；修完后就可以按 README 的 tarball 步骤装 3080。若只按“面板 SPA 内切走/切回”验收，这一条已经通过。

顺手要补的文档项：panel/echo 的 `README.i18n.yaml` 三件套；这不是功能阻塞。

**最容易在真实画布里再出问题的点：** Host 的 run projection 订阅生命周期与页面重载/断开后的恢复。`FlowCanvasController` 保存 run 投影，但 `subscribe` 的 `finally` 会 `projection.dispose()`；页面刷新、流中断或多订阅者场景下，快照还能读到，但后续 status 不会继续推。这个边界比布局/样式更容易在“真用起来”时暴露。
