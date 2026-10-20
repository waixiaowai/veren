# @veren/notebook

给每个 agent 预设一本私密、持久的记事本：预设通过 `notebook_*` 工具读写，人通过
`notebook` Web 页面读写同一份记录。

## 什么情况下用它

当预设需要保存「跟着预设走、不跟着工作区走」的私密笔记，并且人也要在 Web GUI 里打开
同一批笔记时，用这个包。共享笔记、团队笔记、挂在项目上的笔记不要用它。

## 归属与隔离

笔记的归属永远是写入它的 Agent 的预设 id。面向模型的工具没有归属参数：`notebook_tools.ts`
在每次调用时从活着的 Agent 解析归属。存储键由
`encodeURIComponent(owner) + "/" + noteId` 组成，因此预设即使传了另一个预设的笔记 id，也只会
按自己的归属拼出键，命中的是「不存在」。Web 页面确实允许人选择看谁的记事本；这正是页面的
职责，不是工具的能力。

笔记不挂在任何工作区上。同一个预设在任何工作区、任何会话里都是同一本记事本。

## 面向模型的工具

| 工具 | 用途 |
| --- | --- |
| `notebook_list` | 列出调用者自己那本笔记，最近更新的在前。 |
| `notebook_read` | 读一条笔记的完整正文。 |
| `notebook_create` | 写一条笔记（标题必填，正文可以为空）。 |
| `notebook_update` | 替换标题、正文，或两者。 |
| `notebook_delete` | 永久删除一条笔记。 |

`notebook_update` 接受可选的 `expectedUpdatedAt`。传入后，如果笔记在读取之后又被改过，宿主
会以 `notebook/conflict` 拒绝，而不是覆盖更新的版本。

## 记事本应用

在挂载了应用注册表的宿主里（`ctx.apps`，即 app-hosting profile），插件还会注册 `notebook`
应用：`/apps/notebook/...` 下的入口列表页与笔记详情页，页面工具带 `notebook__` 前缀。没有
应用注册表的环境里这一层只降级为一条日志警告；无论哪种情况，上面的全局工具都照常工作。

| 页面 | URL | 页面工具 |
| --- | --- | --- |
| 笔记列表（入口） | `/apps/notebook/list` | `notebook__list_notes`、`notebook__write_note` |
| 笔记详情 | `/apps/notebook/note/:noteId` | `notebook__read_note`、`notebook__rewrite_note`、`notebook__delete_note` |

注册走单入口：`src/app.ts` 只调用 `ctx.apps.register`、`ctx.apps.tools(id).define` 与
`ctx.apps.pages(id).register`；页面注册器在内部镜像进页面注册表，因此应用绝不会出现在目录里
却无法按 URL 解析。插件卸载时整层按逆序摘除。应用层以 `@veren/app-registry`、
`@veren/page-registry`、`@veren/prompt-page` 为 peer 依赖；没有这些包的 profile 直接跳过该层。

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
