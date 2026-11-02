# notebook 画布化 + 闪念保鲜窗可视：四问加深任务书

> 状态：**已加深，含两个待用户拍板的决策点（§3 末），不拍板按推荐走**。
> 来源：2026-11-03 用户命题：「闪念添加过期时间；整个界面改为带连线的 Card 知识卡片画布；请选择合适的技术栈；用专业的 UI 设计师和产品设计师视角。」
> 家族版本面：四包同线 `4.0.0-rc.1 → 4.0.0-rc.2`（MAJOR rc 线未定稿，新能力折入；纯增量，调用方破坏清单：无）。
> 执行纪律：一切宿主级验证走稳定节点 `deepseek\.dsh`（DSH_HOME 每条命令显式）；先 spike 后实现；先 bump 后发布（registry 不可变）。

---

## §0 范围裁定（先读，防止做错面）

1. **画布落在 `notebook-ui` 面板**（本任务所据截图即该面板的 React 面：归属选择 + 列表 + 编辑器）。`notebook-app` 提示页不动：PAGE 块是一锤子静态文本形态，画布进不去；且其首屏已含进料口/待加工区/谜面（`pages.tsx` instructions），模型面零缺口。
2. **「过期时间」不引入定时器、不自动删行**。教义已在案（docs/notebook-note-types.cn.md §2）：「trash 是显式动作，无 TTL、无定时器。过期只改变可见性（进料队列置顶），绝不自动删行。」本任务做的是把这条**已裁定但人不可见**的机制——面板 snapshot 里连 stats 都没有，保鲜窗只存在于 `stale` 工具与 `box_stats`——提升为**人可见、可配置、可就地加工**的面。若用户真要硬删，见 §3 决策点 ①。

## §1 取证在案（执行前通读；file:line 皆当前 master）

### 数据面（plugins/notebook/src）
- `types.ts:71` `NoteKind = fleeting | permanent | project`；`types.ts:74` `NoteRecord`（owner=preset、kind、anchor）——**无任何过期字段**。
- `queue.ts:25` `FLEETING_DAYS = 2`（保鲜窗，Ahrens「一两天」取二）；`queue.ts:40` `intakeView → { fleet, overdue }`；`queue.ts:50` `isOverdue`——**读时派生，不是 schema**（模块头注释明言「是查询，不是 schema」「窗口从不删除」）。
- `graph.ts:281` `STALE_DAYS = 7`（永久/项目卡的迷失窗：无入链且过窗）。links 缓存行 = owner/sourceId/targetTitle（`graph.ts:35`）；目标不存在的出现不露边（v1 旧正文遗留）。
- 数据全有、面板全没接：`types.ts:206` `BoxIntakeView`、`types.ts:236` `BoxStatsView`（密度/进料/速率）、`types.ts:177` `RiddleView`（谜面：共享邻居未互链对）。
- `types.ts:249` `NotebookConfig = { globalTools }`；`index.ts:72` Config schema（schemastery）——加 freshness 配置的落点现成。

### 工具面
- capture / promote / archive / stale / riddles / stats / hubs / find / cardLinks / backlinks 全在（`types.ts:258` 起）；`capture_note` 带 anchor 即项目卡（2f47456）。
- **模型面无缺口**：过期对 AI 已可见（`stale`、`box_stats.intake`、首屏 instructions）。本任务零工具新增、零工具描述改动。

### 客户端面（plugins/notebook-ui/src/client，共 1742 行）
- `remote.ts:65` `NotebookSnapshot = { owners, owner, notes, linkCounts, status… }`——**无 stats / intake / riddles**；Remote 端点 9 个——**无全盒边表**（`cardLinks` 是单卡两向；画布要的是全图一次读）。
- `panel.tsx:71` 双栏布局（列表左 + 编辑器右）；`panel.tsx:106` `onOpenCard` 已接（rc3 任务一已实施）；**`use-notebook-view.ts` 已 303 行，超 300 硬线**——动它必须顺手拆。
- `remote.ts` schema 全 loose（模块注释自述：宿主加字段不炸客户端）——加法安全。

### 仓内画布先例（packages/graph/，本仓源码、非 vendor）
- `flow-canvas-panel`（`@deepseek-ai/dsh-graph-flow-canvas-panel` 0.1.13，private）：**零画布依赖**的手卷 SVG 画布——`GraphEdges.tsx`（SVG 边层）、`useCanvasViewport.ts` / `viewportAuto.ts`（视口控制）、`layout.ts`（布局）、`view-state.ts` / `store.ts`（视图态与宿主态分面）、`DefaultNodeCard.tsx` + `slots.ts`（节点渲染器槽）；多主题、多语言、各文件守 300 行全部达标。
- 该先例过了**八轮评审**（docs/graph-canvas-review{,-round2,-round3}、graph-canvas-ui-review、graph-canvas-panel-review{,-round2}、graph-acceptance-review{,-round2,-round3}）——从数据面到真机 GUI 的坑全在案，是本任务的方法蓝本。

### 真数基线（裁决用）
- 稳定节点 11 卡审计（2026-11-02）：64% 验收残渣、真卡密度 0.25、唯一合格卡是孤岛、存量无 kind 转轨缺路径。
- 三路调研（40+ 页取证）：卡片公约数 = 地址 + 自话正文 + 引用行；社区参照 2.6 链/卡。
- 当前真机 13 卡（截图）：含闪念/永久/项目、孤岛、残渣——spike 与验收的输入。

## §2 四问

### 1. 专业人士会多做什么（用户没要求的）

- **先裁产品原型，再谈库**：「画布」有两个物种——Obsidian 式力导向图集（位置是算出来的，导航面）与 Heptabase/Scapple 式空间工作台（位置是内容，须持久化）。这一刀决定数据模型与一半工作量，必须先裁（→ D1），而不是从「选哪个库」开始。
- **交互规格先于形容词**：选择/视口/边悬停三张状态机 + 卡片解剖图 + 密度阶梯（13/50/200/1000 张各是什么形态）。「流畅」「美观」不可验收；状态机可以。
- **单一写作面纪律**：画布是导航/关系面，编辑器仍是唯一文本写作面。这个领域产品的经典死法是长出两个半吊子编辑器。
- **过期是流程，不是定时器**：到期必须把加工动作（炼成/扔掉）放到手边——过期的产品价值是强迫加工，不是删数据了事。
- **a11y 逃生通道**：画布 UI 是无障碍黑洞。列表保留为可访问等价面；画布不得藏任何列表里没有的信息。
- **规模断崖预案**：11 张好画，500 张呢——LOD 与性能预算先写数字后写代码。
- **存量零修正入画**：13 张存量卡（含无 kind 的 v1 行、孤岛、残渣）必须原样正确呈现——它们就是真实用户打开画布的第一眼。

### 2. 生料（最原始的料，不是别人嚼过的）

- **本仓源码两处**：notebook 四包全文（§1 清单）；flow-canvas-panel 的 client 源文件（视口/边/布局/视图态的现成实现，八轮评审在案）。
- **已裁定文档三份**：notebook-note-types.cn.md（扔的语义、双窗语义）、notebook-zettelkasten-design.cn.md（设计公理）、notebook-rc3-tasks.cn.md（任务书与实施先例）。
- **真数三份**：11 卡审计、三路调研、当前 13 卡真机态。
- **外部一手**：Obsidian graph 插件的真实交互集合（滚轮语义、悬停邻域高亮、筛选）、Heptabase/Scapple 空间模型（作对照、不作目标）、Ahrens 闪念章原文。
- 刻意不用作生料：「画布库评测文」——库选型只是 D4 里的一个矩阵，先例与数据面才是第一性的。

### 3. 方法与工具

- **矩阵评分 + spike-first**：候选栈过加权矩阵（React 融合 / 主题可达 / a11y / 300 行预算内可拆 / 体积 / 维护），胜者拿真实 13 卡数据先出 spike 图，**spike 不过关不开工实现**。
- **状态机 + ASCII 线框 + 解剖图**的交互规格先于实现，随 PR 提交。
- **数据面 diff 全加法**：新增全盒图读端点（nodes/edges/riddles/stats 一次读）+ snapshot 增 stats + freshness 配置；loose schema 兼容，零破坏。
- **派生纯函数纪律**：布局 ≡ f(snapshot)，同输入同布局（确定性、可性质测试）；视图态（视口/选择/筛选）与卡数据分面，照 client-ui-slots 铁律 8–12。
- **性能预算实测**：Chrome profiler、200 合成卡 pan/zoom ≥50fps、bundle 增量记账——数字进验收报告。
- **验收矩阵**：双主题截图、盲读三问、找卡计时对照、WCAG 非文本对比度、pnpm check、composition 测试、3080 真机清单增项、rc.2 发布链。
- **两周残渣率复测**：过期机制的最终裁决数（对 64% 基线）。

### 4. 外部裁决者（不由你我裁决）

- **稳定节点真实数据零修正入画**：13 卡含孤岛与残渣，spike 与真机各验一次。
- **盲读测试**：没见过面板的人从画布答三问——哪张是枢纽？哪些闪念该加工了？指定的两张卡怎么连的？
- **数字**：fps、bundle、对比度全部以实测值入报告，不以「应该没问题」入报告。
- **社区对照**：同数据在 Obsidian graph 完成同样的找卡/连卡任务，计时对照——不追求赢，追求同一量级。
- **残渣率**：发布两周后，过期闪念被加工（promote+trash）占比 vs 64% 基线。
- **门禁**：pnpm check 全绿、registry 贡献带 dispose/HMR 测试、版本先 bump、3080 安装校验照 AGENTS.md（bundles 列表 + hardlink 检查）。

## §3 裁定（D 系列）

### D1 产品原型 = 卡片形节点图集（atlas），位置不持久化
- 节点 = 迷你卡（kind 章 + 标题 + 两行摘录 + 入链数 + 老化态）；位置由确定性布局派生（≡ f(snapshot)），**不持久化坐标、不做手动排布**。
- 被否：空间工作台（位置持久化 = 新存储域 + 数据版本 + 迁移，与「派生纯函数」纪律相抵——有真实需求再立项）；Obsidian 式圆点图集（卡片不可读，不满足「Card 知识卡片画布」命题）。

### D2 IA：画布 = 默认面，列表降为索引面，编辑器 = 唯一写作面
- 面板两模式：**画布（默认）| 列表（索引 + 无障碍等价面）**，加选中卡的编辑器席位（沿用现 editor 组件）。
- 窄视口（<720px）回退 = 现双栏布局，画布切换钮隐藏。
- 领域事实入设计：**闪念不在图上**（链接可悬空、不入 links 缓存）——画布天然把闪念聚成独立「进料区」、把孤岛显影在边缘带，这不是缺陷是特性，据此分区布局。

### D3 过期语义：窗口可配置、到期派生、加工就地
- `NotebookConfig` 增 `freshness: { fleetingWindowDays }`（默认 2，钳制 ≥1；schemastery 定义，AGENTS.md 硬规）。
- `expiresAt` **读时派生**（updatedAt + 窗口），零 schema 变更——与 queue.ts「是查询不是 schema」同纪律；per-card TTL 字段推迟。
- 状态机：**fresh（age < 窗）→ overdue（age ≥ 窗）→ 出口 = promote（炼成）| trash（扔）| 编辑（改即续鲜：updatedAt 自然刷新）**。不新增 ledger 动作（promoted/trashed 已记账）；不加 snooze（编辑即续鲜，减法）。
- 面板三处落地：列表行老化态（双态 + 剩余时间）、画布节点老化态（overdue 褪色、收拢进料区）、**进料口 dock**（overdue 队列置顶 + promote/trash 一键就地——加工仪式的最短路径）。
- 被否：自动删除（§0.2 教义；数据灭失不可逆，且终局动作必须有主）；FLEETING_DAYS 与 STALE_DAYS 语义合并（一个是进料窗、一个是迷失窗，note-types 已裁定分开）。

### D4 技术栈 = 复刻仓内先例，不引画布库
- **渲染：React + tsx + css modules + SVG 边层**；视口/边层/节点槽/视图态照 flow-canvas-panel 的实现模式复刻进 notebook-ui（拷贝适配 + 头注释注明来源；不抽共享包——画布第二次出现时再按三例规则抽 `canvas-kit`）。
- **布局：确定性分区**（闪念聚进料区、永久/项目按连通度近心、孤岛边缘带）——纯函数、性质可测；**不引力导向**（非确定、reload 跳动、测试昂贵）。
- 若 spike 证明必须力导向：唯一许可项是 `d3-force`（算法单件、无渲染捆绑）叠在自绘层下。
- 对照案 `@xyflow/react` 被否理由：体积（百 KB 级进宿主面板）、节点深度定制迟早撞库的抽象墙、仓内已有过八轮验收的先例。「避免重复造轮子」在此的反面成立：**轮子已在仓里，照它造不是重复造**。
- 文件预算：画布新增源文件各守 300 行（先例在案）；`use-notebook-view.ts`（303 行，已超线）拆分并入本任务。

### D5 数据面 = 一次读出全图（加法）
- 新增 Remote 端点 `graph`：`{ owner } → { nodes, edges: { sourceId, targetId, targetTitle }[], riddles, stats }`——host 侧自 links 缓存 join notes 解析（悬空目标不露边，同 `graph.ts` 读语义）；`remote.ts` loose schema 加法。
- snapshot 增 stats——列表老化渲染复用同一次读，不另开口子。

### D6 密度阶梯（写进交互规格）
- ≤30 卡：全细节（标题 + 两行摘录 + 角标）；31–150：缩放驱动 LOD（远轴摘录隐藏、边标签关闭）；>150：粗粒度态（kind 色块 + 枢纽名）+「用列表找卡」引导。
- 性能预算：200 合成卡 pan/zoom ≥50fps（集成显卡实测入报告）。

### 决策点（用户拍板，不拍按推荐走）
1. **闪念硬删**：**推荐否**（教义在案；到期 = 可见性 + 加工）。若坚持硬删：只接受「过期 N 天后自动 trash + ledger 记账」的默认关闭开关，且属数据破坏语义，单独立项走 rc——不折入本任务。
2. **列表面去留**：**推荐保留为索引/无障碍面**（画布为默认态）。若坚持画布彻底替换列表，a11y 与窄视口兜底方案必须先给案再动手。

## §4 交付物与增量

### P0（一次 rc.2 内交付）
1. **spike 报告**：真实 13 卡、布局分区截图、fps 实测、矩阵评分表——不过关不开工。
2. **交互规格**（docs/，中英双语）：三状态机 + 卡片/边解剖图 + 密度阶梯 + 主题 token 对照表。
3. **数据面**：`graph` 端点 + snapshot.stats + freshness 配置；tests：解析 join、悬空排除、归属隔离、配置钳制。
4. **保鲜期可视**：列表行老化态 + 进料口 dock（promote/trash 就地）+ 配置面。
5. **画布骨架**：视口/边层/卡节点/确定性分区布局/画布-列表切换/窄视口回退。
6. **测试**：布局纯函数性质测试（同输入同布局、分区不变式）、dispose/HMR 安全、composition（真实 Loader）。
7. **验收报告 + rc.2 发布链**（先 bump 四包，registry 不可变）。

### P1（P0 验收后另立任务书，本任务不做）
- 谜面候选边（dashed，点开 = 两卡高亮 + 一键互链草稿）、枢纽权重渲染（入链数 → 边框/字号梯度）、画布筛选（kind / 孤岛聚光）。

## §5 验收（外部裁决清单——每项「看什么 / 通过标准」）

1. **真实数据入画**：3080 打开面板切画布——看 13 卡（含无 kind 存量、孤岛、残渣）是否全部呈现、零手工修正、console 无错。通过 = 全呈现且无错。
2. **盲读三问**：请未见过面板的人看画布答：哪张是枢纽？哪些闪念该加工了？「rc1验收外链卡」与「rc1验收改实证」怎么连的？通过 = 三问全对。
3. **老化态**：把一张 fresh 闪念的 updatedAt 改到窗外——看列表行与画布节点是否同时呈现 overdue、进料口 dock 是否收拢该卡。通过 = 双面一致、dock 在顶。
4. **加工闭环**：dock 里 promote 一张闪念——看节点是否迁入图区并出现其解析边；trash 一张——看节点消失且 ledger 记 trashed。通过 = 闭环成立、账实相符。
5. **边交互**：悬停一边 = 邻域高亮余者褪色；点一边 = 选中目标卡、编辑器跟切。通过 = 交互成立且**零新增网络请求**（选择是本地态）。
6. **主题与对比度**：全主题截图矩阵；边/文字对比度实测。通过 = WCAG AA（非文本 ≥3:1）。
7. **性能**：200 合成卡 profiler 实测。通过 = pan/zoom ≥50fps、bundle 增量记账入报告。
8. **a11y**：纯键盘走完加工流程（切列表 → 找卡 → promote）。通过 = 全程可达，画布无列表外信息。
9. **门禁**：pnpm check、composition、包级 spec 全绿；四包 rc.2 已 bump 已签。
10. **两周残渣率**（发布后追测）：过期闪念 promote+trash 占比 vs 64% 基线，追帖进验收报告。

## §6 边界（不做什么）

- 不做位置持久化/手动排布/多画布/协作光标（空间工作台整体推迟）。
- 不做画布内文本编辑（编辑器唯一写作面）。
- 不动 links 存储与 `[[…]]` 语法（画布是派生读面）。
- 不做全文搜索（设计书 D10 已否）。
- 不在 `notebook-app` 提示页加画布（文本形态；模型面已无缺口）。
- 一切宿主级验证走稳定节点 `deepseek\.dsh`；DSH_HOME 每条命令显式；不碰 `~/.dsh`。
