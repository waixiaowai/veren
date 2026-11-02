# notebook rc.3 双任务书：面板链接可点 + 标题寻址工具

> 状态：**已加深，待执行**。来源：2026-11-02 rc.1 八步真机验收（docs/acceptance/notebook-3.0.0-rc.1/）缺点清单第 2、4 条。
> 家族版本面：四包同线 `3.0.0-rc.2 → 3.0.0-rc.3`（3.0.0 尚未定稿，新能力折入未完的 MAJOR rc 线；调用方破坏清单：无——纯增量）。
> 执行纪律：一切宿主级验证走稳定节点 `deepseek\.dsh`（DSH_HOME 显式），每条 dsh 命令带归属；深过大不做（此二题皆小而正确）。

---

## 任务一：面板「卡片链接」可点——人能顺着链接走

### 缺陷陈述（取证自源码，2026-11-02）

`plugins/notebook-ui/src/client/note-links.tsx` 的 `LinkRows` 把出链/反链渲染成 `li > span` 纯文本（103-104 行）；`NoteLinksProps` 里**没有任何选中回调**。卡片笔记法的核心人用动作——沿链接游走——在面板里断裂：人只能看链接、再去列表手动找卡。聊天面可以（`read_note` 按 id），人面不行。

### 四问

**1. 专业人士会多做什么？**
Zettelkasten 软件的底线是「点链接即跳转」（Obsidian/Logseq/Anytype 全部如此）。专业人士还期望：跳转后反链区立刻更新（选择驱动，现有生命周期已支持）、键盘可达（链接行是按钮不是 div）、跳转不加任何新网络请求（目标卡已在 `state.notes` 里，选择是本地状态）。

**2. 生料（已取证）**
- 选中路径现成：`use-notebook-view.ts` 的 `openFromList(note)` → `applyNoteSelection`（同步、含 dirty 守卫）。缺的只是**按 id 找回 NoteView** 的一步。
- 宿主数据现成：`panel.tsx` 的 `NotebookLayout` 持有 `state.notes`（NoteView[]，全盒）——出链 targetId、反链 sourceId 都能在其中找到。
- 样式现成：列表行的 `button.notebook-item` 已是可点行先例；链接行升格为 button 复用其 a11y 模式。

**3. 方法（不变式驱动）**
- 契约：`NoteLinksProps` 增加一项 `onOpenCard(id: string): void`（**传 id 不传 NoteView**——NoteLinks 只该认识 id，找回 NoteView 是父层职责，保持展示组件不持数据）；`LinkRows` 每行升格为 `button`，点击调 `onOpenCard(row.id)`。
- 装配：`panel.tsx` 的 `NotebookLayout` 注入 `onOpenCard={(id) => { const note = state.notes.find(n => n.id === id); if (note !== undefined) view.openFromList(note) }}`——找不到（理论不可能：同盒全量在内存）就静默不跳，绝不抛错。
- 否掉的案：(a) 在 NoteLinks 内部直接持 notes 全量——展示组件持数据，违反本包「事实经 props」的纪律；(b) 跳转走深链 URL（`/apps/notebook/note/:id`）——深链不开会话的宿主缺口未修（验收报告 §3.1），且会重开会话，违背「盒内游走」的连续性；(c) 用 `history`/路由 API——SPA 无路由层，选择即视图，不引入第二套导航。

**4. 外部裁决（不由你我裁决）**
- 真机（3080，rc.3）：打开「rc1验收·汇聚卡」，分别点击出链行与反链行——编辑器切到目标卡、正文/时间戳随之、`卡片链接` 区刷新为新目标的两向；console 无新增网络请求（选择是本地的）；截图各一。
- 键盘：Tab 能到达链接行、Enter 触发（button 原生行为）。
- 回归：rc.2 已修的选中死循环不复发——面板连续点击链接 10 次，编辑器始终跟手、无闪动。

**测试草图**：包无 React 渲染测试基建，本任务不新增单测（真机裁决 + 现有 8 测保持绿）；这是 UI 行为，测试基建的补齐是独立任务，不在这里偷偷扩。

---

## 任务二：`find_cards` 标题寻址工具——按地址找卡，不翻列表

### 缺陷陈述

`list_notes` 按时间倒序给摘录，找「三周前那张讲 X 的卡」靠模型翻行。设计书 D10 否掉的是**全文搜索**；而**标题寻址查找**是方法自身的系统——标题本来就是地址（C3），地址应当可查。卢曼的盒可按编号物理查找，我们的盒按标题逻辑查找却无工具。

### 四问

**1. 专业人士会多做什么？**
写卡前先查重（「盒里是否已有相近标题的卡」——防止 `……（2）` 式重复卡）；重入盒时按主题片段定位入口；整理时按前缀圈出同主题的卡。三个动作全是「按标题片段找卡」，一个工具全覆盖。

**2. 生料（已取证）**
- 匹配语义现成：`validate.ts` 的 `suggestions()`（160 行起）已经是「标题 contains 片段、归属内、上限 5 条」——把这段逻辑**抽成共享函数**（建议挪 `notes.ts`，如 `titlesContaining(notes, owner, needle)`），`suggestions` 改调它，新工具也调它——拒绝提示与新工具永远同一匹配语义。
- 端口与挂载现成：`NotebookToolsPort`（types.ts:155）加 `find`；`index.ts` 服务面加对应 Remote 或直接端口实现；`pages.tsx` 两个页面组件体各加一行 `toolOf('find_cards')`（现 8 处 toolOf 注册，加 2 处）；应用目录定义加一件构建器（`tools-graph.ts` 或新 `tools-find.ts`，守 300 行）。
- 输出形状现成：复用 `NoteSummary`（id/title/excerpt/updatedAt），与 `list_notes` 同形，模型零学习成本。

**3. 方法（不变式驱动）**
- 契约：`find_cards { query: string }`——返回 `{ cards: NoteSummary[] }`，**标题 contains `query.trim()`**、归属内、按 updatedAt 倒序、上限 20；空/空白 query 以既有 `notebook/input-invalid` 拒（不加新错误码——联合不扩张，无破坏）。
- 不变式（进 `tests/tools.spec.ts`）：
  - **F1**：`find(owner, q)` ≡ `{ r ∈ notes(owner) | r.title.includes(q.trim()) }` 按时间倒序截 20——平凡但按测试钉死（含中文标题、含大小写精确：不做 NFKC 归一，与解析器同语义）；
  - **F2**：归属隔离——预设 B 的片段永远命不中 A 的卡（复用既有隔离用例模式）；
  - **F3**：建议恒等式——`resolveLinksOrThrow` 的建议列表 ⊆ 同片段 `find_cards` 结果（共享同一匹配函数后按构造成立，测试钉一条防未来分叉）；
  - **F4**：归属永不是参数（复用既有双 Agent 用例模式）。
- 否掉的案：(a) 全文搜正文——D10 反目标不变，正文是想法不是地址；(b) 面板加搜索框——面板是薄人面（D10.3），模型面先行，人面等真需求；(c) 模糊/拼音/归一匹配——标题即精确地址，模糊化制造第二套语义；(d) 独立 `search_cards` 命名——与 `list_notes` 家族对齐叫 `find_cards`，动宾一致。

**4. 外部裁决（不由你我裁决）**
- 真机（3080，rc.3）：会话里说「找标题含「改名」的卡」——模型必须调 `find_cards` 且结果与盒内实情一致（人工对表）；写卡前说「先查有没有相近标题」——查重动作可用。
- Loader 冒烟（`packages/test-support/loader-smoke`）：组合装载后两页会话工具清单都含 `notebook__find_cards`（9 处 toolOf）。
- 既有测试账：`tools.spec` 的「builds exactly the five page tools」按新成员更新；全包 34 测保持绿。

---

## 执行顺序（一个 rc.3 周期内）

1. 任务二（先做模型面：抽共享匹配 → 端口 `find` → 构建器 + 两页挂载 → F1–F4 测试绿）；
2. 任务一（UI：NoteLinks 加 `onOpenCard` + 行升格 button → panel 装配）；
3. 四包 bump `3.0.0-rc.3` → `market/release.mjs` 发布 → staging 3100 pin → 3080 浮动跟随；
4. 真机裁决清单逐条过（两任务各自的外部裁决节）；
5. `3.0.0` 正式 + 市场索引随行（与观察期合并走，§12 P4 最后一步）。

## 待执行指令（给实施会话）

> 按 docs/notebook-rc3-tasks.cn.md 执行 rc.3 双任务：先任务二（find_cards：抽 titlesContaining 共享匹配 → NotebookToolsPort.find → 构建器 + 两页挂载 → F1–F4 测试），后任务一（NoteLinks onOpenCard + 链接行升格 button + panel 装配）；全部门禁绿后按执行顺序第 3 步走 rc.3 发布列车，真机裁决逐条过；不改 D10 反目标（不做全文搜索、不加面板搜索框）。
