# @veren/notebook

给每个 agent 预设一本私密、持久的记事本：一个纯领域服务，人通过 `notebook` 远端
命名空间读写，模型通过由挂载方注册的导出工具构建器读写。

## 什么情况下用它

当预设需要保存「跟着预设走、不跟着工作区走」的私密笔记，并且人也要在 Web GUI 里打开
同一批笔记时，用这个包。共享笔记、团队笔记、挂在项目上的笔记不要用它。本包自己不注册
任何工具；如果模型需要够到记事本，装 **`@veren/notebook-app`**（或在自己的宿主代码里
挂载导出的构建器）。

## 0.2.0 破坏性变更

全局 `notebook_*` 工具**已退役**。普通会话再也看不到任何记事本工具；五个工具只活在
记事本页面会话里，以 `notebook__*` 的形态由 `@veren/notebook-app` 挂载——预设要用
记事本，就打开 `/apps/notebook/list`（列表页）从那里干活。这是刻意为之的 0.x 破坏性
变更：一个能力，一个注册面，一个可查之处。

## 归属与隔离

笔记的归属永远是写入它的 Agent 的预设 id。工具构建器没有归属参数：`src/tools.ts`
在每次调用时从活着的 Agent 解析归属。存储键由
`encodeURIComponent(owner) + "/" + noteId` 组成，因此预设即使传了另一个预设的笔记 id，
也只会按自己的归属拼出键，命中的是「不存在」。Web 页面确实允许人选择看谁的记事本；
这正是页面的职责，不是工具的能力。

笔记不挂在任何工作区上。同一个预设在任何工作区、任何会话里都是同一本记事本。

## 工具构建器

本包为每次记事本操作导出一个构建器（`buildNotebookListDefinition`、
`buildNotebookReadDefinition`、`buildNotebookWriteDefinition`、
`buildNotebookRewriteDefinition`、`buildNotebookDeleteDefinition`）。每个构建器返回一个
执行时按调用者限定的 `defineTool` 产物；本文件不做任何注册。挂载方把产物 define 进应用
目录并挂进页面会话，注册表由此拼出对外名 `notebook__<本地名>`。

| 构建器 | 工具（本地名） | 用途 |
| --- | --- | --- |
| `buildNotebookListDefinition` | `list_notes` | 列出调用者自己那本笔记，最近更新的在前。 |
| `buildNotebookReadDefinition` | `read_note` | 读一条笔记的完整正文。 |
| `buildNotebookWriteDefinition` | `write_note` | 写一条笔记（标题必填，正文可以为空）。 |
| `buildNotebookRewriteDefinition` | `rewrite_note` | 替换标题、正文，或两者。 |
| `buildNotebookDeleteDefinition` | `delete_note` | 永久删除一条笔记。 |

`rewrite_note` 接受可选的 `expectedUpdatedAt`。传入后，如果笔记在读取之后又被改过，
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
| 笔记列表（入口） | `/apps/notebook/list` | `notebook__list_notes`、`notebook__write_note` |
| 笔记详情 | `/apps/notebook/note/:noteId` | `notebook__read_note`、`notebook__rewrite_note`、`notebook__delete_note` |

注册走单入口：`notebook-app` 的 `src/app.ts` 只调用 `ctx.apps.register`、
`ctx.apps.tools(id).define` 与 `ctx.apps.pages(id).register`，三步收在单个 `ctx.effect` 里，
任何一步失败都逆序回滚已完成的步骤（不留半接线）；页面注册器在内部镜像进页面注册表，
因此应用绝不会出现在目录里却无法按 URL 解析。插件卸载时整层按逆序摘除。

## 存储

插件打开一个名为 `notebook` 的存储域，只有一张 `notes` 表。JSON 后端下文件是
`$DSH_HOME/storages/notebook.json`；SQLite 后端下是 profile 数据库里的同名域。Harness 重启、
浏览器刷新、删掉项目目录之后笔记都还在。

域打不开时，服务记录失败原因，所有操作返回 `notebook/storage-unavailable`；Harness 的其余
部分继续运行。

## 已知边界

- **预设被删了。** 笔记保留，不丢。Web 页面把归属显示为「预设已删除，笔记仍保留」，人仍可
  查看或删除这些笔记。同名预设重新出现时，看到的还是同一本。
- **笔记很长。** 标题上限 200 字符，正文上限 100,000 字符。宿主以
  `notebook/body-too-long` 拒绝并说明实际长度；页面显示实时计数。
- **空白笔记。** 标题必填，正文可以为空。只有空白的标题以 `notebook/title-required` 拒绝。
- **两边同时改。** 页面保存时带上 `expectedUpdatedAt`；过期保存以 `notebook/conflict` 拒绝，
  页面保留草稿。工具也支持同一个可选守卫；不传时后写覆盖先写。
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
