/**
 * Inbound routing: every message goes to the configured default device (the
 * spike's routing policy), into that device's durable queue; the long-poll
 * waiters are woken so a connected device picks the batch up immediately.
 *
 * 入站路由：每条消息都去配置的默认设备（尖刺期的路由策略），落入该设备的持久队列；
 * 长轮询等待者被唤醒，在线设备立刻取走批次。
 *
 * @module im-hub/route
 */

import { join } from 'node:path'
import type { HubConfig } from './config.ts'
import { DeviceQueue } from './store.ts'
import type { HubQueuedMessage } from './store.ts'
import type { HubRouted } from './session.ts'

/** The routing table plus the per-device durable queues. */
export class HubRouter {
  private readonly queues = new Map<string, DeviceQueue>()
  private readonly waiters = new Map<string, Set<{ after: number; resolve: () => void }>>()

  constructor(private readonly config: HubConfig) {}

  /** The device every inbound message routes to (the spike's policy). */
  target(): string {
    return this.config.defaultDevice
  }

  /** Route one inbound message to the default device; durable on return. */
  deliver(message: HubRouted): HubQueuedMessage {
    const row = this.queue(this.target()).append({
      id: message.id,
      conversationId: message.conversationId,
      sender: message.sender,
      text: message.text,
      sentAt: message.sentAt,
    })
    this.wake(this.target())
    return row
  }

  /**
   * The batch a device should consume next: immediate when the log already
   * has rows past the cursor, otherwise a long poll bounded by `timeoutMs`.
   * 设备该消费的下一批：日志里已有就立刻返回；否则长轮询至 `timeoutMs` 为止。
   */
  async nextBatch(device: string, after: number, timeoutMs: number): Promise<HubQueuedMessage[]> {
    const immediate = this.queue(device).after(after)
    if (immediate.length > 0) return immediate
    await new Promise<void>(resolve => {
      const waiter = { after, resolve }
      const waiters = this.waiters.get(device) ?? new Set()
      waiters.add(waiter)
      this.waiters.set(device, waiters)
      setTimeout(() => {
        this.waiters.get(device)?.delete(waiter)
        resolve()
      }, timeoutMs)
    })
    return this.queue(device).after(after)
  }

  /** Wake every poller waiting on one device. */
  private wake(device: string): void {
    for (const waiter of this.waiters.get(device) ?? []) waiter.resolve()
  }

  /** The newest seq of one device's log (0 when the device is unknown). */
  tailOf(device: string): number {
    return this.queue(device).tail()
  }

  /** The durable queue of one device, created on first use. */
  private queue(device: string): DeviceQueue {
    let queue = this.queues.get(device)
    if (queue === undefined) {
      queue = new DeviceQueue(join(this.config.dataDir, `hub-queue-${device}.jsonl`))
      this.queues.set(device, queue)
    }
    return queue
  }
}
