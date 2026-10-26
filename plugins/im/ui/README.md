# @veren/im-ui

The human face of instant messaging: a sidebar panel where a person authorizes
WeChat by scanning the QR right in the page, watches accounts, bindings, and
unlinked conversations at a glance, links or unlinks with one click, and reads
the stranger-intake audit.

即时消息的人机界面：一个侧栏面板——二维码就在页面里扫码授权微信，账号、绑定与
未接入会话一眼看全，一键接入/解绑，陌生人采集审计随手可查。

## When to use / 什么时候使用

Install alongside `@veren/im-bundle` whenever a person (not just an agent)
should manage IM from the Web GUI. Skip it for headless, ACP, or SDK profiles,
where the `im_*` tools already cover every operation.

只要有人（而不仅是 agent）需要在 Web 界面管理 IM，就随 `@veren/im-bundle` 一起安装。
headless、ACP、SDK profile 跳过——`im_*` 工具已覆盖全部操作。

## What the panel shows / 面板内容

| Tab / 页签 | Content / 内容 |
|---|---|
| 账号 Accounts | authorized accounts + the QR bind wizard (live status, in-page verify-code input) / 已授权账号 + 扫码绑定向导（实时状态、页面内验证码输入） |
| 绑定 Bindings | every conversation→Session binding with active state; unlinked conversations with one-click link / 全部会话→Session 绑定与接收状态；未接入会话一键接入 |
| 人员 People | the directory the inbound side feeds automatically / 入站自动收录的人员目录 |
| 采集 Intake | the stranger-intake switch, counts, and recent audit rows / 采集开关、计数与最近审计 |

## Architecture / 架构

Browser-only plugin (the Node half is an empty Loader row). The browser half
mounts the `im` Remote namespace by hand — the host side lives in
`@veren/im`'s `gateway-remote.ts` — and renders one observable polled every
five seconds; the bind wizard polls every two seconds while open. Styles are
hand-prefixed `.im-*` over the shared `--dsw-*` theme tokens; copy is typed
zh/en with compile-error parity.

纯浏览器插件（Node 半边是空 Loader 行）。浏览器半边手工挂载 `im` 远端命名空间
（宿主侧在 `@veren/im` 的 `gateway-remote.ts`），渲染一个每五秒轮询的可观察对象；
绑定向导打开期间每两秒轮询。样式为 `.im-*` 手工前缀 + 共享 `--dsw-*` 主题 token；
文案双语类型化，漏译即编译错误。
