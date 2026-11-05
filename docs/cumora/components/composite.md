---
title: 复合组件
description: "第 25 章复合组件：23 个组合件的 Props、插槽、响应式、事件上抛、组合写法与节奏约束。"
sidebar:
  order: 25
  label: 25 复合组件
draft: false
lastUpdated: 2026-11-04
---

## 25. Composite Components

复合组件把 [第 24 章](./basic/) 的原子拼成有形状的一块：菜单、弹层、抽屉、表单、手势容器。它负责布局、插槽、对齐、响应式与组件之间的交互，但不取业务数据，也不知道“这个人能不能删”。数据、权限与提交结果全部由使用它的业务组件注入，本章只约定切口在哪里、事件往哪里抛。

### 25.1 Layer Rules

| 允许 | 禁止 |
| --- | --- |
| 决定子元素的排列、间距、对齐、滚动容器与断点行为 | 调用接口、订阅全局状态、读写业务缓存 |
| 定义插槽与渲染位，接受外部传入的节点 | 在内部按角色或租户决定显示哪些子元素 |
| 管理弹层的开合、层级、遮罩与焦点归还 | 自行决定提交后跳转到哪个视图 |
| 把子组件事件归一后上抛 | 吞掉失败、伪造成功或自动重试 |
| 通过 props 接受尺寸、密度、语气与初始值 | 持有跨组件共享的可变状态 |

子组件之间不直接通信：行内按钮不调用弹层，弹层不读列表。所有跨层动作都先上抛到业务组件，再由业务组件决定给谁。唯一的例外是焦点：打开层记住触发元素、关闭时归还，这对交互闭环是必需的，因此留在复合层。

### 25.2 Inventory

按浮层与选择、内容块、通知与更新、表单弹层、移动手势五组排列。插槽一列只写槽位名与默认内容；“响应式”一列写窄屏与宽屏的差别；“上抛”一列写事件名与载荷。

**浮层与选择**

| 组件 | 用途 | 输入 Props | 插槽 | 响应式 | 上抛事件 |
| --- | --- | --- | --- | --- | --- |
| ContextMenu | 桌面右键菜单，支持子菜单与视口翻转 | x, y, items, onClose | 无，items 驱动 | 贴边时水平或垂直翻转，超高滚动 | onSelect(item)，onClose |
| MobileContextMenu | 长按菜单，背景压暗并模糊 | open, anchor, items, caption, onClose | 无 | 以手指为锚，上下留安全区 | onSelect(item)，onClose |
| DateTimePicker | 日期时间弹层，含月历网格 | value, mode, allowClear, compact | 输入框与日历网格 | 窄屏整行占满，格子最小 40px | onChange(value)，onClose |
| MembersPopover | 成员名册浮层，挂在触发器旁 | members, anchor, triggerRef, onClose | AvatarStack 与成员行 | 触发器居中翻转，滚动容器内跟随 | onSelectMember(member) |
| MentionList | 提及候选列表，暴露命令式句柄 | items, command, ref | 头像与高亮行 | 固定定位，空间不足向上翻 | command(item) |
| LinkPreview | 消息内首个链接的预览卡 | url | 标题、摘要、站点图标 | 窄屏隐藏摘要，保留标题 | onOpen(url) |
| ImageViewer | 缩放平移灯箱，0.1 到 12 倍 | src, name, onClose | 工具栏与图注 | 移动全屏，桌面留边距 | onClose |

**内容块**

| 组件 | 用途 | 输入 Props | 插槽 | 响应式 | 上抛事件 |
| --- | --- | --- | --- | --- | --- |
| MermaidBlock | 懒加载渲染图，产物经净化 | code, fallback | 图与源码折叠 | 超宽横向滚动，不缩字号 | 失败回退 fallback，不抛错 |
| PollBubble | 投票气泡，单选多选与倒计时 | msg | 选项行与票数条 | 窄屏选项换行，票数条一行 | onVote(optionIds) |
| PollComposer | 发起投票的弹层 | conversationId, onSubmitted, onCancel | 选项输入行与添加按钮 | 窄屏全屏，按钮固定底部 | onSubmitted(poll)，onCancel |
| ComposerAttachments | 附件芯片，含进度与重试 | files, onRetry, onRemove | 缩略图、进度条、错误角标 | 横向滚动，最多两行 | onRetry(id)，onRemove(id) |

**通知与更新**

| 组件 | 用途 | 输入 Props | 插槽 | 响应式 | 上抛事件 |
| --- | --- | --- | --- | --- | --- |
| NotificationToasts | 应用内提醒栈，按会话合并 | 无，通道驱动 | 提醒卡片与倒计时条 | 移动顶部安全区，最多 5 条 | onOpen(conversationId)，onDismiss(id) |
| NotificationWindow | 独立通知面板渲染器 | 无，主进程驱动 | 提醒列表 | 固定宽度，按内容量测高 | onFocusConvo，onReady |
| UpdaterDialog 与 UpdateBanner | 自动更新对话框与横幅 | open, onClose, forceOpen, onOpen | 版本说明与进度 | 横幅在标题栏下，窄屏折行 | onInstall，onLater |

**表单弹层**

| 组件 | 用途 | 输入 Props | 插槽 | 响应式 | 上抛事件 |
| --- | --- | --- | --- | --- | --- |
| InvitePeopleModal | 邀请链接与邮箱两种方式 | companyId, companyName, actorRole, onClose | 标签页、链接框、成员多选 | 窄屏单列，链接框可复制 | onInvited(invite) |
| GroupCreator | 选成员建群 | onClose, initialPicked | 搜索、成员多选 | 窄屏全屏，底部固定动作 | onCreated(conversationId) |
| WorkspaceSettingsModal | 成员、角色、转移与删除工作区 | company, companyCount, onInvite, onClose | 分区与危险操作区 | 桌面两栏，移动单栏 | onUpdated，onRequestDelete |
| AgentEditor | 新建或编辑智能体 | agent, onClose, onSaved | 表单分组与头像选择 | 两栏折叠为单栏 | onSaved(agent) |
| EventEditor | 日程或任务表单，含重复与提醒 | event, prefill, onClose | 表单与重复规则区 | 窄屏全屏，时间选择复用弹层 | onSaved(event)，onDelete(id) |
| EmailComposer | 邮件抽屉，新建与回复两态 | mode, threadId, onClose | 收件人、主题、正文、附件 | 桌面右侧抽屉，移动全屏 | onSend(draft)，onSaveDraft(draft) |

**移动手势**

| 组件 | 用途 | 输入 Props | 插槽 | 响应式 | 上抛事件 |
| --- | --- | --- | --- | --- | --- |
| PullToRefresh | 下拉刷新，克隆系统控件手感 | onRefresh, onScrollerReady | 指示器 | 仅触屏，阈值触发轻触感 | onRefresh() |
| SwipeableRow | 行级滑动操作，按钮在行尾展开 | actions, children | 操作按钮与行内容 | 仅横滑，纵滑让位给列表 | onAction(actionId) |
| MobileMessageTapback | 长按消息的表情回应条 | message, onReact | 六个固定表情 | 贴气泡，靠近屏幕底部时上移 | onReact(emoji) |

### 25.3 Composition

组合只展示“用了哪些原子、怎么排、事件怎么上抛”，内部实现不在本章范围内。

右键菜单：图标与语气胶囊来自原子，菜单项是否可点由业务层给的 disabled 决定，菜单本身不判断权限。

```tsx
<ContextMenu
  x={point.x}
  y={point.y}
  items={[
    { label: '回复', icon: IReply, onSelect: () => onReply(message.id) },
    { label: '复制', hint: '⌘C', onSelect: () => onCopy(message.body) },
    { label: '删除', icon: ITrash, destructive: true, disabled: !canDelete, onSelect: () => onDelete(message.id) },
  ]}
  onClose={closeMenu}
/>
```

日期时间：触发器是一个 Input 外观的按钮，弹层内部是月历网格与时间列，选择结果统一以字符串上抛。

```tsx
<DateTimePicker
  value={draft.startsAt}
  mode="datetime"
  allowClear
  onChange={(next) => setDraft({ ...draft, startsAt: next })}
  onClose={closePicker}
/>
```

投票弹层：内部由选项输入行、添加按钮与多选开关组成，提交按钮在提交中保持宽度并挡二次点击。

```tsx
<PollComposer
  conversationId={conversation.id}
  onCancel={closePoll}
  onSubmitted={(poll) => { closePoll(); onPollCreated(poll) }}
/>
```

智能体编辑：表单分组由 SettingRow 排列，头像选择复用 Avatar 与 Pressable，保存结果整体上抛。

```tsx
<AgentEditor
  agent={editing}
  onClose={closeEditor}
  onSaved={(agent) => { upsertAgent(agent); closeEditor() }}
/>
```

移动列表：下拉刷新包住滑动行，行内是可点击的会话摘要；滑动操作先复位再上抛，避免行停在半开状态。

```tsx
<PullToRefresh onRefresh={() => refreshList()} onScrollerReady={bindScroller}>
  <SwipeableRow actions={[{ label: '静音', tone: 'neutral', onAction: () => mute(id) }, { label: '退出', tone: 'bad', onAction: () => leave(id) }]}>
    <Pressable haptic="light" onClick={() => openChat(id)}>
      <PreviewText body={row.preview} />
    </Pressable>
  </SwipeableRow>
</PullToRefresh>
```

### 25.4 Rhythm

同一区域同时触发的过渡必须共用一套时长与曲线，否则会出现“菜单已经开了、遮罩还在淡入”的错位。

| 场景 | 进场 | 出场 | 焦点行为 |
| --- | --- | --- | --- |
| 右键菜单与长按菜单 | fast，enter，4px 位移 | instant，淡出 | 打开记住触发元素，关闭归还 |
| 选择弹层与日期弹层 | base，enter，4px 上移 | fast，leave | 打开聚焦首项，关闭归还触发器 |
| 右侧抽屉 | slow，enter | base，leave | 打开聚焦抽屉标题，关闭归还按钮 |
| 全屏弹层 | base，enter，轻微缩放 | fast，leave | 焦点移入首字段，关闭归还 |
| 提醒卡片 | base，enter，上移 | fast，leave | 不抢焦点，只做状态播报 |

现实约束：当前没有共享的 Modal 原语。遮罩、Escape、外部点击、背景滚动锁在六个弹层里各写一遍，只有邮件抽屉与工作区设置声明了模态语义，也只有少数入口做焦点归还。本章给出的替代约束是：遮罩一律取同一令牌，进出场一律取 base 与 fast，抽屉取 slow，曲线只用 enter 与 leave，不新增第三套节奏；焦点归还由新写的弹层自行补齐，视为硬性要求。是否抽取统一的弹层壳，与 [界面规范](../ui/) 已记录的焦点陷阱缺口同批解决，记为待确认项。

### 25.5 Acceptance

| 编号 | 操作 | 可观察结果 |
| --- | --- | --- |
| CP-01 | 在 360px 与 768px 两档宽度打开五个表单弹层 | 无横向滚动，主操作始终可见并可点击，遮罩覆盖完整 |
| CP-02 | 只用键盘打开、操作并关闭菜单、弹层与抽屉 | 焦点进入层内、Tab 不逃逸到背景、Esc 关闭后焦点回到触发元素 |
| CP-03 | 连续打开提醒、菜单与弹层 | 层级正确，后开的在上；关闭一个不影响另一个的存在与焦点 |
| CP-04 | 观察同一屏内遮罩、面板与内容的进出场 | 三者共用同一时长与曲线，无错帧、无二次位移 |
