---
title: 业务组件
description: "第 26 章业务组件：数据绑定块的接口映射、六种状态、竞态处理与提交反馈。"
sidebar:
  order: 26
  label: 26 业务组件
draft: false
lastUpdated: 2026-11-04
---

## 26. Business Components

业务组件是唯一知道“这是谁的数据、他能不能改”的一层。它从 [第 25 章](./composite/) 取布局，从 [第 24 章](./basic/) 取控件，自己负责三件事：把接口结果映射成界面事实、把加载与失败讲清楚、把用户动作收敛成一次不重复的提交。会话与消息的字段语义以 [会话模块](../modules/conversation/) 为准，接口编号以第 18 章统一编目；本章用方法与路径引用，避免两处编号漂移。

### 26.1 Layer Rules

| 允许 | 禁止 |
| --- | --- |
| 调用接口、订阅推送、把响应映射为视图模型 | 在组件里拼接 URL、处理令牌或重试整个连接 |
| 持有页面内的请求状态，如加载、失败、提交中 | 把服务端事实复制成第二份可写副本 |
| 做乐观更新并接受服务端结果推翻 | 失败后假装成功，或用本地数据补写服务端 |
| 按权限决定禁用、隐藏与说明文案 | 用空白页面代替无权限，或用统一文案掩盖原因 |

接口引用表按组件组列出读写路径与关键字段。路径为语义化写法，实际前缀与鉴权方式见第 18 章。

| 组件组 | 读取 | 写入 | 关键字段映射 |
| --- | --- | --- | --- |
| 会话列表 | GET /api/conversations | — | title，kind，unreadCount，lastSequence，updatedAt |
| 消息流 | GET /api/conversations/:id/messages?sinceSequence= | — | sequence，body，authorId，kind，attachments，poll |
| 发送与回复 | — | POST /api/conversations/:id/messages | clientId 幂等键，quotedMessageId，返回 message.sequence |
| 已读与输入中 | — | POST /api/conversations/:id/read，POST /api/typing | lastReadSequence，conversationId，done |
| 反应与投票 | 随消息返回 | POST /api/messages/:id/reactions，POST /api/polls/:id/votes | count，mine，users，optionIds |
| 看板 | GET /api/boards，GET /api/boards/:id | PATCH /api/boards/:id/cards/:cardId | columnId，position，version，assigneeId |
| 日程 | GET /api/calendar/events?from=&to= | POST 与 PATCH /api/calendar/events/:id | startsAt，endsAt，recurrence，reminders |
| 文档 | GET /api/documents，WS doc.subscribe | WS doc.update，POST /api/documents | documentId，snapshotVersion，update 二进制 |
| 智能体 | GET /api/agents | POST /api/agents，PATCH /api/agents/:id | name，persona，model，engine，computerId |
| 成员与邀请 | GET /api/companies/:id/members | POST /api/invites，POST /api/invites/:token/accept | role，email，expiresAt |
| 偏好 | GET /api/me/preferences | PUT /api/me/preferences | 键值对，写入即乐观生效 |
| 交付 | GET /api/shipping/features | POST /api/shipping/features，状态转移端点 | status，invariants，verifications，release |
| 观测 | GET /api/devtools/capabilities，GET /api/observability/runs | — | canEnable，runId，cost，toolCalls |
| 旁听 | GET /api/peek/agent-chats | — | pairId，transcript，participants |
| 设备与推送 | GET /api/computers | POST /api/computers/pair，POST /api/push/register | code，platform，tokenSuffix |
| 邮件 | GET /api/email/threads | POST /api/email/messages | threadId，subject，body，attachments |
| 后台 | GET /api/admin/users?q=&tier=&page= | POST /api/admin/users/:id/suspend | tier，status，total，page |

字段只做单向映射：服务端字段直接作为渲染输入，组件不另外派生一份可写副本。需要展示派生值时用纯函数计算，需要修改时回到接口，改完再用响应覆盖。这条规则让“界面不发明状态”在组件层可检查：任何能写回服务端的状态，都必须能在接口表里找到对应的写入口。

状态呈现统一按下面这张表，组件只允许在这里取词，不另造近义词。空态与失败态的区别不在措辞，而在是否保留上下文：筛选无结果必须保留关键词与筛选条，失败必须保留可重试的参数。

| 状态 | 触发 | 界面表现 | 允许动作 |
| --- | --- | --- | --- |
| 加载 | 首次取数或切换实体 | 骨架保持目标尺寸，标题位不塌陷 | 取消、返回 |
| 空，尚无数据 | 请求成功且集合为空 | 说明用途并给创建入口 | 创建、邀请 |
| 空，筛选无结果 | 请求成功但当前筛选为空 | 说明是筛选造成，给清除筛选 | 清除筛选、改关键词 |
| 失败 | 请求失败或超时 | 说明发生了什么，保留筛选条件 | 重试、返回 |
| 无权限 | 403 或能力开关未开 | 说明原因与申请入口，不留白 | 申请、切换账号 |
| 提交中 | 已发出写请求 | 按钮保持宽度并挡二次触发，行内显示进度 | 等待、取消可回滚的动作 |
| 提交失败 | 写请求失败 | 保留输入，标出失败项与重试入口 | 重试、复制内容 |
| 冲突或过期 | 409 或版本落后 | 展示新事实并请用户确认重做 | 刷新、覆盖前确认 |

竞态与重复提交按以下规则处理，所有业务组件共用。

- 每次筛选或切换实体都递增请求序号，响应回来先比对序号，旧响应直接丢弃，不写入状态。
- 同一资源的并发请求以最后发出的为准；先发的慢响应不得覆盖后发的快结果。
- 发送类请求带客户端标识；重试复用同一标识，服务端回放不产生第二条。
- 乐观更新必须记下推翻前的快照；失败整体回滚，不做半恢复。
- 筛选变化重置分页游标并丢弃旧页结果；已选中的实体若不在新结果内，退回未选中态而不是保留幽灵详情。
- 403 归为无权限，404 归为不存在，两者不合并成空白；401 交给登录门处理。
- 成功后才清草稿；失败保留草稿与附件，重试不重新上传已成功的对象。

权限态分布在三个门上，口径必须一致：旁听只对所有者开放，观测受服务端能力开关控制，后台按管理员身份判定。三者的共同要求是“先解释再引导”，即先说明为什么看不到，再给申请或切换的入口；不允许把被拒绝渲染成加载失败，也不允许用空列表表示无权。

请求生命周期在组件内部收口：挂载或参数变化时发第一个请求，卸载或参数再变时作废上一个请求，提交类请求单独持有进行中标记。刷新页面后组件重建，只依据当前路由参数与本地草稿恢复，不从上一份内存状态续命；这一条与 [第 27 章](./pages/) 的状态恢复规则配套。

### 26.2 Inventory

清单按消息面、工作台面、身份与接入面、移动端四段依次排列。数据来源写 store 或接口，状态写该组件必须自行呈现的态，关键交互只写用户可感知的动作。

| 组件 | 用途 | 数据来源 | 状态 | 关键交互 |
| --- | --- | --- | --- | --- |
| MessageRow | 完整消息气泡，含作者、反应、引用、附件与重试 | 消息 store 与会话成员 | 正常，流式中，未确认，失败 | 悬停操作，重试，引用，反应 |
| RichBody | 正文渲染与行内实体解析 | 消息 body 与会话 id | 渲染成功，降级纯文本 | 点提及、文档链接、消息引用 |
| CodeBlock | 代码高亮与复制 | 消息或文档片段 | 复制成功提示 | 复制，横向滚动 |
| SystemRow | 居中系统行，如加入、离开、日程触发 | 系统消息 | 静态 | 无 |
| TypingRow | 正在输入指示 | 输入中映射，45 秒过期 | 有人输入，超时消失 | 无 |
| MentionChip | 提及胶囊与成员悬浮卡 | 提及 id 与成员缓存 | 已解析，未解析 | 悬停查看成员 |
| Composer | 富文本输入、提及、斜杠命令、上传、回复 | 草稿 store 与附件策略 | 空，有草稿，上传中，发送中，失败 | 回车发送，@ 提及，斜杠命令，粘贴上传 |
| ChatHeader | 标题与主题内联编辑、成员栈、搜索 | 会话详情与成员 | 编辑中，保存中，保存失败 | 改名，切主题，开会话信息 |
| ChatPane | 消息列表，跳转与搜索，空态 | 消息 store 与通道 | 加载，空，加载更早，错误 | 滚动，跳转定位，搜索，重试 |
| ConversationsPane | 侧栏搜索、七类筛选与项目筛选、行 | 会话列表，未读，偏好 | 加载，空，筛选无结果，错误 | ⌘K，切筛选，拖拽宽度，右键菜单 |
| InfoPane | 智能体信息面板，工具与邮箱 | 成员与工具清单 | 加载，离线 | 私聊，旁听，查看工具 |
| ThreadDrawer | 线程回复与回复编辑器 | 线程消息 | 空，加载，发送中 | 回复，关闭，跳到主楼 |
| DocumentPeekPane | 右侧文档速览与协同编辑 | 文档 store 与文档通道 | 加载，不可用，编辑中 | 打开完整文档，编辑，提及 |
| BoardPeekPane | 右侧看板速览 | 看板 store | 加载，空，只读 | 打开完整看板，移动卡片 |
| CalendarPeekPane | 右侧日程速览 | 日历 store | 加载，空 | 打开事件，编辑 |
| AgentsView | 智能体名册，宿主与引擎徽标 | GET /api/agents 与设备 | 加载，空，离线，已离队 | 新建，编辑，离队，开会话 |
| BoardsView | 看板列表与画布，卡片弹窗与评论 | 看板 store | 加载，空，保存中，失败 | 拖拽移动，建卡，评论，改列 |
| CalendarView | 月视图与即将到来 | 日历 store | 加载，空，失败 | 新建，编辑，切月 |
| DocumentsView | 文档列表与协同编辑器 | 文档 store | 加载，空，未选中 | 新建，重命名，删除 |
| MeView | 个人中心六标签 | 账号，用量，设备，项目，信任，偏好 | 各标签独立加载 | 改偏好，配对设备，退出 |
| ObservabilityView | 运行轨迹与成本经济学 | 能力接口与运行列表 | 无权限，加载，空 | 钻取，筛选，看工具载荷 |
| ShippingWorkspace | 功能到发布的证据闭环 | 交付 store | 加载，空，保存中，错误 | 建功能，推进状态，回读 |
| WhispersView 组 | 智能体私聊旁听，含转录与检查器 | GET /api/peek/agent-chats | 无权限，加载，空 | 选会话，读转录，看检查器 |
| ConveneView | 站立会实时宫格与转录 | 站立会通道帧 | 无进行中，进行中，已结束 | 开始，结束，读转录 |
| Onboarding | 配对计算机引导 | 配对码与设备 | 生成中，等待中，已连接 | 复制，轮换，预览 |
| AuthGate 组 | 令牌门与登录页 | 本机令牌与登录回跳 | 未登录，登录中，错误 | 登录，切换服务端 |
| InviteAcceptScreen | 邀请预览与接受 | 邀请令牌 | 无效，过期，已是成员，需先登录 | 接受，注册 |
| NoWorkspaceScreen 组 | 首工作区创建与租户切换 | 工作区列表 | 空，创建中，切换中 | 创建，切换，退出 |
| 移动端组 | 十屏：列表，聊天，信息，旁听，站立会，资料库，交付，名册，我，参与者 | 复用桌面 store 与推送 | 骨架，空，失败，离线 | 滑动返回，长按菜单，下拉刷新，点按回应 |

移动端组不是一个组件，而是十条共享同一批 store 的屏。它们必须与桌面共用字段映射与状态词，只允许在密度、手势与导航层级上不同；同一条消息在两端显示不同的已读或失败状态，视为缺陷。桌面已有的业务组件若被移动端复用，复用方式是传不同的密度与插槽，不是复制一份实现。

### 26.3 Data Binding

四个关键组件给出最简伪代码：调用哪个接口、怎么处理加载失败与空态、怎么避免竞态。其余组件按同一形状推导。

发送：临时气泡先入列，成功才清草稿，重试复用同一客户端标识。

```tsx
interface ComposerProps { conversationId: string; replyToId: string | null }
export function Composer({ conversationId, replyToId }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const clientId = useRef(newClientId())          // 幂等键：本次输入期间不变
  const send = async () => {
    if (!draft.trim() || sending) return          // 重复提交在此挡住
    setSending(true)
    try {
      // POST /api/conversations/:id/messages，字段 body、quotedMessageId、clientId
      const { message } = await api.postMessage({ conversationId, body: draft, quotedMessageId: replyToId, clientId: clientId.current })
      replaceOptimistic(clientId.current, message) // 服务端事实覆盖临时气泡
      setDraft('')                                // 只有成功才清草稿
      clientId.current = newClientId()
    } catch (error) {
      markUnconfirmed(clientId.current)            // 保留草稿与气泡，重试沿用同一 clientId
    } finally {
      setSending(false)
    }
  }
  return <RichInput value={draft} onChange={setDraft} onSubmit={send} disabled={sending} />
}
```

看板移动：先动界面并记账，失败整体回滚；连续拖动以最后一次与服务端版本为准。

```tsx
const moveCard = async (cardId: string, toColumnId: string) => {
  const before = snapshotOf(cardId)              // 记下移动前列与顺序
  applyLocalMove(cardId, toColumnId)             // 乐观更新；目标列为空时同时插入空列提示
  try {
    // PATCH /api/boards/:id/cards/:cardId，字段 columnId、position
    const saved = await api.moveCard({ boardId, cardId, columnId: toColumnId })
    mergeIfNewer(saved)                          // 版本较旧则丢弃，避免旧响应覆盖新拖动
  } catch (error) {
    restore(before)                              // 不做半恢复；源列若空了则补回原顺序
    setBanner('这次移动没有保存，已回到原位')
  }
}
```

消息增量与跳转：拉取用游标，跳转只改可见位置，不改数据。

```tsx
const loadOlder = async (conversationId: string) => {
  const cursor = oldestSequence(conversationId)
  // GET /api/conversations/:id/messages?sinceSequence=<cursor>&limit=80
  const page = await api.listMessages({ conversationId, sinceSequence: cursor, limit: 80 })
  if (page.length === 0) markNoMoreOlder(conversationId)  // 空页：显示“没有更早的消息”，不再重试
  prependMessages(conversationId, page)          // 头部插入并保持可视锚点
}
const jumpToMessage = (messageId: string) => {
  if (hasLocal(messageId)) scrollToAndFlash(messageId)  // 已加载：只滚动
  else openAround(messageId)                            // 未加载：取定位窗口再滚动
}
```

文档订阅：打开即订阅，关闭即退订；断线重连后重取快照，不让旧增量盖住新版本。

```tsx
useEffect(() => {
  if (!documentId) return
  const subscription = api.subscribeDocument(documentId)  // WS doc.subscribe
  subscription.on('doc.sync', applySnapshot)              // 快照带版本，旧版本丢弃
  subscription.on('doc.update', applyRemoteUpdate)
  subscription.on('doc.error', () => setPaneState('unavailable'))  // 不存在或无权：显示不可用，不空白
  return () => subscription.close()                        // 卸载必须退订
}, [documentId])
```

四个例子共用同一条顺序：先定请求参数并记住它，再发请求，再按序号或版本决定是否写入状态，最后把结果讲成人能读的一句话。订阅类还要多一步退订与重连后的重放。任何一步缺失，都会在切换实体或断线重连时表现为“界面显示了别人的数据”，这是本章最需要防的缺陷。

### 26.4 Acceptance

| 编号 | 操作 | 可观察结果 |
| --- | --- | --- |
| BZ-01 | 在某筛选下让请求失败，再点重试 | 重试沿用原筛选与分页，不清空已加载内容，成功后列表与筛选一致 |
| BZ-02 | 分别构造空集合与筛选无结果的场景 | 两者文案与动作不同：前者给创建入口，后者给清除筛选 |
| BZ-03 | 以无权限账号打开旁听、观测与后台 | 显示原因与申请入口，不出现空白页；误入 404 显示不存在 |
| BZ-04 | 快速切换两次筛选并让先发的响应后到 | 界面只呈现最后一次筛选的结果，旧响应被丢弃，无闪烁回退 |
