# @veren/im-ui

The human face of the collaboration workspace: a sidebar panel where a person
reads every conversation room's timeline, authorizes WeChat by scanning the QR
right in the page, watches accounts and the people directory at a glance, and
reads the stranger-intake audit.

协作工作区的人机界面：一个侧栏面板——人可以在这里读每个房间的时间线、二维码就在页面里
扫码授权微信、账号与人员目录一眼看全、陌生人采集审计随手可查。

## When to use / 什么时候使用

Install alongside `@veren/im-bundle` whenever a person (not just an agent)
should manage IM from the Web GUI. Skip it for headless, ACP, or SDK profiles,
where the `im_*` tools already cover every operation.

只要有人（而不仅是 agent）需要在 Web 界面管理 IM，就随 `@veren/im-bundle` 一起安装。
headless、ACP、SDK profile 跳过——`im_*` 工具已覆盖全部操作。

## What the panel shows / 面板内容

| Tab / 页签 | Content / 内容 |
|---|---|
| 会话 Conversations | every room's timeline (channel-backed and internal rooms); opening advances the owner's read cursor / 全部房间的时间线（渠道背书与内部房间）；打开即推进所有者已读游标 |
| 云端 Cloud | the CMS-backed cloud gateway: authorization funnel, directory, status / CMS 云网关：授权漏斗、目录、状态 |
| 采集 Intake | the stranger-intake switch, counts, and recent audit rows / 采集开关、计数与最近审计 |

## Architecture / 架构

Browser-only plugin (the Node half is an empty Loader row). The browser half
mounts two Remote namespaces by hand — `im` (the core: accounts, people,
intake, QR bind) and `imConv` (the conversation domain: rooms, members,
messages, markRead) — and renders observables polled every five seconds; the
bind wizard polls every two seconds while open. Styles are hand-prefixed
`.im-*` over the shared `--dsw-*` theme tokens; copy is typed zh/en with
compile-error parity.

纯浏览器插件（Node 半边是空 Loader 行）。浏览器半边手工挂载两个远端命名空间——`im`
（核心：账号、人员、采集、扫码绑定）与 `imConv`（会话域：房间、成员、消息、已读）——
渲染每五秒轮询的可观察对象；绑定向导打开期间每两秒轮询。样式为 `.im-*` 手工前缀 +
共享 `--dsw-*` 主题 token；文案 zh/en 双语带编译期 parity。

纯浏览器插件（Node 半边是空 Loader 行）。浏览器半边手工挂载 `im` 远端命名空间
（宿主侧在 `@veren/im` 的 `gateway-remote.ts`），渲染一个每五秒轮询的可观察对象；
绑定向导打开期间每两秒轮询。样式为 `.im-*` 手工前缀 + 共享 `--dsw-*` 主题 token；
文案双语类型化，漏译即编译错误。
