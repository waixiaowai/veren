# @veren/startup-autostart-ui

启动项的 **Web 面板**：侧栏里一个以本插件命名的入口，加一个全局页面，用来列出、修改、
立即运行和删除由 [`@veren/startup-autostart`](../startup-autostart/README.cn.md) 存储的
启动项。

适合"人自己要看得见、改得动启动项"的场合。headless / ACP / SDK profile 不需要装它——
那里没有浏览器，而且宿主服务加 `@veren/startup-autostart-tool` 已经覆盖全部操作。

## 它是什么

一行 Loader 行 + 一个浏览器半边。Node 半边是空的，它存在的意义是让 Web 应用能发现浏览器
模块（客户端模块系统通过扫描活跃 Loader 行的 `dsh.client` 清单来发现）。

本包**不声明** `dsh.bundle.patch`，所以单独装它只会多一个依赖、不会多一行 Loader 行。
要装就装组合包——它把本行连同宿主行、工具行一起插进去：

```sh
plugin_manager  install_bundle  target = @veren/startup-autostart-bundle@1.4.6
```

装完刷新页面。卸载组合包会整体去掉这三行；已存储的启动项不受影响。

## 页面怎么用

侧栏入口就在随发行版交付的「自动化任务」旁边。

- **列表**：名字、启用开关（点了就写盘）、动作、目标摘要、上次结果与时间、执行次数。
  搜索匹配名字、消息和会话 id；筛选有「全部 / 启用中 / 已停用」。
- **详情**：完整字段。名字、启用、动作、目标、消息可改；保存**只提交真正改动过的字段**，
  所以别处的修改不会被覆盖。面板同时展示不可编辑的事实：id、模型、创建/更新时间、
  上次执行、上次结果、执行次数。
- **立即运行一次**：不等下次启动，当场投递。
- **删除**：先二次确认，再删除。
- **新建**：打开一个新会话，由模型用 `startup_create` 登记。页面本身没有表单——和自动化
  任务页面一致：字段规则只有一份实现，不在浏览器里再抄一份。

文案中英双语，走客户端 locale 服务，跟随应用语言。

## 它怎么读写

页面通过 `startup` Remote 命名空间（`catalog` / `create` / `update` / `delete` / `run`）
与宿主通信——和模型的 `startup_*` 工具用的是同一批端点，因此页面与工具始终操作同一份
记录集合。

该命名空间**不是**为本包生成的。生成的 Remote contribution 由
`scripts/generate-typert.ts` 产出，而它只读 DeepSeek Harness 检出仓库里的包；浏览器的
Remote 装配又只挂载一份固定清单。因此本包用 `createTypertRemoteInfo`（生成工件所调用的
同一个构造函数）手工构造同样的 contribution，并在自己的 `apply` 里挂载。
`src/client/remote.ts` 是镜像宿主端点的唯一位置。

## 刷新

两件事会重读列表：宿主的 `startup-autostart/changed` 通知，以及连接代被替换（重连）。
**没有任何轮询。**

宿主在每次落盘后发这条通知，Web 应用会转发它——因为该事件在转发白名单里
（`packages/api/remotes/src/remote-events.ts`，紧邻 `schedule/changed` 的一条 `emit`）。
所以模型用 `startup_create` 建的启动项会自己出现，不需要用户操作。

## 构建

`veren cli build` 会把本包判定为前端插件（它声明了 `dsh.client`），运行
`npm run bundle`，产出两半：`dist/index.js`（空的 Node 行）和 `lib/client.js`
（浏览器模块）。

```sh
pnpm cli build @veren/startup-autostart-ui
```

## 模型体验

无。面板不注册任何面向模型的工具、提示或消息，只读写宿主服务已经持有的记录。这里没有任何
内容进入模型请求，因此没有 KV cache 影响。

## 已知限制与后续工作

- 新建没有表单：新启动项从会话开始，与自动化任务页面一致。
- 实时刷新依赖检出仓库的转发白名单里带有 `startup-autostart/changed`。如果某个 profile 用的
  DeepSeek Harness 检出早于这条白名单，面板仍能正常渲染，但只在重连和挂载时重读。
- 面板用一份注入的样式表而不是 CSS Module，因为本包在客户端打包器之外构建，没有编译
  `*.module.css` 的管线。颜色只取自共享的 `--dsw-*` token。
