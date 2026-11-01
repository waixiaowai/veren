# @veren/effects

持久化副作用队列核：先把工作行落库、之后再执行，写入与执行之间崩溃也不丢工作。队列逻辑是存储无关的——介质由调用方注入。

语义出处：本包把官方研究原型 [dsh-superagent](../deepseek/dsh-superagent) 的 `src/app/effects.ts`（MIT）的**语义**移植为存储无关的核，未 vendor 任何官方文件；每处规则的出处见 `src/core.ts` / `src/dispatch.ts` 的文件头注释。

## 何时用 / When to use

- 适用于"先落库、后执行"且执行必须跨重启存活的副作用：收件箱通知、outbox 回执、启动/投递类工作。
- 不适用于允许随进程丢失的即发即忘工作，也不适用于调用方已有自己的持久队列的场景（不要两层队列叠用）。

- Use it when a feature must run an external action **after** a durable write lands — inbox notices, outbox replies, launch/delivery work — and the action must survive a process restart.
- Skip it for fire-and-forget work that may be lost on a restart, and for work that is already durable on the caller's own queue (do not stack two queues).

## 语义（契约）/ Semantics (the contract)

| 规则 | 含义 |
| --- | --- |
| 事务内入队 | `enqueue` 只负责持久化行；与其余写入的原子性由调用方自己的事务/写链保证。行落盘前不会派发。 |
| 合并覆盖 | 每个 `kind + key` 一行。对等待中的 key 重复入队 = 换载荷、保留队列位（`seq`）、`attempts` 清零、`generation` 自增。 |
| `Later` | 处理器抛 `Later` = 暂缓到初始重试延迟，**不计失败**——用于"当下没有可用的投递目标"。 |
| 退避 | 其余失败按 `min(max, initial × 2^attempts)` 重试；行上记录最后一次错误文本。 |
| ordered | `ordered: true` 按 `seq` 一次跑一条；失败的行阻塞该 kind 之后的所有行。 |
| 并发 | `limit()` 决定该 kind 同时跑几条；`0` 持住整类。只有存在就绪行时才查询。 |
| 健康 | 同一行连续失败 `FAILURES_BEFORE_ERROR`（3）次该 kind 才报 `error`；`quiet: true` 永不报（失败在别处呈现）。队列机构自身的失败（后端抛错、`limit()` 抛错）挂在 kind 名下，直到该 kind 派发成功一次。 |
| 停机 | `drain()` 停止派发，等待行与被停机打断的行都留在存储里；下一次 `Effects.open` 接续。 |
| 重启 | 行按 `seq` 恢复；新入队从持久化行的最大 `seq` 之后续号。被中断的行是 at-least-once（完成的行恰好一次）——处理器必须幂等。 |

| Rule | Meaning |
| --- | --- |
| Transactional enqueue | `enqueue` persists the row; the caller's own transaction/write chain guarantees atomicity with its other writes. Nothing dispatches before the row is durable. |
| Coalescing | One row per `kind + key`. Re-enqueueing a waiting key replaces its payload, keeps its queue position (`seq`), resets `attempts`, and bumps `generation`. |
| `Later` | Throwing `Later` from a handler defers the row to the initial retry delay **without counting a failure** — for "no target available right now". |
| Backoff | Other failures retry after `min(max, initial × 2^attempts)`; the row records the last error text. |
| Ordered kinds | `ordered: true` runs one row at a time in `seq` order; a failed row holds back every later row of the kind. |
| Concurrency | `limit()` decides how many rows of a kind may run at once; `0` holds the kind. It is queried only when ready rows exist. |
| Health | A kind reports `error` only after one row failed `FAILURES_BEFORE_ERROR` (3) consecutive times; `quiet: true` never errors (failures surface elsewhere). A queue-level failure (backend throw, `limit()` throw) reports under the kind until its next good dispatch. |
| Shutdown | `drain()` stops new dispatch and leaves waiting rows and shutdown-cut rows in storage; the next `Effects.open` resumes them. |
| Restart | Rows resume by `seq`; new enqueues continue past every persisted row's `seq`. At-least-once for interrupted rows (exactly-once for completed ones) — handlers must be idempotent. |

与官方行式的有意偏差：官方健康 detail 带 `since <入队时刻>`；按 S1 任务书移植的行契约没有 `since` 列，健康 detail 只报等待数。

Deliberate deviation from the official row: the official detail text embeds `since <enqueue instant>`; the ported row contract carries no `since` column, so health details state the waiting count only.

## 用法 / Usage

包内自带两个后端：

- `MemoryEffectStorage` —— 内存介质，测试与领域测试用。
- `kvEffectStorage(table)` —— 绑键值表。接受的表面是 `@deepseek-ai/dsh-storage-domain` 的 `KvTable<string, EffectRow>` 的结构子集（即 task-center 与 im 实际持久化所用的 API），`domain.table('effects')` 直接可绑；本包不 import 任何 DSH 代码。

```ts
import { Effects, kvEffectStorage, Later } from '@veren/effects'

const effects = await Effects.open<{ deliver: { taskId: string } }>(
  kvEffectStorage(domain.table('effects')),
  { now: Date.now, health: mySink },   // 确定性时钟与健康 sink 可选
)
effects.handle('deliver',
  async (payload, deliveryId) => {
    // throw new Later('no delivery target') —— 暂缓且不计失败
  },
  { retry: [2000, 60_000], limit: () => 1, ordered: false, quiet: false },
)
await effects.enqueue('deliver', deliveryId, { taskId })   // 调用方写链内入队
effects.start()
// 测试：await effects.idle() —— 停机：await effects.drain()
```

核从不设定时器。时间类重试需要驱动：宿主周期性调 `effects.kick()`（task-center 采用官方 Passes 的 2s 节拍）——每次入队、取消与尝试结束也会自动 `kick()`。

The core never sets timers. Time-based retries need a driver: the host kicks `effects.kick()` periodically (task-center uses the official 2 s pass cadence) — `kick()` is also called after every enqueue, cancel, and attempt completion.

## 测试 / Tests

`pnpm --dir packages/effects test` —— 21 条用例，含"杀死进程后重启"的死刑测试：确定性时钟 + 比实例长寿的 `MemoryEffectStorage` 介质 + 重新 `Effects.open`，恢复不丢、不重、不乱序。

`pnpm --dir packages/effects test` — 21 specs including the kill-and-restart (death) tests: a deterministic clock, an outliving `MemoryEffectStorage` medium, and a fresh `Effects.open` must resume rows without loss, duplication, or reordering.
