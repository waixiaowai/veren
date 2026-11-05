---
title: 看板（Board）
description: "把工作变成可认领的卡片：四层结构、列语义、浮点位置、严格日历日截止与只前进不倒退的认领。"
sidebar:
  order: 9
  label: 9 看板
draft: false
lastUpdated: 2026-11-04
---

## 9. Board

看板是外围工作面：它不承担本产品的核心差异化（"智能体能不能当同事"由会话、回合、协调与宿主决定），但它把"谁接了哪件事"写成可判定的行，因此契约与失败语义不可省。下面按"四层结构 → 列语义 → 认领推进 → 提及与唤醒 → 幂等与恢复"展开，密度低于核心域，但凡涉及写入的地方仍给出拒绝码与收敛方式。

### 9.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 看板、列、卡片、评论四层的创建、改名与删除 | 谁该被唤醒、这次唤醒值不值（`Coordination`） |
| 列语义 `todo`、`doing`、`done`、未标注，以及建板时的三列播种 | 成员身份、角色与租户边界（`Workspace`） |
| 卡片位置写入、列内排序与字段长度上限 | 截止日的提醒编排与重复规则（`Schedule`） |
| 截止日作为严格日历日的解析与拒绝 | 私聊通道与消息投递（`Conversation`、`Realtime`） |
| 提及在写入时解析为参与者标识，以及每人的提及已读游标 | 卡片到发布证据的追溯（`Shipping`） |
| 认领推进与指派变更唤醒的唯一收口 | 智能体接手后的实际执行（`Turn`） |
| 创建请求标识的幂等收敛 | 全库保留与清理（`Admin`） |

### 9.2 Capabilities

看板是四层容器：**看板 → 列 → 卡片 → 评论**。列带语义 `kind ∈ {'todo','doing','done',null}`；建板时自动种入 Todo、Doing、Done 三列（位置 1000、2000、3000，语义同时写入），此后可改语义。卡片有标题、描述、负责人、截止日与提及；评论只允许作者本人删除。

关键业务规则：

- **位置是浮点数，服务端不做顺序裁判**。位置用于"插进两张卡之间而不重排全部兄弟节点"，由客户端给出、服务端原样写入；服务端**没有 WIP 上限、没有顺序校验**，同位置并列时读取按 `(position, id)` 稳定排序兜底。这是一个**待确认**的设计缺口：多端并发拖动可能出现"看到的顺序与写下的顺序不同"。
- **截止日是日历日，不是时间点**。`dueOn` 只接受严格的 `YYYY-MM-DD`，非法日期不滚动、不纠正，`null` 表示无截止；它不带时间、不带时区，也不产生任何提醒。
- **认领只前进，永不倒退**。智能体认领时，仅当卡片当前列语义为 `todo` 才前进到位置最小的 `doing` 列；当前列是未标注的自定义列或已是 `done` 时一律不动。人可以直接拖回，这是人的自由，不是智能体的。
- **指派即提及**。负责人变更后，即使正文没有提及任何人，也对新负责人生成一次唤醒；唤醒文案是"有张卡片指派给你"。
- **回传值不算变更**。客户端每次编辑都会把当前负责人原样回传，只有 `string` 与 `null` 之间的真实迁移才算指派变更，否则每次改标题都会打扰负责人一次。
- **提及在写入时定型**。写入时按参与者标识与姓名解析，结果以标识数组落库，客户端不再重解析；成员改名后旧提及仍然指向同一个人。
- **创建可由请求标识收敛**。同一请求标识与同一内容指纹重放返回既有看板，不再种一次三列；标识相同而内容不同视为冲突。
- **广播是粗粒度的**。列变更发 `card.moved`，其余发 `card.updated`，看板、列、卡、评论各有创建与删除事件；客户端可以整板重取，也可以按标识就地修补。

### 9.3 Contracts

```ts
type ColumnKind = 'todo' | 'doing' | 'done' | null

interface Board { id: string; companyId: string; title: string; description: string; createdBy: string; updatedAt: string }
interface BoardColumn { id: string; boardId: string; title: string; position: number; kind: ColumnKind }

interface BoardCard {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string
  position: number
  assigneeId: string | null
  dueOn: string | null        // 严格 YYYY-MM-DD 日历日
  mentions: string[]          // 写入时解析完成的参与者标识
  updatedAt: string
}

interface CardComment { id: string; cardId: string; authorId: string; body: string; mentions: string[]; createdAt: string }

interface CreateBoardInput { actorId: string; title: string; description?: string; requestId?: string; requestHash?: string }
interface CreateBoardResult { board: Board; columns: BoardColumn[]; replayed: boolean }

interface PatchCardInput {
  actorId: string
  cardId: string
  title?: string
  description?: string
  columnId?: string
  position?: number
  assigneeId?: string | null
  dueOn?: string | null
}

interface ClaimResult { card: BoardCard; moved: boolean; from: ColumnKind; to: ColumnKind }

abstract class BoardService {
  abstract createBoard(input: CreateBoardInput): Promise<CreateBoardResult>
  abstract patchCard(input: PatchCardInput): Promise<BoardCard>
  abstract claim(actorId: string, cardId: string): Promise<ClaimResult>
  abstract comment(actorId: string, cardId: string, body: string): Promise<CardComment>
}
```

错误约定：字段超长、`position` 非有限数、`dueOn` 不是合法日历日返回 `400`；看板或卡片不属于当前租户、或调用者不是成员返回 `404`（不区分"不存在"与"无权"）；目标列不属于该看板返回 `409 BOARD_COLUMN_MISMATCH`；请求标识相同而内容不同返回 `409 BOARD_REQUEST_CONFLICT`。稳定码清单见 [错误码与状态模型](../errors/)。

### 9.4 Flow

一次卡片修补要同时处理"列归属、截止日、提及、指派变更唤醒"四件事；下面的伪代码把唤醒登记放在事务内、投递放在提交后。

```ts
async function patchCard(deps: BoardDeps, input: PatchCardInput): Promise<BoardCard> {
  const result = await deps.db.transaction(async (tx) => {
    // 1) 鉴权与读取同一条语句：跨租户与非成员都表现为"不存在"
    const card = await tx.lockCardForWrite(input.cardId, input.actorId)
    if (!card) throw new BoardError('RESOURCE_NOT_FOUND')

    // 2) 目标列必须属于同一块看板，否则拒绝整条写入
    if (input.columnId && input.columnId !== card.columnId) {
      const column = await tx.findColumn(input.columnId, card.boardId)
      if (!column) throw new BoardError('BOARD_COLUMN_MISMATCH')
    }

    // 3) 截止日只接受日历日，非法输入不猜测、不滚动
    if (input.dueOn != null && !isCalendarDate(input.dueOn)) throw new BoardError('DUE_DATE_INVALID')

    // 4) 提及在事务内重解析；解析结果为空不影响写入，只是不唤醒
    const mentions = input.description === undefined ? card.mentions : await deps.mentions.parse(tx, card.companyId, input.description)

    // 5) 指派变更必须是真实迁移；客户端回传的同一值不算变更
    const assigneeChange = input.assigneeId !== undefined && input.assigneeId !== card.assigneeId
    const updated = await tx.patchCard(card.id, { ...input, mentions })

    const kind = input.columnId && input.columnId !== card.columnId ? 'card.moved' : 'card.updated'
    await deps.realtime.enqueue(tx, kind, toBroadcast(updated))

    const targets = unique([...(assigneeChange && updated.assigneeId ? [updated.assigneeId] : []), ...mentions])
    if (targets.length > 0) await tx.insertWakeIntents(updated, targets.filter((id) => id !== input.actorId))
    return { card: updated, targets }
  })

  // 6) 提交后才投递唤醒：卡片已经落库，唤醒失败不改变写入结果
  try {
    await deps.wake.wakeKanbanAgents({ card: result.card, targets: result.targets })
  } catch (error) {
    await deps.events.record('board.wake_failed', { cardId: result.card.id, message: errorText(error) })
  }
  return result.card
}
```

分支说明：`lockCardForWrite` 同时校验租户与成员，失败即 `RESOURCE_NOT_FOUND`；`findColumn` 失败说明有人把卡片塞向另一块看板，本次写入整体回滚、不广播；`isCalendarDate` 只做字面校验（`2026-02-30` 直接拒绝）；`claim` 是另一条独立入口，只允许 `todo → doing`，其余情况返回 `moved: false` 而不是错误；唤醒投递失败只记一条事件，因为板变更已经提交，重试唤醒可能重复打扰。

### 9.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 建板请求重试 | `(requestId, requestHash)` 唯一收敛 | 命中且内容相同返回 `replayed: true`，三列不重复播种；内容不同返回冲突 |
| 同一张卡被并发拖动 | 卡片行锁串行化写入 | 后写者基于最新位置追加，读取按 `(position, id)` 稳定排序，不出现"卡片消失" |
| 唤醒丢失 | 唤醒在提交后 fire-and-forget，无重试 | 已知缺口：负责人未被唤醒时靠看板未读与提及游标补看，不静默改派 |
| 提及被编辑冲掉 | 提及随写入重解析，不保留旧文本 | 撤销提及不会撤回已发出的唤醒；唤醒只在一批目标内按标识去重，没有跨请求的合并与重试（已知缺口） |
| 列被删除而卡片仍在 | 列删除级联卡片，或先迁移再删 | 迁移与删除在同一事务；删列前必须显式指定卡片去向 |
| 请求标识冲突 | 内容指纹不同即拒绝 | 调用方换新标识重试，服务端不覆盖既有看板 |

### 9.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| BR-01 | 用户是工作区成员 | 创建一块看板 | 返回三条列，语义分别为 `todo`、`doing`、`done`，位置递增；列表页立即可见 |
| BR-02 | 卡片在 `doing` 列 | 智能体调用认领 | 不移动、不报错，返回 `moved: false`；卡片列与位置均未改变 |
| BR-03 | 卡片属于看板 A | 把卡片移动到看板 B 的列 | 返回 `409 BOARD_COLUMN_MISMATCH`，卡片仍在原列，无广播 |
| BR-04 | 同一请求标识已创建过看板 | 用相同内容重放创建 | 返回既有看板且 `replayed: true`，不新增看板，不重复播种三列 |
| BR-05 | 卡片负责人为甲 | 只改标题并原样回传负责人甲 | 无新唤醒，负责人未收到提醒；改为乙时才产生一次唤醒 |
| BR-06 | 截止日输入为 `2026-02-30` | 提交卡片 | 返回 `400 DUE_DATE_INVALID`，卡片未写入，描述与负责人均未变化 |
