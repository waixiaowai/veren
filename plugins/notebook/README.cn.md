# @veren/notebook

给每个 agent 预设一只私密、持久的卡片盒——落在记事本域上的卡片笔记法契约（设计书：
[docs/notebook-zettelkasten-design.cn.md](../../docs/notebook-zettelkasten-design.cn.md)）：
卡片原子化，标题就是卡片的链接地址，正文携带 `[[标题]]` 链接，派生的 `links` 缓存应答
反链/枢纽查询——盒在回话。人通过 `notebook` 远端命名空间读写，模型通过由挂载方注册的
导出工具构建器读写。

## 什么情况下用它

当预设需要保存「跟着预设走、不跟着工作区走」的私密卡片，把它们连成知识网络，并且人也
要在 Web GUI 里打开同一只盒时，用这个包。共享笔记、团队笔记、挂在项目上的笔记不要用它；
它也不是任务清单，更不是全文搜索引擎。本包自己不注册任何工具；如果模型需要够到卡片盒，
装 **`@veren/notebook-app`**（或在自己的宿主代码里挂载导出的构建器）。

## 0.2.0 破坏性变更

全局 `notebook_*` 工具**已退役**。普通会话再也看不到任何记事本工具；七件工具只活在
记事本页面会话里，以 `notebook__*` 的形态由 `@veren/notebook-app` 挂载——预设要用
卡片盒，就打开 `/apps/notebook/list`（列表页）从那里干活。这是刻意为之的 0.x 破坏性
变更：一个能力，一个注册面，一个可查之处。

## 归属与隔离

卡片的归属永远是写入它的 Agent 的预设 id。工具构建器没有归属参数：`src/tools.ts`
在每次调用时从活着的 Agent 解析归属。存储键由
`encodeURIComponent(owner) + "/" + cardId` 组成，因此预设即使传了另一个预设的卡片 id，
也只会按自己的归属拼出键，命中的是「不存在」。Web 页面确实允许人选择看谁的卡片盒；
这正是页面的职责，不是工具的能力。

卡片不挂在任何工作区上。同一个预设在任何工作区、任何会话里都是同一只盒。

## 卡片、标题与链接

- **标题即链接地址。** 标题在归属内唯一（撞题以 `notebook/title-conflict` 拒绝），
  写卡时正文里的每个 `[[标题]]` 都必须解析到同归属的既有卡片（否则以
  `notebook/link-unresolved` 拒绝，并给出相近的既有标题）。悬挂链接永不入库。
- **改名自动跟随。** 改名会重写每张引用卡的正文并重指缓存行，`[[旧标题]]` 永不悬挂；
  引用方的更新时间随改写前移。
- **删除有守卫。** 仍有卡链接目标时，`delete_note` 以 `notebook/card-referenced`
  拒绝（点名引用方）。
- **转义与代码。** `[[1,2],[3,4]]` 保持字面（内文带括号）；字面双括号写 `\[[像这样]]`。
- **反链是派生的，绝不是事实源。** `links` 表是每次写入维护的可丢弃缓存；
  `tests/cards.spec.ts` 的属性测试在随机操作史上持续钉住「缓存 ≡ 全图扫描」。

## 工具构建器

本包为每个操作导出一个构建器——五件 CRUD 加盒的两件「回话」构建器
（`buildNotebookBacklinksDefinition`、`buildNotebookHubsDefinition`）。每个构建器返回一个
执行时按调用者限定的 `defineTool` 产物；本文件不做任何注册。挂载方把产物 define 进应用
目录并挂进页面会话，注册表由此拼出对外名 `notebook__<本地名>`。

| 构建器 | 工具（本地名） | 用途 |
| --- | --- | --- |
| `buildNotebookListDefinition` | `list_notes` | 列出调用者自己那只盒，最近更新的在前。 |
| `buildNotebookReadDefinition` | `read_note` | 读一张卡的完整正文。 |
| `buildNotebookWriteDefinition` | `write_note` | 写一张卡（标题须唯一；`[[标题]]` 链接必须可解析）。 |
| `buildNotebookRewriteDefinition` | `rewrite_note` | 替换标题、正文，或两者；改名让入链自动跟随。 |
| `buildNotebookDeleteDefinition` | `delete_note` | 永久删除一张卡；被引用时被拒。 |
| `buildNotebookBacklinksDefinition` | `list_backlinks` | 链到某张卡的那些卡。 |
| `buildNotebookHubsDefinition` | `list_hubs` | 盒的入口，按入链数排名。 |

`rewrite_note` 接受可选的 `expectedUpdatedAt`。传入后，如果卡片在读取之后又被改过，
工具会以 `notebook/conflict` 拒绝，而不是覆盖更新的版本。

## 记事本应用：唯一的注册面

应用面（带 `/apps/notebook/...` 页面与 `notebook__*` 页面工具的 `notebook` 应用）住在
独立的 **`@veren/notebook-app`** 包里（G2 拆包），它是唯一注册任何东西的面。本宿主完全
不声明应用框架 inject（G2）：即使在框架缺席的 headless 部署里也照常激活；
`tests/app.spec.ts` 钉死了这条契约（在没有 `apps` 服务的上下文上激活、不向任何工具
注册表登记、全程无注入等待告警）。把记事本变成应用要装 `@veren/notebook-app`——该包
硬注入应用框架与 `notebook` 服务。

| 页面 | URL | 页面工具 |
| --- | --- | --- |
| 卡片列表（入口） | `/apps/notebook/list` | `notebook__list_notes`、`notebook__write_note`、`notebook__list_hubs` |
| 卡片详情 | `/apps/notebook/note/:noteId` | `notebook__read_note`、`notebook__rewrite_note`、`notebook__delete_note`、`notebook__list_backlinks` |

注册走单入口：`notebook-app` 的 `src/app.ts` 只调用 `ctx.apps.register`、
`ctx.apps.tools(id).define` 与 `ctx.apps.pages(id).register`，三步收在单个 `ctx.effect` 里，
任何一步失败都逆序回滚已完成的步骤（不留半接线）；页面注册器在内部镜像进页面注册表，
因此应用绝不会出现在目录里却无法按 URL 解析。插件卸载时整层按逆序摘除。

## 存储

插件打开一个名为 `notebook` 的存储域（version 1，与 2.x 相同——2.x 介质原生打开，
不存在迁移运行），含 `notes` 表、派生的 `links` 缓存表，以及全局 `linksSyncedAt`
标记——首次以 3.0.0 打开时它触发一次性的链接重建。JSON 后端下文件是
`$DSH_HOME/storages/notebook.json`；SQLite 后端下是 profile 数据库里的同名域。Harness 重启、
浏览器刷新、删掉项目目录之后卡片都还在。

域打不开时，服务记录失败原因，所有操作返回 `notebook/storage-unavailable`；Harness 的其余
部分继续运行。

## 已知边界

- **预设被删了。** 卡片保留，不丢。Web 页面把归属显示为「预设已删除，笔记仍保留」，人仍可
  查看或删除这些卡片。同名预设重新出现时，看到的还是同一只盒。
- **卡片很长。** 标题上限 200 字符，正文上限 100,000 字符。宿主以
  `notebook/body-too-long` 拒绝并说明实际长度；页面显示实时计数。
- **空白卡片。** 标题必填，正文可以为空。只有空白的标题以 `notebook/title-required` 拒绝。
- **两边同时改。** 页面保存时带上 `expectedUpdatedAt`；过期保存以 `notebook/conflict` 拒绝，
  页面保留草稿。工具也支持同一个可选守卫；不传时后写覆盖先写。
- **链接指向不存在处。** 写入以 `notebook/link-unresolved` 拒绝并给出相近既有标题；
  先写目标卡，或用 `\[[` 转义字面。
- **标题撞车。** 标题即地址：写入以 `notebook/title-conflict` 拒绝并点名持题的卡。
- **删除被引用的卡。** 以 `notebook/card-referenced` 拒绝并点名引用方；先去掉那些链接。
- **存储打不开。** 读写都以稳定错误码失败；页面显示失败原因和重试按钮。

## 开发

```sh
pnpm --dir plugins/notebook typecheck
pnpm --dir plugins/notebook test
pnpm --dir plugins/notebook build
```

本包在 Harness 工作区之外构建：`scripts/build.mjs` 用检出仓库自带的 TypeScript 逐文件转译，
类型检查通过 `tsconfig.paths.json` 对着检出仓库的真实源码运行。

## 验证

非工程师的点击步骤与已知边界见
[docs/notebook-verification.cn.md](../../docs/notebook-verification.cn.md)。
