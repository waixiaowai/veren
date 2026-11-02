# 记事本即卡片盒——@veren/notebook × 卡片笔记法契约设计

> 状态：**设计稿，待评审。** 本文档是设计任务的交付物，不写任何业务代码。每条方法主张都引一手来源（附录 A）；每条契约决策带编号（`D1`–`D12`）并写明被否掉的替代案；每条不变式（`I1`–`I10`）带测试草图。评审通过后才启动实现。
>
> 英文版同构镜像：[notebook-zettelkasten-design.md](./notebook-zettelkasten-design.md)

---

## 0. 决策摘要

| 编号 | 决策 | 一句话 |
|------|------|--------|
| D1 | 实体 | 卡片 = 现有 `NoteRecord` 原样演进（零新字段）；链接 = 从正文派生、缓存持有；枢纽 = 派生排名，不是实体 |
| D2 | 卡片身份 | 行键仍为不可变 uuid（现状）+ **title 在 owner 内唯一**，且标题就是链接地址 |
| D3 | 链接语法 | `[[标题]]`，写入时严格解析，`\[[` 转义；自写约 80 行 scanner，零依赖 |
| D4 | 改名/删除/悬挂 | 改名重写每张引用方正文并重指缓存（`[[旧]]`→`[[新]]`）；有人引用时删除被拒；存储态永不出现悬挂链接 |
| D5 | 反链 | 纯派生、永非事实源；一张可丢弃的 `links` 缓存表随每次卡片写入维护（域级拒绝姿态——见 §3.5 勘误） |
| D6 | 迁移 | 无：介质保持 version 1、单布局——增量表与 `linksSyncedAt` 全局标记让 v1 介质原生打开；勘误见 §3.6 |
| D7 | 方法适配 | 每 preset 一盒保留；Folgezettel 编号放弃；"每日整理节拍"改为写入时纪律 |
| D8 | 工具面 | 五件工具全保留；恰好新增两件（`list_backlinks`、`list_hubs`）；方法纪律进工具描述 |
| D9 | 页面面 | 首屏消息增加链接/反链/枢纽三段；无人值守页面契约一字不动 |
| D10 | 反目标 | 不是任务清单、不是全文搜索、不是人类 wiki、不是跨预设共享、不是 markdown 渲染器 |
| D11 | 包与版本 | 在 `@veren/notebook` 上原地演进；MAJOR `3.0.0-rc.N`（错误码联合扩张；存储有效性收紧） |
| D12 | 合并/拆分 | 不设原语——agent 用 `rewrite_note` 组合完成；专用工具被否（YAGNI） |

---

## 1. 现状契约（本设计的出发点，全部读自源码）

以下事实读自源码（2026-11-02），不是记忆印象：

- `plugins/notebook/src/storage.ts` —— 单一存储域 `notebook`，**version 1**，
  单表 `notes`，zod 校验，键 `encodeURIComponent(owner)/<uuid>`（`noteKey`，
  `notes.ts:49`）。任一行不合 schema 即拒绝打开整个域（权威数据姿态）。
- `plugins/notebook/src/types.ts` —— `NoteRecord { id, owner, title, body,
  createdAt, updatedAt }`；错误码 `notebook/storage-unavailable | input-invalid |
  title-required | body-too-long | note-not-found | conflict`（已声明进
  `RemoteErrorDetailsMap`）。
- `plugins/notebook/src/notes.ts` —— `MAX_TITLE_CHARS = 200`、`MAX_BODY_CHARS =
  100_000`、`EXCERPT_CHARS = 160`；`mintNoteId()` 为 `crypto.randomUUID()`；
  乐观并发走 `expectedUpdatedAt`（`ensureExpected`）。
- `plugins/notebook/src/tools.ts` —— 五个 `defineTool` 构建器（`list_notes`、
  `read_note`、`write_note`、`rewrite_note`、`delete_note`）；**归属每次调用从活
  Agent 读取、永远不是参数**；工具自身不注册——应用是唯一注册面。
- `plugins/notebook-app/src/app.ts` —— 应用 id `notebook`、`toolPrefix:
  'notebook'`、两页（`list`、`note`），工具经 `meta.tools` 组合按页挂载
  （`notebook__<本地名>`），注册带逆序回滚（`registerAppSteps`）。
- `plugins/notebook-app/src/pages.tsx` —— 一次性 `PageFC` 组件体；归属解析自
  会话头 `agentPreset`；首屏走 `agent.ctx.effect` + `agent.followup`
  （`source: 'app/page'`）；无人值守契约 list = L1、note = L2，页面作用域
  `task_take/complete/fail` 回报面齐备。
- `plugins/notebook-ui/` —— 人用面板（列表、编辑器、归属选择器），读写同一批
  服务方法。

**今天缺的东西**：没有任何链接机制；`title` 无唯一性约束；三个包里正文都是
纯文本、没有任何 markdown 语义；没有任何渲染依赖。

迁移机制现成可用（harness
`packages/storage/storage-domain/src/spec.ts`）：域声明 `version` 与可选
`compatibleVersions: readonly number[]`——*"旧版本域的存量记录只要当前记录
schema 也能接受即可继续读……写入永远盖当前 `version` 戳"*。
`invalidRecords: 'backup-and-skip'` 专门为 *"记录是可丢弃派生数据的域"* 而设。
这正是 D5/D6 需要的机制，**不需要发明任何迁移代码**。

## 2. 方法主张与一手来源

本设计引用一手材料，不引阿伦斯畅销书作论据（见 C7 的告诫）。

| # | 主张（按本设计的用法表述） | 一手来源 | 本设计如何兑现 |
|---|---------------------------|----------|----------------|
| C1 | *"最好每张笔记只讲一件事——但尽可能地讲全那一件事。"* | [Matuschak：Evergreen notes should be atomic](https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic) | 一卡一想法由工具描述承载纪律；自足性由盲读测试外部裁决（§10b） |
| C2 | *"它形成一种压力，逼你认真思考想法之间如何关联"*；链接是*"穿越想法空间的许多条路径"* | [Matuschak：Evergreen notes should be densely linked](https://notes.andymatuschak.org/Evergreen_notes_should_be_densely_linked) | 密集链接被做得又便宜又受约束：写入时解析 + `list_backlinks` |
| C3 | 标题应是完整短语——标题就是笔记的稳定地址 | [Matuschak：Prefer note titles with complete phrases](https://notes.andymatuschak.org/Prefer_note_titles_with_complete_phrases)（按标题引用；该笔记的标题本身就是主张） | **标题即链接地址**（D2） |
| C4 | 卡片盒是*"一种第二记忆，一个可以随时交流的另一个我"*；一张笔记*"只是元素，它的价值来自作为引用与交叉引用网络的一部分"*；不相连的笔记*"会在卡片盒中迷失，会被卡片盒遗忘"* | [卢曼 1981，英译](https://zettelkasten.de/communications-with-zettelkastens/) | `list_backlinks` + 首屏枢纽段就是"盒在回话"（D7）；孤儿预防是结构性的（I3） |
| C5 | 卢曼两只盒分别装 **24,000 张卡 + 1,800 条文献条目** 与 **66,000 + 16,000**；枢纽是*"把核心卡片链接列成长单的卡片"*，*"如同纸面卡片盒里主题之间的高速公路"* | [Schmidt 访谈：The Money Is in the Hubs](https://zettelkasten.de/posts/zettelkasten-hubs/) | 枢纽是**派生排名**（`list_hubs`），不是实体（D1）；规模目标定为每盒 1 万卡（§8 I4 注） |
| C6 | 真实卡片 id 是分支编号（`21,3a7` 式 Folgezettel），编码的是物理摆放位置 | [尼卡斯·卢曼档案馆](https://niklas-luhmann-archiv.de)（真卡扫描） | 编号被认定为**纸面世界约束**，有意放弃（D7） |
| C7 | 告诫：流行读物是作者对卢曼的个人解读，效率圈还常把方法误读成存储术 | [Bob Doto：Tensions Between Zettelkasten & the Productivity Scene](https://writing.bobdoto.computer/tensions-between-zettelkasten-and-the-productivity-scene) | 本设计每条主张都落在 C1–C6 一手材料上；阿伦斯只作二手文献并如实标注 |

**明确不主张**："用自己的话写能精细加工记忆"那半条认知科学主张（C1 的心理学
半边）。这里的主写手是 agent（§4），我们绝不把人类记忆的主张偷渡进 agent
系统。对 agent 成立的是**结构**那半边：原子化、寻址、链接。

## 3. 数据模型契约

### 3.1 实体（D1）

- **卡片** —— 演进自 `NoteRecord`，**逐字段不变**：`id, owner, title, body,
  createdAt, updatedAt`。卡片就是*可以*含链接的纯文本正文；v3 没有 markdown、
  没有 front-matter、没有标签。
- **链接** —— 没有存储态事实源。链接就是某卡片正文里的一次 `[[标题]]` 出现。
  存在性由解析派生；一张缓存表持有解析投影用于快速读（D5），可丢弃。
- **枢纽** —— 不是实体。枢纽就是入链数高的普通卡片；`list_hubs` 是对派生
  链接集的排名（C5：卢曼自己的枢纽也只是放着链接清单的普通卡片）。

否掉的案：给 `NoteRecord` 加 `tags`/`type`/`outbound: string[]` 列——每一样
都能从 `body` 派生，加了就制造第二事实源要维护一致性，违背本仓已经运行的
单写者纪律。

### 3.2 卡片身份（D2）

- 行键维持 `encodeURIComponent(owner)/<uuid>`——不可变，同今天；UI 路由
  （`/apps/notebook/note/:noteId`）与既有 id 继续可用。
- **`title` 在 owner 内变为唯一**，且是链接地址。唯一性在
  `write_note`/`rewrite_note` 强制，新码 `notebook/title-conflict`（拒绝消息
  带冲突卡片的 id）。
- 改名是一次单字段更新；由于链接按标题寻址，**所有入链自动跟随**（D4）。
  这是标题寻址的红利，也是我们不需要卢曼式不可变分支编号的原因（D7）。

否掉的案：内容寻址 id（正文本就可变，每次编辑都换 id，白付 churn）；标题作
行键（改名=挪行，破坏路由已在用的稳定 id）；随机 id 作链接目标（对模型不
透明——模型读 `[[a1b2c3…]]` 什么也学不到，读 `[[存储域迁移必须不丢行]]` 则
自解释）。

### 3.3 链接语法与解析器（D3）

- 语法：`[[标题]]`——内文 trim 后与该 owner 的卡片标题**精确匹配**。区分大小
  写、Unicode 精确（中文标题是一等地址；不做 ASCII slug 化，不做 NFKC 归一）。
- 一次 `[[…]]` 出现是**链接**，当且仅当：内文非空、不含 `[`、`]` 或换行、长度
  ≤ `MAX_TITLE_CHARS`。其余一切（包括 `[[1,2],[3,4]]` 这类内文含 `]` 的代码
  片段）都是字面文本，无需转义。
- 罕见情形——正文确实要字面写出 `[[像这样]]`——用 `\[[像这样]]`。反斜杠原样
  存储（解析器绝不改写正文），仅用于消除链接语义。
- 写入时解析（I3）：被写正文里每个链接都必须解析到同 owner 的既有卡片标题，
  否则整笔写入被拒，新码 `notebook/link-unresolved`；拒绝消息最多列五个包含
  该片段的既有标题，让模型能自我纠正。
- 解析器：**新文件 `plugins/notebook/src/links.ts` 自写 scanner**（约 80 行）：
  `extractLinks(body): { title: string; offset: number }[]`。
- 轮子排查（已完成，2026-11-02）：`apps|packages|plugins` 下所有
  `package.json` grep 无任何 markdown/remark/mdast/wiki-link 依赖，三个
  notebook 包也没有渲染依赖。一种语法不值得引一个解析器库；引了就得让本仓
  从此维护第二套语法。

### 3.4 改名、删除、悬挂（D4）

> **勘误（实现期，2026-11-02）。** 草案说改名时引用方正文不变——这与「标题即地址」
> 自相矛盾：`[[旧标题]]` 是字面文本，标题一移它就悬挂。已实现的语义：改名重写每张
> 引用方正文（`[[旧]]` → `[[新]]`，按语法解析、转义原样），落库前全量校验长度
> （要么全成要么不动），盖引用方的 `updatedAt`，并重指缓存行——正文与缓存保持 I4 恒等式。

- **改名**：`rewrite_note { id, title }`——唯一性检查后，put、引用方正文重写与
  缓存重指收在同一次写事务里。
- **删除**：`delete_note { id }` 在存在任何入链时**被拒**，新码
  `notebook/card-referenced`，拒绝消息列出引用方（`title` + `id`）。不级联、
  不留墓碑：想删干净的 agent 先改写引用方。这使 I3 在删除路径上也按构造成立
  ——悬挂链接没有诞生的通道。
- **悬挂**：存储态不可能出现（写入拒 + 删除守）。唯一瞬时窗口是多卡改写失败
  的中间态，由 per-owner 写串行化兜住（§3.6 注）。

### 3.5 反链是派生的；`links` 表是可丢弃缓存（D5）

- 事实源：正文。`backlinks(owner, title) ≡ { 正文中存在指向该标题链接的卡片 }`
  ——这条恒等式就是不变式 I4，按属性测试。
- 实现：同域第二张表 `links`，行 `{ owner, sourceId, targetTitle }`（键
  `${owner}/${sourceId}/${hash(targetTitle)}`），每张卡片被写时整卡重写其
  出链行。读走缓存；属性测试在随机图、改名、删除后持续比对缓存与全图扫描。
- 缓存是可丢弃派生数据，草案提议给它 `invalidRecords: 'backup-and-skip'`。
  **勘误（实现期）**：该选项声明在域级、且只在按记录布局下生效（见 §3.6），
  因此 links 缓存随域走拒绝打开的默认——损坏的缓存行响亮地挡住打开，
  这本就是本仓更偏好的姿态。

### 3.6 存储域：无介质迁移（D6，已实现形态）

> **勘误（实现期，2026-11-02）。** 草案规定版本升 1→2 带 `compatibleVersions: [1]`。
> harness 机制实情相反：单布局整文件格式拒绝任何非声明版本的存量
> （`storage-json/src/format.ts`——`compatibleVersions` 只在按记录布局的记录戳上生效），
> 而按记录布局要求记录键路径安全（`[a-zA-Z0-9_-]+`）——内嵌归属的键
> `encodeURIComponent(owner)/<id>` 永远无法承诺这一点，因为那个键本身就是隐私契约。
> 已实现的域因此保持 **version 1、单布局**，原位扩展：

```ts
defineDomain({
  name: 'notebook',
  version: 1,                    // 不变——v1 介质原生打开
  global: { schema: globalSchema, initial: { linksSyncedAt: 0 } },
  tables: {
    notes: domainTable(noteSchema),  // schema 一字未动——v1 行就是合法卡片
    links: domainTable(linksSchema), // 新增，可丢弃派生缓存
  },
})
```

- **迁移契约**：最强意义上的不存在——2.x 介质在 3.0.0 下原样打开（同版本、
  同解析器、同 schema）。`links` 表以空起步，全局 `linksSyncedAt` 标记
  （任何 3 前介质上为 0）在首次 3.0.0 打开时触发一次性从正文重建缓存；
  之后的打开直接跳过。**打开时不转换、不丢弃、不改写任何行。**
- 并发注：标题唯一性是 check-then-put，但每次变更本就走域自身的单域写链
  （服务层又叠了一道 FIFO 写链），两个并发 `write_note { title: X }` 不可能
  都过检查——`tests/service.spec.ts` 的并发用例已验证。

## 4. DSH 适配——主写手是 agent（D7）

卢曼方法假设一个人、一辈子。它的三个承重习惯在这个假设失效后必须重新推导：

| 卢曼的习惯 | 为什么对 agent 不成立 | 替代物 |
|------------|----------------------|--------|
| Folgezettel 编号（`21,3a7`） | 编码的是纸面档案的**物理**摆放（C5/C6：可查找性曾是硬问题） | 标题作地址（D2）+ 派生枢纽/反链（D5）；库可查询，纸不可 |
| 每日把闪念整理成永久卡 | 那是人的复习节拍；会话是短命的 | **写入时纪律**：解析拒绝 + 工具描述在落笔那一刻就要求一卡一想法——纪律从复习时移到写入时 |
| 靠人脑联想找链接 | 那是人的模式匹配器 | 模型的：`list_backlinks`/`list_hubs` 把邻域递给模型；首屏在开页时送达（D9） |

原样保留：**每 preset 一盒**（owner = preset id，结构性隔离，永不入参）；
原子卡；密集链接；枢纽卡；盒作为对话伙伴（C4——兑现为反链/枢纽面，即盒的
"另一个我"那半边）。

放弃的：仅编号，别无其他。本设计**尤其不**引入跨预设盒、共享图、全局知识库
——那会破坏本包隐私故事所立足的归属不变式。

**Day in the life**（契约必须能让这个场景走通）：

> 会话 A（周一）：研究员预设排查一次存储故障，写下卡片「存储域迁移必须不丢行」，
> 链到 `[[compatibleVersions 语义]]`（已有卡）。会话 B（周四，全新会话，不记得
> A）：同一预设打开 `/apps/notebook/list`；首屏列出最近卡片与枢纽；打开迁移卡
> 详情页；首屏显示它的反链——包括会话 A 那条教训与摘录；agent 读两张卡，**从盒
> 里**回答用户的问题，引用两个 id。

场景每一步都经过 §5–§6 点名的工具与页面；§10c 的 3080 清单会逐字走它。

## 5. 工具面（D8）

| 工具 | 处置 | 说明 |
|------|------|------|
| `notebook__list_notes` | 保留 | 参数与输出形状均不变 |
| `notebook__read_note` | 保留 | 不变 |
| `notebook__write_note` | 保留、收紧 | 新增拒绝 `notebook/title-conflict`、`notebook/link-unresolved`；描述改写为：一卡一想法、标题=完整短语=地址、放心链接 |
| `notebook__rewrite_note` | 保留、收紧 | 同上两项拒绝 + 改名语义（§3.4）；`expectedUpdatedAt` 守卫不变 |
| `notebook__delete_note` | 保留、收紧 | 新增拒绝 `notebook/card-referenced`，列出引用方 |
| `notebook__list_backlinks` | **新增** | 参数 `id`；返回 `{ backlinks: [{ sourceId, sourceTitle, excerpt }] }`；对话伙伴操作（C4） |
| `notebook__list_hubs` | **新增** | 无参数；按入链数取前 10，`{ hubs: [{ id, title, inboundCount }] }`；入口操作（C5） |

- 不再加其他工具。`search_cards` 被否（D10）；合并/拆分原语被否（D12——agent
  用 `rewrite_note` 组合完成）。
- 不引入新 skill；方法纪律活在工具描述里——模型本来就在那里看（做减法：不
  造第二套要同步的散文面）。
- `RemoteErrorDetailsMap` 新增错误码：`notebook/title-conflict`、
  `notebook/link-unresolved`、`notebook/card-referenced`。**联合扩张对
  `NotebookErrorCode` 的穷举 switch 是编译破坏**——计入 MAJOR 判据（D11）。

**调用方破坏清单**（对既有调用方的全部行为差异）：模型此前能成功、现在会被
拒的情形（重名标题、悬挂链接、删除被引用卡）。没有任何工具更名、删除或改参
；没有输出形状变化；`NoteView`/`NoteSummary` 不变；notebook-ui 除对变宽错误
码联合的穷举 switch 外无需修改即可编译。

## 6. 页面面（D9）

两页的 URL、原型、无人值守级别、§6 投递回报面（`task_take/complete/fail`）
全部维持现状。变更只落在首屏消息（`agent.followup` 文本）里，增加三段：

- **列表页**：笔记行之后加 `hubs:` 块（按入链数取前排）——C4/C5 的重入定位：
  新会话先看见盒的结构，再读任何单卡。
- **笔记详情页**：正文之后加 `links:`（本卡出链，附目标 id，agent 可开可读）
  与 `backlinks:`（谁指向这里，标题 + 摘录）——开页那一刻盒在回话。
- 枢纽/反链渲染为普通 `- 标题（id）` 行；不新增 PAGE 块语法、不上 PAGE-PATCH、
  不动宿主。两页维持今天的 L1/L2；`serves/evidence/escape` 文本各补一句新
  拒绝的说明，让无人值守审计轨迹保持逐字为真。

## 7. 反目标（D10）

本包**不是**：

1. 任务清单——任务归 task-center；卡片 ≠ 任务；
2. 全文搜索引擎——不做搜索工具；盒的规模（目标 ≤ 1 万卡，C5 的纸盒装了 9 万）
   用 `list_notes` + 链接 + 枢纽足够找到东西；
3. 人类 wiki——notebook-ui 保持薄面板；正文不做富渲染；
4. 跨预设知识库——owner 隔离是隐私不变式（I8），共享永远出圈；
5. markdown 渲染器——正文是纯文本；唯一结构化语法是 `[[…]]`。

## 8. 不变式与测试草图

全部 spec 进包级 `tests/`，vitest `*.spec.ts`，并发安全（"单独跑才过的 spec
是缺陷"）。

| 编号 | 不变式 | 测试草图 |
|------|--------|----------|
| I1 | 卡片可冷读（原子 + 自足） | **构造上不可单测**——由盲读测试外部裁决（§10b）；单测只管可寻址形态：非空 trim 标题、不超限（既有 `cleanTitle`/`cleanBody`） |
| I2 | title 每 owner 唯一 | `write_note` 同标题两次 → 第二次拒 `title-conflict`；并发对（Promise.all）→ 恰一次成功（per-owner 串行化）；改名撞既有标题被拒 |
| I3 | 存储态永无悬挂链接 | 写 `[[missing]]` 拒 `link-unresolved` 且带建议；`\[[missing]]` 原样存储且解析出零链接；`[[1,2],[3,4]]` 按字面存储 |
| I4 | 反链 ≡ 正文扫描 | 属性测试：随机卡图（10–200 卡，随机链接/改名/删除）；每步操作后 `backlinksOf(X)` 等于对该 owner 正文按 `[[X.title]]` 的全新全扫；缓存与扫描必须一致 |
| I5 | 改名保持图 | 卡 A 链 `[[T]]`；把 T 改名 T′；`backlinks(T′)` 含 A；各引用方 body 原样（链接按标题寻址，改名绝不改写他人正文） |
| I6 | 删除守引用 | A 链 `[[T]]`；删 T 拒 `card-referenced` 且点名 A；改写 A 去掉链接；删 T 成功 |
| I7 | v1→v2 迁移零丢失 | v1 行 fixture 在 v2 域下打开：行数与字段全等；`links` 为空；打开后首次写重建缓存；故意损坏一行 → 打开被拒（notes 表维持默认） |
| I8 | owner 隔离 | owner B 解析不到 A 的标题；A、B 同名标题共存；键按 owner 拼装（既有 `noteKey` 性质，保持绿） |
| I9 | 逆序清理 / HMR 安全 | 注册贡献测试：dispose 应用按 页面 → 工具 → 定义 逆序拆除；重注册可用；重载无泄漏（本仓每个注册贡献者都欠的检查） |
| I10 | 持久性 | 写卡片+链接 → 重开域 → 两存（既有存储域承诺，在 v2 形态上重新断言） |

组合测试：经 `packages/test-support/loader-smoke` 走真实 Loader——家族以
bundle 形态装进隔离临时 home；应用完成注册；页面会话的工具清单含
`notebook__list_backlinks` 与 `notebook__list_hubs`。

## 9. 包结构与版本面（D11）

- **在 `@veren/notebook` 上原地演进。** 卡片盒与"私有笔记本域"是同一职责，
  不触发约 20 文件/第二职责的拆包规则：新增源文件 `links.ts`（解析器）、
  `graph.ts`（缓存维护 + 查询），触碰 `types/notes/storage/tools`；家族保持
  4 包。另立 `@veren/zettelkasten` 包被否：要么分叉存储域（两个笔记本），要么
  造 note/card 双轨——本仓的既裁反馈禁止双轨兼容。
- 新文件预算（已实现形态）：核心新增 `links.ts`（解析器）、`graph.ts`
  （缓存 + 查询）、`validate.ts`（写入时规则）、`cards.ts`（写路径）、
  `tools-graph.ts`（两件新构建器）与 `store.ts`（存储生命周期抽出，让
  `index.ts` 守住上限）；`notebook-app` 同理新增 `first-screen.ts`。
  每个文件都守住 300 行上限。
- **版本：MAJOR `3.0.0`，走 `-rc.N` 先过预发布环境（3100），测试节点（3080）
  跟随。** 判据：(a) `NotebookErrorCode` 联合扩张——对穷举 switch 是 TS 破坏；
  (b) 存储有效性收紧——v2.2.1 接受的状态（重名标题、指向任处的自由正文）从
  3.0.0 起被拒。按版本规范（`docs/versioning.cn.md`），MAJOR = 契约/数据破坏，
  MAJOR 必须走 `-rc.N` 过 staging。家族同线齐升（notebook / notebook-app /
  notebook-ui / notebook-bundle → 3.0.0-rc.1），提交
  `chore(release): 3.0.0-rc.1 - notebook card box`，打 tag `v3.0.0-rc.1`。
- 发布门禁清单：`pnpm check` 绿；`check:plugins`（只写 peer+dev——本设计
  **零新增依赖**）；`check:entries`（`exports` 子路径在打包形态下齐全）；
  `engines.dsh` 不变（`>=0.2.1-rc.2 <0.3.0`）；市场索引只在版本变更随行更新。

## 10. 外部裁决——除了你我，谁判定这是对的

a. **不变式全绿**：I1–I10 按 §8 草图，含 I4 属性测试与 I7 迁移 fixture。
   不依赖任何人眼。
b. **盲读测试**（原子性的裁决者）：从有料的盒（或 3080 种子数据）随机抽
   10 张卡，逐张递给**无页面上下文**的全新模型，问"这张卡在说什么？它引用了
   什么你看不见的东西？"——每张卡都必须能被独立解释。这是 C1 的外部裁决；
   不过关的卡是内容缺陷不是代码缺陷，失败率如实上报，不藏。
c. **真机清单（3080，人话判据）**：
   1. 升级路径：装新包后既有笔记全部可见且完好；
   2. 写一张链到既有卡的卡 → 成功；
   3. 写一张链到不存在标题的卡 → 被拒且带建议；
   4. 给目标卡改名 → 引用方正文被改写到新标题，反链跟随；
   5. 删除被引用的目标 → 被拒且点名引用方；
   6. `list_backlinks` / `list_hubs` 返回如实段落；
   7. 重启 harness → 卡片与链接完好（I10 在真实存储上）；
   8. 卸载组合包 → 干净拆除，无孤儿注册。
d. **门禁**：`pnpm check`、`check:plugins`、`check:entries`、版本规则
   （禁跳号、先 bump 再发布）——机械执行，由发布流程跑。

## 11. 许可红线

- 仅为**设计参考**而查阅过的实现：Logseq、Joplin、SiYuan、Trilium、Zettlr
  （皆 AGPL/GPL）——**不移植、不衍生任何代码**；
- Foam（MIT）在需要时可参考其数据模型形态，实现 PR 中注明出处；
- 解析器与图代码从本文档的契约出发编写，不抄任何上游实现。

## 12. 实现顺序（评审通过后的后续任务）

1. **P1——核心契约**：`links.ts`、`graph.ts`、存储域 v2 + 迁移 fixture、
   收紧的校验、per-owner 写串行化、I2–I10 spec。
2. **P2——工具与页面面**：两个新构建器、收紧的描述、首屏三段、无人值守
   meta 审计、loader-smoke 组合测试。
3. **P3——notebook-ui 认账**：列表加反链计数，详情加链接/反链段；新串的
   中英文 locale。
4. **P4——发布列车**：`3.0.0-rc.1` → staging 3100 验收 → 3080 跟随 →
   §10c 清单 → `3.0.0` 正式 + 市场索引 bump。

---

## 附录 A——来源

- Luhmann, N. (1981). *Kommunikation mit Zettelkästen. Ein Erfahrungsbericht.*
  英译：<https://zettelkasten.de/communications-with-zettelkastens/>
- Matuschak, A. *Evergreen notes should be atomic.*
  <https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic>
- Matuschak, A. *Evergreen notes should be densely linked.*
  <https://notes.andymatuschak.org/Evergreen_notes_should_be_densely_linked>
- Matuschak, A. *Prefer note titles with complete phrases.*
  <https://notes.andymatuschak.org/Prefer_note_titles_with_complete_phrases>（按标题引用；抓取不稳定）
- Schmidt, J. 访谈：*The Money Is in the Hubs*。引数：ZK I 24,000 卡 +
  1,800 文献条目；ZK II 66,000 + 16,000。
  <https://zettelkasten.de/posts/zettelkasten-hubs/>
- 尼卡斯·卢曼档案馆（比勒费尔德）——真卡扫描、Folgezettel 编号：
  <https://niklas-luhmann-archiv.de>
- Doto, B. *Tensions Between Zettelkasten & the Productivity Scene.*
  <https://writing.bobdoto.computer/tensions-between-zettelkasten-and-the-productivity-scene>
- Ahrens, S. *How to Take Smart Notes*——仅作二手文献，按 C7 标注。
- harness 存储域机制：`deepseek/deepseek-harness/packages/storage/storage-domain/src/spec.ts`
  （`compatibleVersions`、`invalidRecords`、layout 语义）。

## 附录 B——环境注记

- `pnpm cli` 工具当前故障（harness `FiberState` 导出漂移，
  `apps/cli/src/profile-boot.ts:16`）。本设计要求的轮子排查改由直接读取
  `package.json` 完成——在此记为获准的绕行；修 cli 是独立任务，不在本题范围。
- 所有验证只用稳定节点 `deepseek\.dsh`（3080），rc 走预发布环境（3100），
  依 `docs/environments.cn.md`；每条 `dsh` 命令显式携带 `DSH_HOME`。
