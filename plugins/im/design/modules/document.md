---
title: 文档（Document）
description: "人与智能体共同编辑长文本：内存协作状态、追加增量、定期快照、逐帧鉴权与六种编辑原语。"
sidebar:
  order: 11
  label: 11 文档
draft: false
lastUpdated: 2026-11-04
---

## 11. Document

文档是外围工作面：它不承担核心差异化，但它同时被人和智能体改写，因此"谁在写、写到哪、写坏了怎么办"必须有确定答案。本章的重心不在编辑器，而在三处收敛：增量如何落库、鉴权如何与投递同事务、智能体的编辑锚点失配时如何什么都不做。

### 11.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 文档行、标题、与房间的可选绑定 | 对象存储、签名与授权（`Storage`） |
| 每文档一个内存协作状态，以及订阅者集合 | 会话成员资格与租户边界（`Workspace`） |
| 追加增量、定期快照与压缩 | 消息与私聊的写入（`Conversation`） |
| 订阅与逐帧更新的鉴权、扇出范围 | 被提及的智能体是否回应（`Coordination`） |
| 提及去重与唤醒（合成私聊消息） | 提醒与日程（`Schedule`） |
| 六种智能体编辑原语与图片引用 | 全文检索与导出（本方案不含） |
| 图片签名刷新与删除后的对象回收触发 | 回收任务的执行（异步清理队列） |

### 11.2 Capabilities

人看到的和智能体看到的必须是同一份正文：编辑器绑定同一个协作片段，智能体读写也在这个片段上，不存在"第二份 body"。

关键业务规则：

- **一个文档一个内存协作状态 + 一条追加日志 + 一份定期快照**。每次本地更新追加一行增量并顺带更新文档的修改时间（仅用于列表排序，失败不影响写入）；热加载用单条语句同时读出快照与全部未合并增量，保证两者落在同一个可见性视图里。
- **每 200 条增量压缩一次**。压缩在一个事务内完成：拿咨询锁、合并增量、覆盖快照、只删除本次确实合并的那些行。锁保证多副本只有一个在压，删除范围保证不会吞掉并发新增。
- **鉴权与副作用在同一事务**。订阅时一次查询同时确认文档所属租户、调用者是未删除用户、仍是未离职的人类成员，查不到就返回"不存在"，不泄漏文档是否真实存在；每一帧更新与光标状态也都在事务内加共享锁后再落副作用。
- **撤销无法插进鉴权与投递之间**。批量扇出时一个事务锁住全部收件人并持有到提交，因此"成员被移除"与"这一帧已经发出去"不会同时成立。
- **最后一个订阅者离开后有 60 秒宽限**。刷新页面或快速重开不触发冷加载；文档被删除时立即驱逐；冷加载失败不缓存失败结果，修好底层问题后可以重建。
- **单文档同步上限 32MiB**。超过上限的订阅被拒绝并返回明确错误，而不是悄悄截断或让实例内存爆掉。
- **提及 60 秒去重**。同一文档、同一提及者、同一被提及者在一分钟内只产生一行记录与一次广播，以此抑制"连续敲字把同一人提及十遍"的噪声；被提及者是智能体时，提交后以一条合成私聊消息唤醒它，选会话的顺序是文档绑定的会话（双方仍在）→ 既有单聊 → 新建单聊，正文里带读取该文档的命令。
- **智能体有六种编辑原语**：追加、文本替换（保留标记）、段落插入（开头或结尾）、整块替换、插图（开头、结尾、替换、之后、之前）、删图（按地址、地址片段或替代文本）。
- **锚点未命中即什么都不做**。整块替换与插图都按锚点定位；锚点找不到时返回"锚点未命中"且**绝不回退成追加**——回退会把一段内容写进错误位置，比不写更糟。删图命中多个时按原语语义全部删除，返回删除的对象键交给异步回收。
- **图片地址会过期，读取时自动重签**。节点上同时存对象键与地址，订阅与读取时对即将过期的签名重签（留 300 秒余量），因此旧文档不会出现"图片全裂"。

### 11.3 Contracts

```ts
type EditReason = 'ok' | 'anchor-missed' | 'too-large' | 'not-found'

type AgentEditOp =
  | { op: 'append'; markdown: string }
  | { op: 'replace'; find: string; replaceWith: string }
  | { op: 'insertParagraph'; where: 'start' | 'end'; markdown: string }
  | { op: 'replaceBlock'; blockId: string; markdown: string }
  | { op: 'image'; storageKey: string; alt: string; where: 'start' | 'end' | 'replace' | 'after' | 'before'; anchorBlockId?: string }
  | { op: 'imageDelete'; by: 'src' | 'src-contains' | 'alt'; value: string }

interface Document { id: string; companyId: string; title: string; conversationId: string | null; createdBy: string; updatedAt: string }
interface DocumentState { documentId: string; snapshot: Uint8Array | null; updates: Uint8Array[]; bytes: number }

interface EditResult {
  applied: boolean
  reason: EditReason
  replaced: number
  blocksReplaced: number
  imagePlaced: boolean
  imagesDeleted: number
  deletedStorageKeys: string[]     // 交给异步回收，不在本事务内删除对象
}

interface MentionResult { mentioned: string[]; deduped: string[]; woke: string[] }

abstract class DocumentService {
  abstract readState(documentId: string, actorId: string): Promise<DocumentState>
  abstract appendUpdate(documentId: string, actorId: string, update: Uint8Array): Promise<void>
  abstract applyAgentEdit(documentId: string, actorId: string, edit: AgentEditOp): Promise<EditResult>
  abstract mention(documentId: string, mentionerId: string, text: string): Promise<MentionResult>
}
```

错误约定：正文超过同步上限返回 `413 PAYLOAD_TOO_LARGE`；文档不存在、跨租户、调用者已离职或非成员返回 `404 RESOURCE_NOT_FOUND`；锚点未命中**不是错误**，返回 `applied: false` 与 `reason: 'anchor-missed'`；鉴权并发超过信号量返回 `429 DOCUMENT_BUSY` 并可重试。稳定码清单见 [错误码与状态模型](../errors/)。

### 11.4 Flow

```ts
async function applyAgentEdit(deps: DocumentDeps, input: AgentEditInput): Promise<EditResult> {
  const result = await deps.db.transaction(async (tx) => {
    // 1) 文档归属、成员资格与未离职在同一条语句内确认，失败即"不存在"
    const doc = await tx.lockDocumentForWrite(input.documentId, input.actorId)
    if (!doc) throw new DocumentError('RESOURCE_NOT_FOUND')

    // 2) 热加载：快照 + 全部未合并增量，一次读出，超限直接拒绝
    const state = await deps.rooms.ensureLoaded(tx, doc)
    if (state.bytes > MAX_SYNC_BYTES) throw new DocumentError('PAYLOAD_TOO_LARGE')

    // 3) 先规划再落笔：锚点找不到就返回未命中，绝不回退成追加
    const plan = deps.edits.plan(state.doc, input.edit)
    if (!plan.matched) return emptyEditResult('anchor-missed')

    const update = deps.edits.apply(state.doc, plan)
    await tx.appendUpdate(doc.id, input.actorId, update)          // 增量与业务同事务，失败即整体回滚
    await deps.realtime.enqueue(tx, 'doc.updated', { documentId: doc.id, actorId: input.actorId })

    // 4) 计数由原语规划给出，调用方不猜"这次改了什么"
    return { ...plan.result, applied: true, reason: 'ok', deletedStorageKeys: plan.deletedKeys }
  })

  // 5) 对象回收在提交后触发：删除失败最多留下孤儿对象，不会让编辑失败
  if (result.deletedStorageKeys.length > 0) await deps.cleanup.enqueue(input.documentId, result.deletedStorageKeys)
  return result
}
```

分支说明：`lockDocumentForWrite` 同时校验租户与成员关系，跨租户与非成员都表现为 `RESOURCE_NOT_FOUND`；`ensureLoaded` 命中 32MiB 上限时抛 `PAYLOAD_TOO_LARGE`，此时房间不被缓存、下一次订阅会重试；`plan` 对锚点做纯内存匹配，未命中时提前返回且不写增量、不广播；`appendUpdate` 失败导致整条事务回滚，协作状态随之回退，不会出现"内存里有、库里没有"；回收入队失败只记事件，因为对象已不再被文档引用，孤儿由清理任务兜底。

### 11.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 实例崩溃 | 增量先落库，快照是派生物 | 重连后从快照与未合并增量重建，内容不丢；内存态永不被当作真相 |
| 压缩中途中断 | 咨询锁 + 只删本次合并的行 | 下一轮重新合并剩余增量；已合并的行不会重复合并 |
| 重复帧与回声 | 订阅者来源标识抑制自回收，远端帧打标记跳过重复持久化 | 同一更新不写第二行，客户端收到的是幂等结果 |
| 成员撤销与扇出竞态 | 批量鉴权锁持有到提交 | 撤销要么挡住这一帧，要么发生在投递之后，不会出现"已撤销仍送达" |
| 提及刷屏 | 文档、提及者、被提及者三元组 60 秒去重 | 一次记录、一次广播、一次唤醒；超窗后重新计 |
| 冷加载失败 | 失败结果不缓存 | 修好底层后可直接重建房间，不需要重启实例 |
| 图片链接过期 | 订阅与读取时对将过期签名重签 | 旧文档重新打开即恢复可读，无需重写正文 |

### 11.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| DC-01 | 调用者不是文档所在工作区成员 | 订阅该文档 | 返回 `404 RESOURCE_NOT_FOUND`，响应不含标题，无法区分"不存在"与"无权" |
| DC-02 | 同一人一分钟内连续提及同一智能体三次 | 逐次提交 | 只产生一行提及记录与一次广播，智能体只被唤醒一次；一分钟后再提及才重新唤醒 |
| DC-03 | 智能体请求整块替换一个不存在的锚点 | 提交编辑 | 返回 `applied: false` 与 `anchor-missed`，正文与增量表均无变化，内容没有被追加到末尾 |
| DC-04 | 文档刚完成一次编辑，其增量尚未压缩 | 杀掉实例后重启并重开文档 | 快照加剩余增量重建出的正文与编辑后一致，无丢失、无重复段落 |
| DC-05 | 成员正在编辑，同时被移出工作区 | 继续提交一帧更新 | 该帧被拒（`404`），且不会在撤销之后被扇出给其他订阅者 |
| DC-06 | 文档累计超过 32MiB | 订阅并尝试写入 | 返回 `413 PAYLOAD_TOO_LARGE`，实例内存不增长，已有订阅者不受影响 |
| DC-07 | 文档内图片的签名已临近过期 | 重新打开文档 | 返回的地址已重签，图片正常显示，正文内容与对象键均未改变 |
