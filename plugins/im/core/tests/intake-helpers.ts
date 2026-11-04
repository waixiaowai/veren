/**
 * Shared fixtures for the stranger-intake specs: a recording fake provider
 * service, a deterministic clock, and the same observe-then-intake handle the
 * plugin's own listener builds.
 *
 * 陌生人采集测试的共享夹具：记录型假 provider 服务、确定性时钟，以及与插件自身监听一致的
 * 「观察后采集」处理把手。
 *
 * @module tests/intake-helpers
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  ImAccount,
  ImBindAttempt,
  ImBindRequest,
  ImFeatures,
  ImMessage,
  ImSendRequest,
  ImSendResult,
  ImService,
} from '../src/contract.ts'
import { ImError, ImRegistry } from '../src/contract.ts'
import { ImPeople } from '../src/people.ts'
import { ImStrangerIntake } from '../src/intake.ts'
import type { ImLogger } from '../src/runtime-seams.ts'
import { MemoryStore } from './memory-store.ts'

export const FEATURES: ImFeatures = {
  direct: true,
  group: false,
  threads: false,
  markdown: false,
  media: { image: false, file: false },
  typing: false,
  auth: ['qrcode'],
  limits: { textChars: 1_800 },
}

export const silent: ImLogger = { warn() {}, error() {} }

/**
 * Resolve the intake section of the plugin config the way the schema's
 * defaults would: only the intake fields matter to these specs, and the real
 * full-Config validation lives in index's Config schema.
 * 按缺省值的方式解析插件配置的采集段：这些测试只关心采集字段；完整的 Config 校验在
 * index 的 Config schema 里。
 */
export function parseConfig(
  input: { strangerIntake?: { enabled?: boolean } },
): { strangerIntake: { enabled: boolean; replyWindowMs: number; maxAsksPerHour: number; minAskIntervalMs: number } } {
  return {
    strangerIntake: {
      enabled: input.strangerIntake?.enabled ?? true,
      replyWindowMs: 120_000,
      maxAsksPerHour: 10,
      minAskIntervalMs: 10_000,
    },
  }
}

/** One ImService that records every send instead of reaching a channel. */
/** 一只记录每次发送、不触及任何渠道的 ImService。 */
export class RecordingService implements ImService {
  readonly features = FEATURES
  readonly sent: ImSendRequest[] = []

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async accounts(): Promise<ImAccount[]> {
    return [{ id: 'acc', displayName: 'Account', status: 'online' }]
  }
  listen(): () => void {
    return () => {}
  }
  async bind(_request: ImBindRequest): Promise<ImBindAttempt> {
    throw new ImError('IM_UNSUPPORTED', 'tests do not bind')
  }
  async send(request: ImSendRequest): Promise<ImSendResult> {
    this.sent.push(request)
    return { id: `sent-${this.sent.length}`, sentAt: now() }
  }
}

let clock = 1_000
/** The deterministic clock the fixtures advance manually. */
/** 夹具手动推进的确定性时钟。 */
export function now(): number {
  return clock
}

/** Advance the deterministic clock. */
/** 推进确定性时钟。 */
export function advance(ms: number): void {
  clock += ms
}

/** Build one inbound direct message from a stranger. */
/** 构建一条来自陌生人的入站私聊消息。 */
export function message(id: string, externalId: string, text: string): ImMessage {
  return {
    id,
    accountId: 'acc',
    conversationId: `p2p:${externalId}`,
    sender: { id: externalId },
    sentAt: now(),
    content: { type: 'text', text },
  }
}

/**
 * Wire a registry + people + intake over a memory store with the given intake
 * config, and return the same inbound handle the plugin's own listener builds.
 * 在内存存储上按给定采集配置接线 registry + people + intake，返回与插件自身监听一致的
 * 入站处理把手。
 */
export function setup(options: {
  enabled?: boolean
  replyWindowMs?: number
  maxAsksPerHour?: number
  minAskIntervalMs?: number
} = {}) {
  clock = 1_000
  const ctx = new Context()
  const store = new MemoryStore()
  const service = new RecordingService()
  let counter = 0
  const newId = (prefix: string): string => `${prefix}-${++counter}`
  const people = new ImPeople({ store, logger: silent, now, newId })
  const registry = new ImRegistry(ctx, undefined, people)
  registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service })
  const intake = new ImStrangerIntake({
    people,
    logger: silent,
    config: {
      enabled: options.enabled ?? true,
      replyWindowMs: options.replyWindowMs ?? 120_000,
      maxAsksPerHour: options.maxAsksPerHour ?? 10,
      minAskIntervalMs: options.minAskIntervalMs ?? 0,
    },
    now,
    send: async request => service.send({
      target: { accountId: request.accountId, conversationId: request.conversationId },
      content: { type: 'text', text: request.text },
    }),
  })
  const handle = async (providerId: string, inbound: ImMessage): Promise<void> => {
    const person = await registry.observeInbound(providerId, inbound)
    await intake.handle(providerId, inbound, person)
  }
  return { store, service, people, intake, registry, handle }
}

/** Seed the one account every fixture routes through. */
/** 预置所有夹具都经过的那只账号。 */
export async function seedAccount(store: MemoryStore): Promise<void> {
  await store.putAccount({ id: 'acc', provider: 'fake', token_ref: 'im/x' })
}
