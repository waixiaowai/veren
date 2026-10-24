# prompt-page-render 减法实施 —— WIP 交接（2026-10-22）

方案：`docs/prompt-page-render-design.cn.md`（v2）。本文记录实施进度与剩余步骤。
方向已按用户修正：**做减法**——组件管线是唯一路径，旧块管线整体删除，不做双轨兼容。

## 状态总览（2026-10-22 收口，以此为准）

方案已**全部实施完毕**（减法方向：组件管线是唯一路径，旧块管线整体删除）。逐包状态：

- **prompt-core**：hooks 内核（useState/useMemo/useSlot/useContext + 调用序守卫）、假值/文本规范化、宿主 children 对账、组件第二参数 ctx 透传、memo bailout 槽位保留。
- **prompt-page**：`markdown.ts`（HTML→Markdown 映射 + 单元 diff + `MarkdownDocHost`）；`component.tsx`（`defineComponentPage`、`PageFC`、`ctx.page` hooks 面、`useSnapshot`、每会话视图）；`page.tsx` 只剩 `definePage`/`defineAppPage` 契约校验。`mount.ts`（mountPage）、Static/Data/Keyed、动态 preset 构建已删。
- **app-registry**：`register` 只收 `(PageFC, meta)` 与预构建注册对象；`AppRecord.pages` 投影；规则 1 手写 map 检查删除。
- **page-registry**：`componentPageBlock`（定位行 + 注册表推导 map + tools + 说明 + Markdown 正文，无 params/data JSON 行）；视图 `setSnapshot` 快照下发面；`mountPreview`/`openUrl` 复用路径与 `scopeOf` 会话作用域。
- **app-host**：page-sync 只走 PAGE-PATCH（`renderPageData`/`PageDataCaps`/caps 装配全套已删）；`Config` 只剩 `enabled`；`wireAppHost` 去 options；staging 暂存/预挂。
- **插件**：task-workbench、person-agent-app、forum-app、notebook-app、sub2api-admin 全部迁移组件页。
- **page-sync-bench** 已整目录删除。全部包 vitest + typecheck + `pnpm check`（含 `scripts/check-page-api.mjs` 静态门禁）绿。

## 两处历史记录的后续（2026-10-22 兼容层收口，均已完成）

早期小节与附录里有两句与 HEAD 代码不符，当时如实更正过；随兼容层收口
（提交 03258b2、11cf0b6），两处遗留均已处理完毕：

- **"删 PageDataPayload"已成立**：`plugins/app-host/src/page-sync.ts` 的
  `PageDataPayload` 死代码已删除，page-sync 只走 PAGE-PATCH 一条路（`pendingSnapshot`
  保留，仍承担首帧快照职责）。
- **"去 prompt-host-messages 依赖"已完成**：`src/markdown.ts` 与 `src/types.ts` 的
  `Sync` 类型导入已替换为本包自有形状，`packages/prompt-page/package.json` 中的
  `@veren/prompt-host-messages` 依赖声明已摘除。

## 剩余步骤

代码与文档之外的收尾只剩发布/验证类工作：

1. **GUI 轮模型侧终验**：浏览器打开稳定节点（`http://127.0.0.1:3080/?token=<.dsh-web-3080.log 最新行>`），驱动 `/apps/task-workbench/task/t-1`（id 口径 t- 前缀），确认模型从 PAGE 块正文读出任务标题/状态。
2. **registry 版本对齐**：把 offline tarball 发布到 npm.veren.top（`market/release.mjs`），保证干净安装取到新版；profile `.npmrc` 已补 `@veren:registry` 行。
3. ~~（建议，非必须）删除 `PageDataPayload` 死代码、收敛 prompt-host-messages 类型依赖~~——已完成（兼容层收口，提交 03258b2、11cf0b6），见上一节。

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

### 第九轮：选中应用改为"暂存"，首条消息才开会话（2026-10-22）
- 需求：点选应用不该立刻建页面会话；用户输入需求并发送时才真正开始。
- 实现（暂存 + 首回合提升）：
  - page-registry `openUrl({ reuseSessionId })`：复用既有会话——不建会话、不 focus、
    PAGE 块不落日志而是随 `OpenPageResult.block` 返回；失败绝不销毁用户会话；
    跳过 inbox 泵（不把用户消息挤后）。
  - app-host 新增 `staging.ts`：`stage` 只登记意图；该会话 agent 的
    `agent/pre-step`（先 next()）里用复用路径提升为页面会话，并把 PAGE 块作为
    本轮决策消息注入（只落日志当前轮看不到页面），同时落实例标题。
  - 网关新增 `appHost/stage(appId, sessionId)`；`sessionApp` 优先返回暂存应用
    （工具栏在发送前也显示已选应用）。
  - 客户端 picker：选中 → `stage`，成功后立刻显示静态"已选应用"；不再调用 open。
- 测试：page-registry 51/51（复用路径不建会话/块随返回值/失败不销毁）；
  app-host 20/20（stage → sessionApp → pre-step 提升：实例 live、PAGE 块进决策、
  标题更新）。
- 发布 page-registry@0.1.4、app-host@0.2.11、app-host-ui@0.1.10；profile 安装，
  节点 3080 重启。

### 第十轮：工具面晚一步（step 2 才"工具已更新"）——选中时预挂（2026-10-22）
- 真机现象：选中 Person Agent 发送后，step 1 的请求头仍是普通会话工具面
  （`app_list`/`app_open`/`app_pages`，无 `person_agent__*`），step 2 才切到页面工具面
  并出现「工具已更新 · 新增 3 个，移除 3 个」。同会话日志：step 1 缓存命中
  11,648 / 14,083，step 2 4,480 / 14,543；界面底部 56% 正是两步加权。PAGE 块在
  step 1 就写了 `tools: …`，请求头里却一个都没有——工具面与说明隔了一整步。
- 根因：agent-loop 每个 step 先 `systemPrompt.assemble` 收齐工具
  （`packages/core/agent-loop/src/agent.ts:272`），再跑 `agent/pre-step`（`:274`），
  请求用冻结的 `assembly.tools`（`:442`）。提升（openUrl → mountTools）发生在
  pre-step 里，只能影响下一次 assemble；pre-step 是回合内最早的可拦截缝，再往前
  只能到"选中应用"那一刻。
- 修复（选中时预挂工具面）：
  - page-registry 新增 `mountPreview(sessionId, url)` / `releasePreview(sessionId)`：
    渲染一次（含首屏 load）收集 catalog + 动态工具并挂到会话 agent 作用域，**不**建
    实例、不写索引、不追加 PAGE 块；`collectMountedTools` 成为预览与正式挂载唯一的
    收集实现，两条路径的定义逐字相同，提升时请求头不变。
  - app-host staging 的 `stage` 改为 async：先 `mountPreview` 再登记；`unstage`、
    提升失败、装配卸载都释放预挂面（含 `app_*` 屏蔽复位）。网关 `stage` 校验会话
    存在，并拒绝已是页面会话的会话；`sessionApp` 只认 live 索引行（废弃行是历史，
    不再被当成当前所属应用）。
  - `pageData.bind` 的初始游标取 PAGE 块已覆盖的版本：块里已有的首帧/快照内容不再
    作为 PAGE-PATCH 重发（预挂让 page-sync 监听器提前进入 step 1，游标是防重复的
    结构性保证）。
- 测试：page-registry 55/55（预挂不建实例/不写索引、与正式挂载定义逐字相同、撤销、
  绑定游标 = 块版本）；app-host 23/23（stage 后工具已挂且 `app_*` 已屏蔽、pre-step
  提升无重复、unstage 整组撤销、页面会话拒绝暂存、sessionApp 只认 live 行、agent
  销毁时暂存意图随预挂面一起丢弃）。
- 真机：新会话选 Person Agent → 发送"这个工作区里有哪些会话？用工具查一下"。
  日志只有一条 `request/header`（reason `initial`）：53 个工具含三个
  `person_agent__*`、不含 `app_*`，全程无 tool-registry developer/message；模型
  step 1 直接调用 `person_agent__workspace_session_list` 成功。缓存曲线：step 1
  9,520 未命中 + 4,736 命中（页面工具面付一次），step 2/3/4 连续
  14,336 / 16,256 / 16,768 命中。页面实例 live、会话已进默认工作区。
- 发布 page-registry@0.1.5、app-host@0.2.12（0.2.13 补 sessionApp 只认 live 行；
  0.2.14 补 agent 销毁时丢弃预挂面与暂存意图）、app-host-bundle@0.2.9；profile
  全新安装，节点 3080 重启。

### 第十一轮：页面 effect/on 挂到会话作用域（官方 agent.ctx 模型）（2026-10-22）
- 背景：第十轮分析发现 page facade 的 `on` 订阅的是应用插件 ctx（无 scope 标签），
  `scopeTarget` 对无标签监听器一律放行——页面里的 `ctx.on('agent/…')` 会收到所有
  会话的事件；effect 也只是视图手动清理，不是 agent 作用域所有。
- 官方模型：每个 Agent 由 `createScope` 创建带独立 fiber + scope tag 的 `agent.ctx`
  （`packages/core/agent-loop/src/agent.ts:130-131`；`packages/core/scope/src/index.ts:137-147`）；
  注册即作用域（工具/effect/on 随 agent 销毁）；agent-subject 事件经 `scopeTarget`
  只送该 agent 的监听器（无标签监听器全局）。
- 实现：
  - `PageLiveBinding.mount(params, scope?)` 增加可选会话作用域；
    `createSessionView` / `createComponentCtx` 接收它。
  - facade：effect 的清理经 `agent.ctx.effect` 登记（agent 销毁兜底；视图提前退订用
    记录的 disposer 提前执行一次）；on 经 `agent.ctx.on` 订阅（事件按 agent 过滤，
    注销随视图 teardown）。服务面仍转发创建者 ctx——agent.ctx 的服务链来自
    agent-loop，不一定注入应用插件声明的服务。
  - page-registry 端口新增可选 `scopeOf(sessionId)`；openUrl 与 mountPreview 渲染时
    把 `agent.ctx` 传给 live.mount；app-host 真实端口返回 `ctx.agents.get(id)?.ctx`。
    agent 未创建（暂存预览）时为 undefined，回退到创建者 ctx / 视图清理。
- 测试：prompt-page 40/40（新增作用域注册/提前清理用例）；page-registry 56/56
  （新增 scopeOf 传递用例）；app-host 23/23；依赖插件 person-agent-app 17/17、
  task-workbench 29/29、notebook-app 10/10、sub2api-admin 25/25、app-host-ui 6/6。
- 真机：新会话选 Person Agent 发送"你好，介绍一下这个页面。"；日志只有一条
  request/header（initial），53 工具含三个 person_agent__*、不含 app_*、全程无
  tool-registry developer/message；在 ctx.effect 里注册的动态工具（现在挂在 agent
  作用域）正常进入请求头；缓存 step 1 2,474 未命中 + 11,776 命中，step 2 190 + 14,464 命中。
- 发布 prompt-page@0.1.6、page-registry@0.1.6、app-host@0.2.15、
  app-host-bundle@0.2.10；profile 安装，节点 3080 重启。

### 第十二轮：不改写 ctx 固有成员——页面 API 收进 ctx.page（2026-10-22）
- 反馈：`PageCtx = PageComponentContext & Context` 把 ctx 固有的 effect/tools/on 覆盖后
  又用交叉类型放回来，类型/运行期不一致；改写固有成员本身也不自然。
- 实现：
  - 删除 `PageComponentContext` 与交叉类型；`PageCtx = Context & { page: PageHooks }`，
    ctx 是 `ctx.extend({ page })` 出来的真实子上下文，固有成员（tools/effect/on）原样。
  - `PageHooks = { effect, on, tool }`：首帧按槽位记账（只执行/订阅一次）；effect 清理与
    on 经会话的 `agent.ctx` 注册（事件按 agent 过滤、agent 销毁兜底）；tool 记录后由
    page-registry 挂到同一作用域。无 agent 作用域（暂存预览）时 effect 清理随视图
    teardown、on 回退创建者 ctx。裸注册（无 ctx）只带 page 面。
  - 页面代码迁移：`ctx.effect` → `ctx.page.effect`、`ctx.on` → `ctx.page.on`、
    `ctx.tools.register` → `ctx.page.tool`（person-agent-app 两个页面）。
- 测试：prompt-page 40/40（作用域用例改为 ctx.page.effect/on）、page-registry 56/56、
  app-host 23/23、person-agent-app 17/17、task-workbench 29/29、notebook 10/10、
  sub2api 25/25；`pnpm check` 全绿。
- 真机：新会话选 Person Agent 发送"你好，介绍一下这个页面。"；日志只有一条
  request/header（initial），53 工具含三个 person_agent__*、不含 app_*；在
  ctx.page.effect 里经 ctx.page.tool 记录的动态工具正常挂载；缓存 step 1 810 未命中 +
  13,440 命中，step 2 1,251 + 14,336。
- 发布 prompt-page@0.1.7、person-agent-app@0.1.8、person-agent-bundle@0.3.3；
  profile 安装，节点 3080 重启。

### 第十三轮：后续收口（2026-10-22）
- 卸载守卫：`renderNow` 在 `tornDown` 后早返回——退订后的异步 `setState` 不再渲染
  孤儿视图；新增测试（退订后 setState 不再多一帧）。
- 测试基建：app-host 的 agent 作用域改用 `createScope`（独立 fiber + scope tag；
  工具表 `isolate('tools')` 继承 tag）+ 稳定 agent 对象；`runPreStep` 用同一身份派发。
- 新增两条集成测试：① stage 时 agent 未创建 → 工具排队到 `agent/created` → 首条消息
  第一步可见且无重复；② `ctx.page.on` 跨会话隔离（两个 agent 的事件互不串，
  `scopeTarget` 过滤）。
- 静态门禁：`scripts/check-page-api.mjs`（页面声明文件禁止 `ctx.effect`/`ctx.on`/
  `ctx.tools.register`，必须走 `ctx.page.*`）+ 自测，接入 `pnpm check`。
- 文档同步：app-host / person-agent-app / page-registry README、app-registry 与
  person-agent-app 注释、application-concept 页面侧、prompt-page README 增加组件页/
  `ctx.page` 章节；设计文档 §5.5 的 `page:ready`/`page:dispose` 标记为计划中未实现。
- chip 文案：`selectedApp` 去掉"发送后开始会话"，提升后 title 不再过期。
- 测试：prompt-page 41/41、app-host 25/25、page-registry 56/56、person-agent-app 18/18
  （含并行工作区的 0.1.10 workspace/preset/model 区块）、task-workbench 29/29、
  notebook 10/10、sub2api 25/25、app-host-ui 6/6；`pnpm check`（含新门禁）全绿。
- 发布 prompt-page@0.1.8、page-registry@0.1.7、app-host@0.2.16、app-registry@0.1.4、
  app-host-ui@0.1.11、person-agent-app@0.1.10（后者来自并行工作区改动，测试通过后
  一并发布）；profile 安装，节点 3080 重启。
- 真机：新会话选 Person Agent 发送；页面正文出现 Workspace List / Agent Preset List /
  Model Catalog / 待办任务；chip 显示"已选应用"；缓存命中 93%。

## 第二十轮：页面逻辑全部收进组件体（2026-10-24）

方向再按用户修正做减法：**页面的逻辑不许脱离页面**。meta 上的行为钩子全部退役，
组件体是唯一的行为面；复测同时确认"工具只在页面"的全量合规。

- **prompt-page**：`ComponentPageMeta.load` / `useSnapshot` / `PageLoadEnv` /
  `PageJsonValue` / `ComponentPageMeta.skills` 全部删除；`PageLiveBinding.mount`
  收敛为 `(params, agent)` 两参——挂载不经手任何数据。契约面只剩声明
  （name/url/description/writes/instructions/instanceTitle）。
- **page-registry**：`firstScreenData` / `PAGE_LOAD_TIMEOUT_MS` / `presetOf` 端口 /
  `mountSkills` 端口删除；"没有渲染后再下发的第二次入口"铁律反转——首屏读取就是
  组件体自己的入口。
- **app-host**：`createPresetOf` / `mountSkills` 实现删除；wire 相应收敛。
- **五应用迁移**（新形态范本 = forum-app/notebook-app）：
  - 同步内存 store（task-workbench、sub2api-admin）：正文直读 store 当前状态，
    首屏零 followup；
  - 异步读（forum-app 目录/详情、notebook-app 列表/笔记、person-agent-app 概览
    三节）：`agent.ctx.effect` 发起异步读，事实经 `agent.followup`（source
    `app/page`，各 app 以同形状 declaration merging 复用宿主常量）以新消息送达，
    正文是打开时刻的静态框、绝不留白；失败态也是信息，随消息如实送达；
  - **单会话 skill**（person-agent renhua）：组件体直接
    `agent.ctx.skills.register({ ...skill, source: 'runtime' })`——与工具同机制，
    `meta.skills` / `mountSkills` 退役；
  - 归属解析：`env.preset` 退役后，组件体从会话头 `agentPreset` 自取（与工具取
    调用者同源）。
- **工具注册面全量复测**（本轮起点）：40+ 插件包 test+typecheck 逐包跑；唯一下场
  红包是 sub2api-admin（最后一个应用目录工具 + meta.tools 声明的包，其依赖的
  `apps.tools`/`ComponentPageMeta.tools` API 已删）→ 迁到组件体直登（task-workbench
  同款槽位形态）。宿主/会话级基础设施的全局面按既有裁定保留：app-host 引导四件
  （app_list/app_pages/app_open/page_send）、task_center 任务泵、select_model、
  session_fork、dsh-test；`im/tool` 与 `startup-autostart-tool` 为无页面的独立
  能力插件，全局注册是其当前唯一形态（如需页面化另立任务）。
- 测试：prompt-page 40、page-registry 31、app-host 21、task-workbench 34、
  notebook-app 14、forum-app 14、person-agent-app 18、sub2api-admin 33 全绿；
  `check-page-api` 门禁绿。
