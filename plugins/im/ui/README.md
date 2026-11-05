# @veren/im-ui

The human face of the collaboration workspace: a sidebar panel where a person
opens conversations, writes into a room and watches the agent answer, authorizes
WeChat by scanning the QR right in the page, browses accounts and the people
directory, and reads the stranger-intake audit.

协作工作区的人机界面：一个侧栏面板——人在这里新建会话、往房间里写字并看着智能体回复、
二维码就在页面里扫码授权微信、账号与人员目录一眼看全、陌生人采集审计随手可查。

## When to use / 什么时候使用

Install alongside `@veren/im-bundle` whenever a person (not just an agent)
should manage IM from the Web GUI. Skip it for headless, ACP, or SDK profiles,
where the `im_*` tools already cover every operation.

只要有人（而不仅是 agent）需要在 Web 界面管理 IM，就随 `@veren/im-bundle` 一起安装。
headless、ACP、SDK profile 跳过——`im_*` 工具已覆盖全部操作。

## What the panel shows / 面板内容

| Tab / 页签 | Content / 内容 |
|---|---|
| 会话 Conversations | every room's timeline; 「新建会话」seats the owner and the default agent, the composer writes as `human:owner`, and the five-second poll refreshes the list *and* the open timeline so an agent's reply lands without a manual refresh. Unread counts ride the same poll and clear when a room is opened; `@` opens a keyboard-reachable member picker; each message offers a hover copy action; newer messages follow the reader only while they are at the bottom, otherwise a "jump to latest" pill appears / 全部房间的时间线；「新建会话」给所有者与默认智能体安排座位，输入区以 `human:owner` 写入，五秒轮询同时刷新列表与打开中的时间线，智能体的回复无需手动刷新即可出现。未读数随同一次轮询到达、打开房间即清空；输入 `@` 打开键盘可达的成员选择器；每条消息有悬停复制；新消息只在读者位于底部时跟随，否则给出「回到最新」胶囊 |
| 智能体 Agents | the roster derived from room seats: a display heading with the count, summary chips (agents / conversations / unread), and one card per agent with its room count, last activity and a chat action that opens or starts a direct conversation / 从房间座位推导的名册：带计数的大标题、摘要芯片（智能体/会话/未读），每个智能体一张卡片，显示会话数、最近活动与「聊天」动作（打开或新建私聊） |
| 账号 Accounts | authorized accounts with online/offline badges, the QR bind wizard (start, poll, verify code), and unbind / 已授权账号与在线徽标、二维码绑定向导（发起、轮询、验证码）与解绑 |
| 人员 People | the address book: names, identity badges, contact chips, and inline rename / 通讯录：名字、身份徽标、联系方式芯片与就地改名 |
| 设置 Settings | the two 2.x surfaces kept out of the everyday path: stranger-intake audit and the CMS cloud directory / 从日常路径里退出的两个 2.x 面：陌生人采集审计与 CMS 云端目录 |

## Write paths / 写入路径

The panel is the only surface that writes as the human. `imConv` exposes
`post` and `createRoom` next to the read methods; both go through the
conversation service, which announces `im/message-new` after a fresh commit.
That event is what wakes the agent — channel ingest, the model's `im_send`, and
the composer all feed the same fan-out.

面板是唯一以「人」的身份写入的表面。`imConv` 在读取方法旁暴露 `post` 与
`createRoom`；两者都走会话服务，由它在提交后发出 `im/message-new`。这个事件正是唤醒
智能体的输入——渠道吸收、模型的 `im_send` 与输入区都汇入同一个扇出。

## Architecture / 架构

Browser-only plugin (the Node half is an empty Loader row). The browser half
mounts two Remote namespaces by hand — `im` (the core: accounts, people, intake,
QR bind) and `imConv` (the conversation domain: rooms, members, messages, post,
createRoom, markRead, unreadCounts) — and renders observables polled every five
seconds; the bind wizard polls every two seconds while open. Styles define the
Cumora palette once (sky / coral / gold / whisper / ink / paper / cloud, with a
dark override) and every rule reads a token; copy is typed zh/en with
compile-error parity.

纯浏览器插件（Node 半边是空 Loader 行）。浏览器半边手工挂载两个远端命名空间——`im`
（核心：账号、人员、采集、扫码绑定）与 `imConv`（会话域：房间、成员、消息、写入、
建房、已读、未读计数）——渲染每五秒轮询的可观察对象；绑定向导打开期间每两秒轮询。样式在
令牌块里定义一次 Cumora 调色板（sky / coral / gold / whisper / ink / paper / cloud，
含暗色覆盖），所有规则只读令牌；文案 zh/en 双语带编译期 parity。
