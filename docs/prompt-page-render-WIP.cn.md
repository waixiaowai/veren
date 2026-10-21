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
