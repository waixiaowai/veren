---
title: 日程（Schedule）
description: "保存共享时间：个人与智能体任务两类事件、最小重复规则、槽位唯一的派发与两种通道的提醒。"
sidebar:
  order: 10
  label: 10 日程
draft: false
lastUpdated: 2026-11-04
---

## 10. Schedule

日程是外围工作面：它不制造产品差异，只把"什么时候该发生什么"变成可查、可派发、可提醒的行。它的价值全在边界条件上——月末怎么钳、错过多久还补、同一时刻会不会派发两次。因此本章把重复规则与派发收敛写得比字段清单更细，密度低于核心域但不留空白。

### 10.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 事件本体：标题、描述、起止、全天标记、私密标记与归属 | 目标会话的创建与成员判定（`Conversation`） |
| 个人事件与智能体任务两类事件的语义区分 | 智能体被唤醒后是否回应（`Coordination`、`Turn`） |
| 重复规则的最小集与槽位推导 | 邮件投递、退信与重试（`Email`） |
| 到点派发、补发窗口与一次性事件的收尾 | 站内提醒的实时投递（`Realtime`） |
| 提醒的通道选择、收件人解析与槽位唯一 | 用户时区换算与本地化展示（前端，当前未实现） |
| 创建请求标识的幂等与状态机（活跃、暂停、完成、取消） | 卡片截止日与看板排序（`Board`） |

### 10.2 Capabilities

事件分两类：`personal`（人的日程，只用于展示与提醒）与 `agent_task`（到点向智能体派发一次任务）。两类共享同一套重复规则与提醒字段，区别只在派发时是否真的产出消息。

关键业务规则：

- **重复规则刻意最小**：只有 `daily`、`weekly`、`monthly`、`yearly` 四种频率，加间隔、星期集合、`until`、`count`；没有排除日期、没有"第几个星期几"、没有月末特殊规则。表达不了的日程请建多条事件，而不是靠规则硬凑。
- **每个 occurrence 从种子按序号计算，绝不从上一次结果步进**。这是被真实事故逼出来的规则：月加法溢出（1 月 31 日加一个月得到 3 月 3 日）一旦回灌到下一次计算，整条序列会永久漂移。正确做法是先取目标月 1 日再钳到月末：1 月 31 日 → 2 月 28 日 → 3 月 31 日；年度同理，2 月 29 日先钳成 2 月 28 日，下个闰年回到 2 月 29 日。
- **周规则以"活跃周"分组**。种子所在的那一周只提供不早于种子星期几的日子（周三开始的每周事件不会回填到周一），星期集合排序去重。
- **派发按槽位唯一收敛**。扫描每分钟一次、进程启动后先跑一次，没有开关也没有单飞保护；槽位是"这次 occurrence 的计划时刻"，`(事件, 槽位)` 唯一，抢不到就说明别的副本或上一轮 tick 已经派发过，本次记 `duplicate` 并安静收手。槽位唯一是这套系统里唯一的去重手段，不依赖进程内状态。
- **补发窗口一小时**。错过一小时内的事件照常补发；超过窗口的一次性事件直接置 `done`（不派发、不补消息），循环事件快进到窗口内最近的槽位，并把水位推到当前时刻——宁可不补，也不要在恢复瞬间把一周的积压一次性倒进会话。
- **派发不自动建会话**。目标优先用事件上绑定的会话（且负责人仍是成员），否则找创建者与负责人之间的两人私聊；两者都没有就记 `skipped`，不新建会话，避免给陌生人开一个空房间。
- **提醒要求两个字段同时存在**：提前分钟数与通道。槽位是 occurrence 的开始时刻（不是提醒触发时刻），先抢槽位再发送；收件人始终含创建者，人类负责人也加入，智能体只走派发、不发提醒。
- **全部按 UTC 计算**。没有事件时区字段，也没有按用户时区换算，`allDay` 只是一个布尔标记；提醒邮件正文显式标注 UTC。
- **不生成日历邀请文件**。提醒邮件只有纯文本与内联 HTML，没有 `VEVENT`、没有 `.ics` 附件。这是一个**未实现**项：外部日历客户端收不到可导入的邀请，只能靠人读邮件。
- **私密事件只对创建者与负责人可见**。读写都按这条规则过滤；租户级广播仍然会发出变更通知，但拿到标识后再读会被拒，因此那一行不会进入普通成员的本地视图。

### 10.3 Contracts

```ts
type EventKind = 'personal' | 'agent_task'
type EventStatus = 'active' | 'paused' | 'done' | 'cancelled'
type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
type ReminderChannel = 'toast' | 'email' | 'both'
type DispatchStatus = 'dispatched' | 'skipped' | 'failed' | 'duplicate'

interface RecurrenceRule {
  freq: RecurrenceFreq
  interval: number            // 正整数
  byweekday?: number[]        // 0 = 周日，仅 weekly 生效
  until?: string              // ISO 时刻，含边界
  count?: number              // 含种子那一次
}

interface CalendarEvent {
  id: string
  companyId: string
  createdBy: string
  kind: EventKind
  title: string
  description: string
  assigneeId: string | null
  targetConversationId: string | null
  agentPrompt: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  recurrence: RecurrenceRule | null
  status: EventStatus
  lastFiredAt: string | null
  reminderMinutesBefore: number | null
  reminderChannel: ReminderChannel | null
  isPrivate: boolean
}

interface DispatchOutcome { slotMs: number; status: DispatchStatus; messageId: string | null; error: string | null }
interface ReminderOutcome { slotMs: number; status: 'sent' | 'failed'; recipients: string[] }

abstract class ScheduleService {
  abstract nextOccurrence(event: CalendarEvent, afterMs: number): number | null      // 返回槽位毫秒
  abstract dispatchDue(event: CalendarEvent, nowMs: number): Promise<DispatchOutcome>
  abstract sendReminder(event: CalendarEvent, occurrenceMs: number): Promise<ReminderOutcome>
}
```

错误约定：`interval` 非正、`byweekday` 越界、`until` 早于 `startAt`、`count` 非正返回 `400`；事件不属于当前租户或读私密事件的人既非创建者也非负责人返回 `404`；已取消事件被提交修改返回 `409 EVENT_CANCELLED`；创建请求标识相同而内容不同返回 `409 EVENT_REQUEST_CONFLICT`。稳定码清单见 [错误码与状态模型](../errors/)。

### 10.4 Flow

```ts
async function dispatchDue(deps: ScheduleDeps, event: CalendarEvent, now: number): Promise<DispatchOutcome> {
  // 1) 从水位推算下一个槽位；规则永远从种子按序号推导，不继承上一次结果
  const after = event.lastFiredAt ? toEpoch(event.lastFiredAt) + 1 : toEpoch(event.startAt)
  const slot = deps.recurrence.nextOnOrAfter(toEpoch(event.startAt), event.recurrence, after)
  if (!slot) return await deps.events.finish(event, 'done')          // 规则走到头：无槽位即完成

  // 2) 窗口外不补：一次性事件置完成，循环事件把水位推到当前时刻
  if (now - slot > CATCHUP_MS) {
    return event.recurrence ? await deps.events.advance(event, now) : await deps.events.finish(event, 'done')
  }

  // 3) 槽位唯一：抢不到就是已经派发过，记 duplicate 并收手，绝不重复发消息
  const claim = await deps.db.claimSlot(event.id, slot)
  if (!claim) return { slotMs: slot, status: 'duplicate', messageId: null, error: null }

  if (event.kind === 'personal') return await deps.db.settle(claim, 'skipped', 'personal event')
  if (!event.assigneeId) return await deps.db.settle(claim, 'skipped', 'no assignee')

  const conversation = await deps.conversations.resolveTarget(event)  // 绑定的会话或两人私聊；不新建
  if (!conversation) return await deps.db.settle(claim, 'skipped', 'no target conversation')

  try {
    // 4) 系统消息与会话序号在同一事务内；投递失败不改变"已派发"这个结论
    const message = await deps.conversations.postSystem(conversation, renderDispatchBody(event, slot))
    await deps.db.settle(claim, 'dispatched', message.id, slot)       // 同时推进 lastFiredAt = slot
    await deps.realtime.enqueue('event.dispatched', { eventId: event.id, slot })
    return { slotMs: slot, status: 'dispatched', messageId: message.id, error: null }
  } catch (error) {
    await deps.db.settle(claim, 'failed', errorText(error), slot)     // 水位仍推进，避免同槽位反复重试
    return { slotMs: slot, status: 'failed', messageId: null, error: errorText(error) }
  }
}
```

分支说明：`nextOnOrAfter` 在 `after` 上含等号、`until` 含边界、`count` 含种子，并带 5000 次迭代上限防止规则失控空转；`claimSlot` 靠唯一约束收敛，冲突即 `duplicate`，这是跨副本唯一可信的去重；`resolveTarget` 找不到会话就跳过，绝不隐式建房间；`settle` 无论成功、跳过还是失败都推进水位，因此一轮 tick 与下一轮重叠也不会重复派发；`personal` 事件进入扫描但永远不会派发消息。

### 10.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 慢 tick 与下一轮重叠 | 没有 in-flight guard，靠槽位唯一收敛 | 后一轮抢不到槽位记 `duplicate`，会话里只出现一条派发消息 |
| 抢占槽位后进程崩溃 | 槽位已消费，消息未写入 | 本次派发计为未发生，不重放（**待确认**：是否改为 `pending → dispatched` 两阶段） |
| 提醒重复发送 | `(事件, occurrence 开始时刻)` 唯一 | 抢不到即不发；结果回写 `sent`/`failed`，失败不自动重发 |
| 时间跳变与积压 | 水位单调、补发窗口一小时 | 跳变后旧槽位丢弃；积压只补窗口内最近一个，不倒灌 |
| 事件暂停后恢复 | 扫描只看 `active` | 从 `lastFiredAt` 续算，不补暂停期间的 occurrence |
| 私密事件泄漏 | 读写按创建者与负责人过滤 | 广播只带标识，越权读取返回 `404`，客户端不落库 |

### 10.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| SC-01 | 事件起于 1 月 31 日、按月重复 | 连续查看三次 occurrence | 计划时刻分别为 1 月 31 日、2 月 28 日、3 月 31 日，序列不漂移 |
| SC-02 | 同一事件同一槽位已派发过 | 再跑一轮 tick | 记 `duplicate`，目标会话没有第二条派发消息，水位不倒退 |
| SC-03 | 事件被标记为私密，调用者既非创建者也非负责人 | 读取该事件 | 返回 `404`，响应中不含标题与描述，无法区分"不存在"与"无权" |
| SC-04 | 一次性事件已过期两小时且未派发 | 启动调度 | 事件置 `done`，不产生派发消息，不需要人工清理 |
| SC-05 | 智能体任务事件没有可用目标会话 | 到点派发 | 记 `skipped`（原因 `no target conversation`），工作区没有新建会话 |
| SC-06 | 事件设了提前 10 分钟提醒、通道为邮件 | 到点触发提醒 | 只发一封提醒邮件，正文标注 UTC，附件为空；重复 tick 不重复发 |
