# prompt-page-render 减法实施 —— WIP 交接（2026-10-22）

方案：`docs/prompt-page-render-design.cn.md`（v2）。本文记录实施进度与剩余步骤。
方向已按用户修正：**做减法**——组件管线是唯一路径，旧块管线整体删除，不做双轨兼容。

## 已完成（全部有测试）

- **prompt-core（C1–C4）**：`hooks.ts`（useState/useMemo/useSlot/useContext/createContext/
  runWithHookScope，调用序守卫内置 = C6 的运行期面）；reconciler 假值/文本规范化（C1）、
  宿主 children 对账（HTML 结构树）、组件第二参数 ctx 透传、root.refresh 通道；
  memo bailout 槽位保留（C3）。测试 23/23 + typecheck 干净。
- **prompt-page（C5）**：`markdown.ts`（fiber 树 → Markdown，§3.2 映射表 + 转义 +
  单元 diff + `MarkdownDocHost`）；`component.tsx`（`defineComponentPage` 适配器、
  `PageFC`、组件 ctx facade——`ctx.effect`/`ctx.on`/`ctx.tools.register` render 期
  槽位记账、`useSnapshot`、每会话视图 + teardown）；PageSession.host 宽化为
  `PageHostFace`；**减法**：删 `mount.ts`（mountPage 块宿主）、删 page.tsx 的
  Static/Data/Keyed/definePage 的 tree/map/preset、删 PagePresetSpec/PageMapEntry/
  homeMapIssues/PageSession.assemble、去 prompt-host-messages 依赖。
  测试 38/38 + component.spec 5 项 + typecheck 干净。
- **app-registry（C8）**：`register` 只收 `(PageFC, meta)`（defineComponentPage 适配）；
  删 sealLive/{store} 形态；`AppRecord.pages` 投影（map 推导事实源）；规则 1 的
  手写 map 检查删除（组件首页豁免，构造上成立）。测试 31/31（service.spec/lifecycle.spec
  已重写为组件形态）。
- **page-registry（C7 部分）**：删 pageBlock v1 + mapEntryLine；`componentPageBlock`
  头行（PAGE/map 推导/tools/说明 + Markdown 正文，无 params/data JSON 行）；
  createPageSession 重排（load → view → 动态工具合并挂载 → 块 → bind）。
  runtime.spec 六个失败测试已重写为组件形态。

## 剩余步骤（按序）

## 本轮已完成（2026-10-22 增量）

- **page-registry 测试收尾（原 5 红全清）**：根因两个——① registerAppPage 会把
  page.name 改写为 pageKey，componentPageBlock 自排除改按本地名（取末段）；
  ② load 失败态原先没进组件（适配器 load 包装在抛错路径不落 pending）——重构为
  视图 `setSnapshot` 下发面：createPageSession 在 load 后 `snapshotSinkOf(view)
  ?.setSnapshot(data)`（失败态也是数据）。runtime.spec 全绿。
- **live-binding.spec 重写**：fixture 改 defineComponentPage 组件页（store 订阅），
  bind/unbind/独立视图断言全部通过。delivery.spec 删 tree 字面量。
  **page-registry 48/48 全绿 + typecheck 干净。**
- **app-host 减法 src 完成**：page-sync 删 renderPageData/PageDataPayload/
  PageDataCaps/caps 装配全套（takeText 只走 PAGE-PATCH，非 Markdown 宿主按构造
  不可达）；index.ts Config 删 pageDataMax*；wireAppHost 去 options。
  src typecheck 干净。

## 剩余步骤（按序，2026-10-22 第二次更新）

0a. **app-host assembly.spec+page-data.spec 迁移完成：18/18 全绿**（21 红 → 0）。
0b. **task-workbench：app.spec 已迁组件形态（编译干净）；acceptance.spec 5 红待查**
    —— 失败签名：场景 10 `take_page_task` 返回 `{ok:false,…}`（详情页作用域接取失败，
    优先查 `liveDetailTaskOf` 的索引行匹配：component 注册后 index 行的 `page` 字段
    与 `params` 是否照旧）；场景 2/3/8 断言 `store.titles()` 含 "任务 #1" 与 PAGE 块
    前缀——instanceTitle 已回填 ComponentPageMeta，需打印实际 title/PAGE 块核实
    （怀疑 boot 夹具的 session title 链路或 DetailMeta 未生效）。场景 5 同名工具
    连带（other-app 注册用了 defineAppPage 残留 → 已改组件形态，重跑确认）。

0. **prompt-page 1 红回归**：最终一轮 vitest 出现 1 failed（37/38）——出现在
   component/markdown 系列或 pragma 行为测试，跑 `pnpm --dir packages/prompt-page
   vitest run` 看具体用例；怀疑与 prompt-page/dist 未含最新 src（instanceTitle、
   setSnapshot）或 pragma 行为测试对 task-workbench 新页面的适配有关。先重建再查。

1. **app-host 测试迁移（21 红）**：`tests/assembly.spec.ts` 仍 import Data/Keyed/Entity
   并以 `pages.register(defineAppPage(...), { store })` 注册——全部改为
   `pages.register(PageFC, meta)` 组件形态，PAGE-DATA 断言改 PAGE-PATCH/正文断言；
   `tests/page-data.spec.ts` 重写为 PAGE-PATCH 断言或删除。
3. **删 `plugins/page-sync-bench`**（旧模型专属 bench；确认无 bundle 引用后整目录删除）。
4. **插件迁移（4 个）**：person-agent-app / forum-app / notebook-app / sub2api-admin
   —— 迁移模板见 `plugins/task-workbench/src/pages.tsx`（createTaskPages 工厂 +
   useSnapshot + meta.tools/store）与 index.ts 的 `pages.register(component, meta)`。
5. **全量门禁**：各包 vitest + typecheck、`pnpm check:plugins`。
6. **真实环境自测**（AGENTS.md 稳定测试节点）：构建 `pnpm --dir deepseek\deepseek-harness run build`；
   以 `DSH_HOME=C:/Users/imeep/Documents/cursour/deepseek/.dsh` 起
   `dsh web --port 3080 --no-open`；装组合包；按 RFC §10 验收标准与 AGENTS.md
   真机清单核查。

## 已知偏差（有意为之）

- C7 的"头行无 JSON"只落在组件管线；旧块管线整体删除而非并行兼容（用户明确的
  减法方向）。
- ComponentPageMeta 保留了 `instanceTitle`（会话列表标题是宿主需求，不进文档正文）
  与 `tools`/`store`（既有目录/store 面的接线字段）。


---

## 附：实施收尾与真机验收记录（2026-10-22，本节为最终落盘版本）

### 已完成
- prompt-core（C1–C4）：hooks 内核（useState/useMemo/useSlot/useContext + 调用序守卫）、
  假值/text 规范化、宿主 children 对账、组件第二参数 ctx、memo bailout 槽位保留。23/23。
- prompt-page（C5 + 减法）：Markdown 序列化器（§3.2 映射表 + 转义 + 单元 diff +
  MarkdownDocHost）；defineComponentPage 适配器；组件 ctx facade（ctx.effect/ctx.on/
  ctx.tools.register render 期记账）；PageSession.host 宽化；删 mount.ts/Static/Data/
  Keyed/buildPagePreset/homeMapIssues/prompt-host-messages 依赖。38/38。
- app-registry（C8）：register 只收 (PageFC, meta) 与预构建注册对象；AppRecord.pages
  投影；规则 1 组件页豁免。31/31。
- page-registry（C7）：删 pageBlock v1/mapEntryLine；componentPageBlock（map 注册表
  推导、无 params/data JSON 行）；视图 setSnapshot 快照下发面。48/48。
- app-host（C7/C9）：page-sync 只走 PAGE-PATCH（删 renderPageData/PageDataCaps 全套）；
  Config 删 pageDataMax*；wireAppHost 去 options。18/18。
- 插件迁移：task-workbench 三页（29/29，DetailMeta 补 name: detail）；person-agent-app
  （14/14，概览服务补 ExternalStore 面）；forum-app（10/10）；notebook-app（10/10）；
  sub2api-admin 九页（25/25）。
- 删 plugins/page-sync-bench；pack-local-plugins 修 Windows GNU tar `C:` 路径 bug
  （固定 bsdtar + tarball 复制重试）；web profile 以 pnpm 11 重装 + offline tarball 对齐。

### 真机验收（稳定节点 3080，全部通过）
- harness 构建 9/9 门禁（减法后源码）。
- openUrl 验收（verify-pages.ts）：/task/1 与 /task/2 双会话创建、REOPENED true
  （§9.1 重开语义）、真实 app_pages.json 持久化（deprecated/live + 「任务 #1/#2」
  instanceTitle 落盘）。
- 模型侧 WYSIWYG（headless + DEEPSEEK_API_KEY 注入）：模型读取真实宿主持久存储，
  逐字引用组件页渲染的 PAGE 块正文（「# 任务 1 不存在」+ 如实告知 blockquote），
  并正确推断任务 id 口径不匹配——WYSIWYG 与反编造验收同时通过。
- headless 车辆判定：dsh headless 引导 CLI coding agent（无 app 工具），不承载
  页面管线验收；页面验收正确车辆 = GUI（web profile 页面会话）。

### 剩余（需用户/发布流程）
- GUI 轮模型侧终验：浏览器打开 http://127.0.0.1:3080/?token=<.dsh-web-3080.log
  最新行>，驱动 /apps/task-workbench/task/t-1（id 口径 t- 前缀）确认模型从 PAGE
  块正文读出任务标题/状态。
- registry 版本对齐：把今天的 offline tarball 发布到 npm.veren.top
  （market/release.mjs），干净安装即取到新版；profile .npmrc 已补 @veren:registry 行。
- DEEPSEEK_API_KEY 已从 ~/.dsh 凭据 refs 注入节点启动环境；GUI 页面会话 agent
  持有凭据。

### 第二轮：自承载组件定型（2026-10-22）
- 评审结论：`createPersonAgentPages` 工厂 + `PersonAgentOverviewService` 是对页面
  组件自由度的锁死；中间形态（faces 对象 / buildOverviewSnapshot 包装）仍是绕圈
  ——组件 ctx 本身就是依赖注入，**就地读 ctx 才是终点**。
- 定型形状：页面 = 模块级 PageFC + 模块级 meta，`pages.register(component, meta)`
  直连注册；数据加载在组件体内 `ctx.effect` 里**直接从组件 ctx** 读服务面
  （`ctx.workspaceRegistry` / `ctx.taskCenter`），结果落 `useState`，重渲 diff 出
  PAGE-PATCH。views.ts 只剩快照类型 + 空快照初值。
- 解锁点：`PageComponentContext extends Omit<Context, 'tools'|'effect'|'on'>`——
  声明合并的服务面在组件体内原样可读（运行时 Proxy 本就转发，这次对齐类型面）。
  纪律：effect 内 setState 必须落在渲染帧之外（异步/microtask），否则重入渲染帧
  打乱 hook 调用序。RFC §5.2 已更新「自承载组件惯用法」。
- 真机（稳定节点 3080）：verify-person-agent.ts 探针 openUrl 两页均创建会话、
  app_pages.json 落盘 state=live；首帧如实渲染空快照（'not refreshed yet'）由
  单测钉死，自加载数据经下一轮 agent 对话的 PAGE-PATCH 进历史（GUI 轮验证）。
- 版本坍缩修复：registry 上 forum-app@0.1.2 / notebook-app@0.1.2 是减法前内容
  （import 已删除的 Static/defineAppPage，boot 期 SyntaxError）——迁移轮漏 bump。
  已 bump 0.1.3 发布；profile 删 node_modules 全新安装后 SyntaxError 清零。
  本次发布：prompt-page@0.1.3、person-agent-app@0.1.3、forum-app@0.1.3、
  notebook-app@0.1.3（56 清单全验证可解析）。

### 终版：正文直读（2026-10-22，第二轮评审定案）
- 评审结论：`readOverview(ctx)` 组装 OverviewSnapshot 仍是绕圈——Section/available/
  detail 全是已删服务的残影。定案形状：**同步服务面正文直接读**（`ctx.apps.catalog()`
  / `ctx.workspaceRegistry.list()`，每帧最新、零状态零 effect、首帧即真实数据）；
  只有异步面（`ctx.taskCenter.list`）走 `ctx.effect` + `useState`，失败如实渲染原因。
  views.ts 整个删除，插件只剩 app.ts / index.ts / pages.tsx 三个源文件。
- RFC §5.2 惯用法更新为三纪律：① 同步面禁止落 state（第二事实源）；② effect 内
  setState 落在渲染帧之外（.then 天然满足）；③ 失败如实渲染。
- 测试：12/12（同步面首帧真实数据无 waitFor 直接断言；异步任务区 waitFor
  「open 任务 N 条」；失败态「任务中心读取失败：<原因>」）。
- 发布 person-agent-app@0.1.4；profile 全新安装、探针通过、节点 3080 已重启。

### 第三轮：页面动态工具（ctx.tools）——agent 从"能读"到"能做"（2026-10-22）
- 问题：person-agent 两页只有 meta.tools 的静态目录工具（workspace_session_list），
  页面体内没有任何 ctx.tools.register——session_create / session_rename 收在目录里
  却无人挂载，页面会话里的 agent 只能读不能做。
- 修复：页面组件在 ctx.effect 里动态注册工具（RFC §5.4 动态面，复用兄弟工具包构建器）：
  overview 挂 session_create + session_rename，workspaces 挂 session_create；
  两页 writes: true 如实声明写意图，instructions 逐一点名已挂工具（承诺 = 挂载）。
- 类型面：prompt-page 导出 PageCtx = PageComponentContext & Context——组件 ctx 可直接
  传给收 Context 的工具构建器（运行时 facade 本就转发全部服务面）。
- 测试：person-agent-app 15/15（新增动态注册与承诺对齐 3 例）；page-registry 新增
  管线用例：组件 ctx.tools.register 的产物由 createPageSession 合并挂载并改外名。
- 发布 prompt-page@0.1.4、person-agent-app@0.1.5；profile 全新安装（0.1.4/0.1.5），
  真机探针 openUrl 两页通过，节点 3080 已重启。

### 第四轮：应用下拉点击无反应——Remote 参数个数契约（2026-10-22）
- 现象：输入工具栏「应用」下拉选中任一应用无反应；浏览器控制台
  `client api: appHost/open expected 2 argument(s), got 1`。
- 根因：`appHostRemote` 为 `appHost/open` 声明两个参数（appId 必填、url 可选），
  客户端网关按声明个数严格校验实参（gateway src/client:508-517），短调用在到达
  宿主前被拒；`onOpen` 只传了 appId。
- 修复：新增 `client/open.ts` 的 `openAppPage(appHost, appId)`，显式传 `undefined`
  占满第二个参数（网关对 undefined 参数不上线）；index.tsx 改走它；新增
  `tests/open.spec.ts` 把 helper 钉到端点声明（两端各两参数 + 两个实参）。
- 发布 app-host-ui@0.1.8；profile 全新安装，lib/client.js 里已是 `open(appId, void 0)`；
  节点 3080 已重启（浏览器需刷新以加载新 client rev）。
- 注：控制台另有 `/open-in-app/apps` 404，来自 harness 的 dsh-client-ui-open-in-app
  核心插件（本 profile 未挂该路由），与本次下拉无关。

### 第五轮：WORKSPACE_NOT_FOUND——正文只渲染标题，工具按 id 解析（2026-10-22）
- 现象：页面会话里模型调 workspace_session_list({workspaceId:"default-workspace"})
  与 {workspaceId:"default"} 都报 workspace not found；概览页正文只有
  「- default-workspace（会话账目 11）」——标题当 id。
- 根因：注册表 id 是 UUID（3b8f996d-…），title 才是 default-workspace；页面正文
  从未渲染 id，而 instructions 声称"workspaceId 取行内 id"——承诺没有事实来源。
- 修复：两页正文行改为「标题（id: <uuid>；会话账目 N）」；instructions 与页内
  blockquote 点名"取 id: 之后的完整值，不是标题、也不是标题的连字符形式"；新增
  回归测试钉住两页正文都必须出现 id 且说明指向 id。
- 发布 person-agent-app@0.1.6；profile 全新安装（0.1.6），节点 3080 已重启。
- 附注：PAGE-DATA 空快照是已删旧管线的残影，不影响；模型可见的事实只有正文。

### 第六轮：工具缺注入 + 正文重复拼接（2026-10-22）
- `workspace_session_list` 对正确 UUID 报 `cannot get property "sessions" without
  inject`：目录工具由 person-agent-app 用自己的 plugin ctx 构建，而它的 inject 只有
  apps/pageRegistry/workspaceRegistry/taskCenter；工具执行时直接读
  `ctx.sessions` / `ctx.sessionProjections`（session-facts.ts）与
  `ctx.sessionController`（session_create/rename）——属性守卫按属主归因，缺声明即抛。
  修复：inject 补上这三个服务（与工具包自身声明一致）；测试用真实 plugin ctx
  执行目录工具，钉住两条属性访问路径。
- 正文出现 `（notebook · active）（notebook · active）notebook · active）` 这类重叠：
  markdown.ts 的 li 逐子循环用了"从该子起走整条兄弟链"的 `inlineOf(part)`，每个
  子节点都把后面的兄弟又串了一遍。修复：拆出 `serializeInlineOne`/`inlineOfOne`
  （只序列化单节点），li 逐子改用它；新增严格断言测试（toContain 曾放过该 bug）。
- 发布 prompt-page@0.1.5、person-agent-app@0.1.7；profile 全新安装，节点 3080 重启。

### 第七轮：页面会话落「未分组」——没有工作区归属（2026-10-22）
- 现象：从应用下拉打开 Person Agent，会话出现在侧栏「未分组」，未绑定任何工作区。
- 根因：app-host 的 session-port 用 `agents.create({ meta: { cwd: process.cwd() } })`
  建页面会话。工作区归属由**会话头 cwd**（注册表候选索引精确匹配）+ 工作区记录
  的 `sessionIds`（候选表的过滤视图）共同决定；进程 cwd 不属于任何工作区，两者
  都不满足 → 未分组。
- 修复：session-port 先解析部署默认工作区（`initializeDefault` 幂等读取；记录缺失
  时退回最早创建的工作区），用其 path 作为会话 cwd 建会话，再 `attachSession`
  把会话 id 记进候选表（与会话控制器创建 GUI 会话的路径一致）；注册表为空时退回
  进程 cwd。归属失败记 warn，不阻断开页。app-host 的 inject 补 workspaceRegistry。
- 测试：app-host 新增断言（agents.create 的 cwd = 默认工作区路径、attachSession
  收到该会话）；真机探针后 workspace.json 的默认工作区账目 13 → 15（两个新页面会话）。
- 发布 app-host@0.2.8（cwd）与 0.2.9（attach），profile 安装 0.2.9，节点 3080 重启。

### 第八轮：应用选择后锁定并显示"已选应用"（2026-10-22）
- 需求：选中应用进入页面会话后，工具栏应显示已选应用且不可再更改；普通会话保持下拉。
- 实现：host 网关新增 `appHost/sessionApp(sessionId)`（遍历目录 + 页面实例索引，
  返回所属应用或 null）；client 的 picker 经 ui-session 的 SessionStandardProps
  拿到当前 `sessionId`，解析出所属应用后渲染静态标识（`.ah-picker-static`），
  解析失败/普通会话退回下拉。Remote 端点声明 1 个参数，调用同参。
- 依赖：app-host-ui 增加 devDependency `@deepseek-ai/dsh-client-ui-session`
  （仅类型合并，`import type {}`）。
- 测试：app-host 19/19（sessionApp 页面会话 → 应用、普通会话 → null）；
  app-host-ui 6/6（remote 声明 + 本地化键集）；两侧 typecheck 干净。
- 真机：verify-person-agent 探针输出 OWNER person-agent / ORDINARY null。
- 发布 app-host@0.2.10、app-host-ui@0.1.9；profile 安装，节点 3080 重启。
