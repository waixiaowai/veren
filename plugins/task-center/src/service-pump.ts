/**
 * The delivery pump: the inbox seam's internal base, rebuilt on the effects
 * core (`@veren/effects`, semantics ported from the official dsh-superagent
 * `src/app/effects.ts`, MIT reference).
 *
 * Two independent axes (§4.5) stay two independent axes here: the
 * `DeliveryRecord` keeps being the receipt (pending/delivered/read, attempts
 * counted on `markDelivered`), while the effects queue is the scheduler — one
 * `deliver` row per pending notice that keeps the notice's work alive across
 * restarts. The pump never injects into sessions itself (that stays session
 * C's pull, external semantics unchanged); its attempt mirrors the seam's own
 * decision table: it settles notices of terminal tasks (read flip) and
 * defers — `Later`, no failure counted — while a notice is still deliverable.
 *
 * 投递泵：收件箱接缝的内部底座，重建在效果核（`@veren/effects`，语义移植自官方
 * dsh-superagent 的 `src/app/effects.ts`，MIT 参照）之上。
 *
 * 两条独立的轴（§4.5）在这里仍是两条独立的轴：`DeliveryRecord` 继续当回执
 * （pending/delivered/read，attempts 在 `markDelivered` 上计数），效果队列当调度器——
 * 每条 pending 通知一行 `deliver` 效果，让通知的工作跨重启存活。泵绝不自己往会话里
 * 注入（注入仍是会话 C 的拉取，外部语义一概不变）；它的尝试只镜像接缝自己的判定表：
 * 终态任务的通知就地结算（翻 read），仍可投递的通知抛 `Later` 暂缓且不计失败。
 *
 * @module @veren/task-center/service-pump
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { Effects, Later, kvEffectStorage } from '@veren/effects'
import type { EffectHealthSink, EffectHealthSnapshot, EffectRow } from '@veren/effects'
import { view } from './storage.ts'
import { TaskError } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type { TaskId } from './types.ts'
import type { TaskOps } from './service-tree.ts'

/**
 * 效果行 schema（与 @veren/effects 的 EffectRow 逐字段一致）/ the effect row schema, field-for-field `EffectRow`.
 * EffectRow 是 readonly 视图，schema 校验的是同一份数据形状（一次性收窄，同 storage.ts 的做法）。
 * / `EffectRow` is a readonly view; the schema validates the same data shape (one-time narrowing, as in storage.ts).
 */
const effectRowSchema = z.object({
  kind: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  seq: z.number().int().min(0),
  generation: z.number().int().min(0),
  attempts: z.number().int().min(0),
  due: z.number(),
  error: z.string(),
})

/**
 * 泵的独立存储域：效果行单独成域，不动 `task_center` 的版本线——官方行式没有 `since`
 * 列、只服务泵，一张表一个写者（效果核）。
 * / The pump's own storage domain: effect rows live apart so the `task_center`
 * version line stays untouched — the ported row has no `since` column and
 * serves the pump only; one table, one writer (the effects core).
 */
export const taskCenterEffectsDomain = defineDomain({
  name: 'task_center_effects',
  version: 1,
  tables: {
    effects: domainTable<string, EffectRow>(effectRowSchema as never),
  },
})

/** 泵域的名字，共享给诊断 / the pump domain's name, shared with diagnostics */
export const TASK_CENTER_EFFECTS_DOMAIN_NAME = taskCenterEffectsDomain.name

/** One opened pump domain. */
export type TaskEffectsStore = Domain<typeof taskCenterEffectsDomain>

/** 泵跑的唯一效果种类；载荷点名通知所投的任务 / the one effect kind the pump runs; the payload names the notice's task */
export const DELIVER_KIND = 'deliver'
export type DeliveryEffects = Effects<{ deliver: { taskId: string } }>

/**
 * 定时节拍：时间类重试（退避/暂缓）靠周期性 kick 驱动，节拍取官方 Passes 的 2s 巡回。
 * / The tick cadence: time-based retries (backoff/deferral) are driven by a
 * periodic kick at the official pass-loop's 2 s cadence.
 */
export const PUMP_TICK_MS = 2000

/**
 * The pump: owns the effects queue, restores pending notices on start, and
 * exposes track/release for the seam. A degraded effects domain disables the
 * pump silently — the receipt seam keeps working without it.
 * / 泵：拥有效果队列，启动时恢复 pending 通知，向接缝暴露 track/release。效果域打不开
 * 时泵静默降级——回执接缝没有泵照常工作。
 */
export class DeliveryPump {
  private effects: DeliveryEffects | undefined

  /** Open the effects domain, register the handler, restore pending notices, start. */
  async start(ops: TaskOps): Promise<void> {
    const domain = await ops.storage.effects
    if (domain === undefined) return
    const effects = await Effects.open<{ deliver: { taskId: string } }>(
      kvEffectStorage(domain.table('effects')),
      { health: pumpHealthSink(ops) },
    )
    this.effects = effects
    // 非静默（≠ 官方 delivery 的 quiet）：本处理器的失败只会是队列内部的损坏/存储错误
    // （任务行丢失等），应当响亮；投递尝试本身的失败走回执轴（DeliveryRecord.lastError），
    // 根本到不了效果行，quiet 与否不影响它们。
    // / Not quiet (unlike the official delivery kind): this handler's failures
    // can only be queue-internal corruption or storage errors (a missing task
    // row), which must be loud; delivery-attempt failures live on the receipt
    // axis (DeliveryRecord.lastError) and never reach the effect row.
    effects.handle(DELIVER_KIND, (payload, deliveryId) => deliverAttempt(ops, deliveryId, payload.taskId), {
      retry: [2000, 60_000],
    })
    await this.restore(ops)
    effects.start()
  }

  /** Stop starting new attempts and let running ones finish; rows persist for the next start. */
  async stop(): Promise<void> {
    await this.effects?.drain()
  }

  /** Make sure the notice has one pump row; a resend or a restore coalesces here. */
  async track(deliveryId: string, taskId: string): Promise<void> {
    const effects = this.effects
    if (effects === undefined || effects.pending(DELIVER_KIND, deliveryId)) return
    await effects.enqueue(DELIVER_KIND, deliveryId, { taskId })
  }

  /** The receipt axis settled the notice (delivered/read) — drop its pump row. */
  async release(deliveryId: string): Promise<void> {
    await this.effects?.cancel(DELIVER_KIND, deliveryId)
  }

  /** One dispatch cycle; the service drives this on the tick cadence. */
  kick(): void {
    this.effects?.kick()
  }

  /** Restart recovery: notices stored before this pump existed get their rows back. */
  private async restore(ops: TaskOps): Promise<void> {
    const domain = await ops.storage.ready
    if (domain === undefined) return
    for (const [id, row] of domain.table('deliveries').entries()) {
      if (row.state === 'pending') await this.track(id, row.taskId)
    }
  }
}

/**
 * The pump attempt — the seam's own decision table, run by the effects core:
 * a settled or missing receipt row is done; a terminal task flips its pending
 * notice to read; `failed`/`orphaned` stay pending per §4.5; a deliverable
 * notice defers via `Later` until session C pulls it. A missing task row is
 * domain corruption and fails loud through the retry ladder.
 * / 泵的尝试——接缝自己的判定表交给效果核跑：回执行已结算或缺失即完成；终态任务把
 * pending 通知翻 read；`failed`/`orphaned` 按 §4.5 保持 pending；可投递的通知抛 `Later`
 * 暂缓，等会话 C 来拉。任务行缺失属于域损坏，走重试梯子 fail loud。
 */
async function deliverAttempt(ops: TaskOps, deliveryId: string, taskId: string): Promise<void> {
  await ops.storage.write(async domain => {
    const deliveries = view(domain.table('deliveries'))
    const row = deliveries.get(deliveryId)
    if (row === undefined || row.state !== 'pending') return
    const task = ops.tree.tasks(domain).get(taskId as TaskId)
    if (task === undefined) {
      throw new TaskError(TaskErrorCode.NotFound, `notice ${deliveryId} names missing task ${taskId}`)
    }
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'expired') {
      await deliveries.put(deliveryId, { ...row, state: 'read', lastAt: new Date().toISOString() })
      return
    }
    if (task.status !== 'open' && task.status !== 'taken') return
    throw new Later('task-center: the inbox notice waits for a delivery target')
  })
}

/**
 * Health adapter: error transitions go to the host log once per kind; ready
 * snapshots and repeats stay silent (the official board's surface is the
 * panel, which task-center phase 1 does not have).
 * / 健康适配：error 状态的翻转按 kind 进宿主日志一次；ready 与重复快照保持安静
 * （官方面板级的健康面在第 1 阶段的 task-center 还没有）。
 */
function pumpHealthSink(ops: TaskOps): EffectHealthSink {
  const last = new Map<string, string>()
  return {
    set(kind: string, snapshot: EffectHealthSnapshot): void {
      if (snapshot.state === last.get(kind)) return
      last.set(kind, snapshot.state)
      if (snapshot.state === 'error') {
        ops.host.logger.error(`taskCenter: effect queue "${kind}" problem: ${snapshot.detail}`)
      }
    },
  }
}
