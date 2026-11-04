---
title: 实时
description: "把已提交的变化尽快送到正确的端：一次性票据握手、每帧解析收件人、事务性外发箱、背压与在线状态，并在送不到时让客户端自行对账。"
sidebar:
  order: 13
  label: 13 实时
draft: false
lastUpdated: 2026-11-04
---

## 13. Realtime

实时模块只做一件事：把已经提交的事实尽快送到正确的连接上，送不到时让客户端能自己补齐。它不做判定、不写业务表、不决定谁该被唤醒；它读 [会话](./conversation/) 的成员关系与 [工作区](./workspace/) 的边界，把帧投给当下应该收到的人。它的设计原则是"延迟可以，丢失不行；沉默可以，说谎不行"：实时性可以降级，事实不能伪造。

### 13.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 连接握手、一次性票据的消费与关闭码 | 票据的铸造与身份校验（`Identity`） |
| 外发箱的登记、认领、重试、丢弃与清理 | 业务写入与消息序号（`Conversation`） |
| 每帧的收件人解析与租户过滤 | 谁该被唤醒、谁该让位（`Coordination`） |
| 单连接缓冲、背压与断开 | 模型输出的流式生成（`Turn`） |
| 在线状态、忙碌租约与状态广播 | 宿主是否在线（`Host`） |
| 输入指示与光标类瞬态事件 | 消息已读与投递水位（`Conversation`） |
| 推送设备注册、推送投递与失效设备禁用 | 推送文案与界面文案（端） |
| 投递指标与丢弃原因记录 | 告警阈值与值班响应（`Admin`） |

### 13.2 Capabilities

- **握手只认一次性票据。** 会话令牌绝不进 URL，因为 URL 会进入访问日志、代理缓存与 Referrer；票据 60 秒有效、一次性，消费即失效，失败以 `4401` 关闭并区分缺失与无效。
- **连上即 hello。** 首帧带实例标识与时间戳，客户端把它当作重同步信号：收到 hello 就主动拉一次增量，而不是假设断线期间的推送都补到了。
- **收件人每帧解析，不用连接时的成员快照。** 缺租户标记的帧直接丢弃并记账，因为那说明投递方有缺陷；有会话标识的按当前成员关系解析，无会话标识的发该租户全部活跃人类；解析查询失败即丢帧，绝不回退到旧成员表。
- **外发箱与业务同事务。** 写入提交即已登记，投递是提交后的有界后台行为，网络失败不回滚业务；语义是至少一次，每帧带投递标识供消费端去重。
- **租约认领加双上限退避。** 批量按创建时间与标识认领，租约 15 秒；失败按指数退避，次数上限 12 与时限上限 24 小时同时生效，超限标记丢弃并计入指标。
- **单连接背压。** 缓冲超过 2MB 跳帧，超过 8MB 断开；断开由客户端重连后以 hello 触发重同步，服务端不为单个连接无界缓冲。
- **在线状态由连接计数驱动，忙碌带租约。** 0 到 1 置可用，1 到 0 置休息，多标签与多设备合并计数；忙碌是 90 秒租约、靠心跳续约，过期即视为空闲，供协调判定"是否正在回合"。
- **信号类事件失败开放。** 输入指示、光标、输入状态只影响体验，总线故障时直接丢弃并返回成功；身份与可见性判定失败则关闭。
- **推送是有损补充，且排除三类人。** 投递对象排除作者、被静音者与当前在线者；没有静默时段（未实现，待确认），服务端也没有推送去重键，视觉折叠依赖平台的线程标识（待确认）。
- **顺序按会话串行。** 同一会话的帧按路由键串行，不同会话并行；跨会话不承诺顺序。
- **房间广播与租户广播分开。** 有会话标识的帧只进该会话的订阅者，无会话标识的才进该租户全部活跃人类；成员关系变更这类必须绕过成员检查的帧按显式收件人直投，否则被移除者收不到自己的移除通知。
- **总线调用是短超时短重试。** 命令超时按秒计、重试一次即放弃、离线队列关闭；宁可快速失败把活留给外发箱，也不让一次总线抖动把请求线程挂住。
- **待投队列只在表里。** 进程内没有内存队列，未投的帧全部落在外发箱，因此重启不丢帧、也不需要预热；代价是每次投递至少一次数据库往返。

### 13.3 Contracts

```ts
type RealtimeEvent = 'message.new' | 'message.delta' | 'typing' | 'presence' | 'conversation.updated' | 'workspace.membership'
type PresenceStatus = 'avail' | 'working' | 'thinking' | 'waiting' | 'resting'

interface OutboxRecord {
  id: string                    // 同时作为投递标识，消费端据此去重
  channel: string
  payload: unknown
  attempts: number
  availableAt: string
  lockedBy: string | null
  lockedUntil: string | null
  publishedAt: string | null
  discardedAt: string | null
}

interface Frame {
  deliveryId: string
  event: RealtimeEvent
  companyId: string             // 缺失即丢弃
  conversationId?: string
  recipientUserIds?: string[]   // 仅成员关系变更这类必须绕过成员检查的帧
  payload: unknown
}

interface PresenceState { userId: string; status: PresenceStatus; statusUpdatedAt: string }
interface BusyLease { conversationId: string; participantId: string; expiresAt: string; heartbeatEverySeconds: number }
interface PushDevice { id: string; userId: string; platform: 'ios' | 'android' | 'web'; token: string; disabledAt: string | null }

abstract class RealtimeService {
  abstract attach(ticket: string): Promise<{ subscriberId: string; instanceId: string; helloAt: string }>
  abstract enqueue(tx: unknown, channel: string, frame: Omit<Frame, 'deliveryId'>): Promise<string>
  abstract drain(workerId: string): Promise<number>
  abstract resolveRecipients(frame: Frame): Promise<string[]>
  abstract markPresence(userId: string, delta: 1 | -1): Promise<PresenceState>
  abstract renewBusy(lease: BusyLease): Promise<BusyLease>
  abstract dispatchPush(messageId: string): Promise<{ sent: number; skipped: number }>
}
```

错误约定：票据缺失或无效以 `4401` 关闭；订阅内查询异常以 `1011` 关闭，让客户端重连而不是停在半死状态；对外接口不因为实时投递失败而返回错误，投递状态只体现在外发箱行与指标里。稳定码见 [错误码与状态模型](../errors/)。

### 13.4 Flow

```ts
async function drainOutbox(deps: RealtimeDeps, workerId: string): Promise<number> {
  const batch = await deps.db.claimOutbox(workerId, 32)          // 跳过已锁定行，租约 15 秒
  for (const row of batch) {
    const frame = deps.decode(row.payload)
    // 缺租户标记是投递方缺陷：丢弃并记账，绝不广而告之
    if (!frame.companyId) { await deps.db.discard(row.id, 'missing companyId'); continue }

    let recipients: string[]
    try {
      recipients = await deps.resolveRecipients(frame)            // 每帧按当前成员关系解析
    } catch {
      // 查询失败即丢帧：宁可少送一次，也不按旧成员表送到已离开的人
      await deps.db.discard(row.id, 'recipient resolution failed')
      continue
    }
    if (recipients.length === 0) { await deps.db.discard(row.id, 'no recipients'); continue }

    try {
      await deps.bus.publish(row.channel, row.payload)            // 逐条串行，保证同会话有序
      await deps.db.markPublished(row.id)
    } catch (error) {
      const attempts = row.attempts + 1
      if (attempts >= deps.limits.maxAttempts || deps.ageHours(row) >= deps.limits.maxAgeHours) {
        await deps.db.discard(row.id, deps.trim(error, 1000))     // 次数与时限双上限
      } else {
        await deps.db.reschedule(row.id, attempts, deps.backoff(attempts))
      }
    }
  }
  return batch.length
}

function sendFrame(socket: Socket, frame: Frame): 'sent' | 'skipped' | 'closed' {
  if (socket.bufferedAmount > 8 * 1024 * 1024) { socket.terminate(); return 'closed' }  // 再超限断开
  if (socket.bufferedAmount > 2 * 1024 * 1024) return 'skipped'                        // 超限跳帧
  socket.send(JSON.stringify(frame))
  return 'sent'
}
```

分支说明：缺租户标记与收件人为空都走丢弃而不是广播，因为"发给所有人"在实时链路上等价于越界；解析失败走丢弃而不是重试，因为重试时成员关系可能已经变化，一条迟到的帧比没有帧更危险；投递失败区分"还有额度"与"已超限"，超限后保留最后一次错误摘要供排查；连接层跳帧与断开是两个阈值，跳帧保住连接，断开保住进程，二者都不改变已提交的事实。

### 13.5 Recovery and Idempotency

- **总线不可用**：业务命令照常成功，外发箱按退避重试；客户端暂时只看到旧状态，刷新或重连即可补齐。
- **超限丢弃**：丢弃是终态并计入指标，不做无限重试；丢的是实时性而不是事实，重连后的 hello 会触发增量拉取。
- **重复投递**：至少一次意味着同一帧可能到达两次，界面按业务标识与序号收敛，投递标识只用于日志与去重。
- **半开连接**：心跳上一轮未回应即终止连接，避免在线状态永远停在可用，进而让推送一直跳过这个人。
- **进程重启**：连接计数是内存事实，重启后归零；遗留的可用状态统一下调为休息并登记一次通知，客户端连上后自然恢复。
- **推送失败**：设备令牌失效即禁用该行，不做重试，也不把这次失败记成已读；推送失败只影响提醒，不影响站内可见性。
- **可追溯的投递痕迹**：外发箱行保留发布时间与丢弃时间，清理只删终态的老行，因此"那条消息到底投出去没有"能被回答，而不是只能靠客户端反馈猜。

### 13.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| RT-01 | 持有有效票据 | 建立长连并由另一端发一条消息 | 首帧为 hello 且带实例标识与时间戳；随后收到 `message.new`，投递标识唯一，序号与落库一致 |
| RT-02 | 无票据或票据已被使用 | 用会话令牌直接拼 URL 连接 | 以 `4401` 关闭；不建立订阅，访问日志中不出现令牌明文，改用票据后可正常连接 |
| RT-03 | 一条缺少租户标记的帧进入外发箱 | 触发投递 | 该帧被标记丢弃并留下原因，任何连接都收不到；同时收件人解析异常时同样丢帧，不回退到旧成员表 |
| RT-04 | 同一帧被重复投递 | 客户端收到两次 | 界面只出现一条消息，外发箱中该帧只有一行已发布记录，指标中重复计数可见 |
| RT-05 | 总线中断五分钟后恢复 | 观察积压帧 | 未超限的帧按序补投；超过 24 小时或 12 次的被标记丢弃；重连客户端通过 hello 后拉取补齐全部缺口 |
| RT-06 | 单个连接读得极慢 | 持续推送 | 缓冲超过阈值后该连接开始跳帧；达到上限时连接被断开，重连后收到 hello 并完成一次重同步 |
| RT-07 | 作者在线、另一成员静音、第三人离线 | 触发一次推送 | 只有第三人收到推送；作者与静音者被排除，在线者不重复提醒；静默时段未生效属已知未实现项 |
| RT-08 | 某成员被移出工作区或会话 | 触发成员关系变更帧 | 该成员仍收到自己的移除通知（按显式收件人直投），但其后该会话的业务帧不再投给他；其他成员不受影响 |
| RT-09 | 同一会话两条消息几乎同时提交 | 观察两个在线客户端的到达顺序 | 两条都到达且序号单调递增，同一连接的到达顺序与序号一致；不同会话之间不要求顺序 |
| RT-10 | 外发箱中有一批未投递的帧 | 重启实时进程 | 未投帧仍在表中并在启动后继续投递，不因重启丢失；已发布的帧不重复投给同一连接的业务视图 |
| RT-11 | 已发生若干次跳帧与丢弃 | 查看指标 | 跳帧、丢弃、重试、断连各自有计数，丢弃带原因分类；指标不含消息正文与成员标识 |
