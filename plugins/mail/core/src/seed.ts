/**
 * The station seed: the one workflow and recipient that make a fresh
 * installation usable on its first trigger.
 *
 * The design leaves workflow definition to business plugins, and that is
 * also why a bare install could never deliver anything: nobody owned the
 * first workflow, so every `mail_send` died on
 * `MAIL_TRIGGER_WORKFLOW_NOT_FOUND`. This module writes exactly two
 * records, each only when absent: the pass-through `station-notice`
 * workflow and the `host` recipient. An operator's edit to either record
 * is never clobbered, and a re-activation (HMR included) is a no-op.
 *
 * 站点种子：让全新安装第一次触发即可用的一条工作流与一个收件人。
 *
 * 设计把工作流定义留给业务插件，这也导致裸安装永远投不出任何东西——没有人负责第一条工作流，
 * 每次 `mail_send` 都死在 `MAIL_TRIGGER_WORKFLOW_NOT_FOUND` 上。本模块恰好写两条记录，缺省才写：
 * 透传式 `station-notice` 工作流与 `host` 收件人。运营者对任一记录的修改绝不被覆盖，
 * 重激活（含 HMR）是无操作。
 *
 * @module @veren/mail/seed
 */

import type { MailStore } from './store.ts'
import type { SubscriberRecord, WorkflowRecord } from './types.ts'

/** The trigger identifier the station workflow answers. / 站点工作流应答的触发标识。 */
export const STATION_TRIGGER = 'station-notice'

/** The recipient identifier the station ships with. / 站点自带的收件人标识。 */
export const STATION_SUBSCRIBER = 'host'

/**
 * The station workflow: the payload passes straight through into the
 * notice, so a caller never authors a template to say one thing.
 *
 * 站点工作流：载荷直接透传为通知，调用方为说一句话不需要自己写模板。
 *
 * @param now - the definition's write time / 定义的写入时刻
 * @returns the workflow record / 工作流记录
 */
function stationWorkflow(now: number): WorkflowRecord {
  return {
    workflowId: 'wf-station-notice' as WorkflowRecord['workflowId'],
    triggerIdentifier: STATION_TRIGGER,
    name: '站内通知',
    status: 'ACTIVE',
    draft: false,
    steps: [{
      stepId: 'notice',
      type: 'in_app',
      content: { subject: '{{ title }}', body: '{{ body }}' },
    }],
    payloadSchema: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', description: 'The notice subject.' },
        body: { type: 'string', description: 'The notice body.' },
      },
      additionalProperties: false,
    },
    severity: 'medium',
    critical: false,
    tags: ['station'],
    updatedAt: now,
  }
}

/**
 * The station recipient: the host operator, reachable on the inbox alone.
 *
 * 站点收件人：宿主运营者，仅站内收件箱可达。
 *
 * @param now - the profile's write time / 档案的写入时刻
 * @returns the subscriber record / 收件人记录
 */
function hostSubscriber(now: number): SubscriberRecord {
  return {
    subscriberId: STATION_SUBSCRIBER as SubscriberRecord['subscriberId'],
    name: '站长',
    deleted: false,
    updatedAt: now,
  }
}

/**
 * Write the seed records, each only when absent. Seeding is deliberately
 * not a deletion point: uninstalling never removes notifications the
 * operator has already received.
 *
 * 写入种子记录，各自仅在缺省时写。种子刻意不是删除点：卸载绝不移除运营者已收到的通知。
 *
 * @param store - the durable store / 持久化存储
 */
export async function ensureStationSeed(store: MailStore): Promise<void> {
  const now = Date.now()
  const existing = store.workflows().find((workflow) => workflow.triggerIdentifier === STATION_TRIGGER)
  if (existing === undefined) {
    await store.putWorkflow(stationWorkflow(now))
  }
  if (store.getSubscriber(STATION_SUBSCRIBER) === undefined) {
    await store.putSubscriber(hostSubscriber(now))
  }
}
