/**
 * Shared fixtures for the stranger-intake specs: a recording fake provider
 * service, a deterministic clock, and a fully wired router with intake on.
 *
 * 陌生人采集测试的共享夹具：记录型假 provider 服务、确定性时钟，以及一只开启采集、
 * 接线完整的 router。
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
import { ImRouter } from '../src/router.ts'
import type { ImStrangerIntakeConfig } from '../src/intake.ts'
import { Config } from '../src/index.ts'
import type { Config as ImConfig } from '../src/index.ts'
import type { ImCredentialStore, ImLogger, ImSessionGateway } from '../src/router.ts'
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
 * Parse a partial config through the real schema. The `z<Config>` call face
 * demands a fully populated Config, but every field carries a `.default`, so
 * the runtime fills missing fields — this helper only widens the spec's input
 * type so defaults can actually be tested.
 * 经真实 schema 解析部分配置。`z<Config>` 的调用面要求全量 Config，但每个字段
 * 都带 `.default`，运行时会补齐缺省——本助手只放宽测试入参的类型，让缺省值
 * 可被真实地测到。
 */
export function parseConfig(
  input: Partial<Omit<ImConfig, 'strangerIntake'>> & { strangerIntake?: Partial<ImStrangerIntakeConfig> },
): ImConfig {
  return Config(input as ImConfig)
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

/** A session gateway fake whose sessions never answer. */
/** 一只会话永不回答的会话网关假实现。 */
export class TestGateway implements ImSessionGateway {
  async ensureSession(): Promise<{ sessionId: string; created: boolean }> {
    return { sessionId: 'session-1', created: true }
  }
  async ask(): Promise<string | undefined> {
    return undefined
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

/** Wire a registry + people + router over a memory store with the given intake config. */
/** 在内存存储上按给定采集配置接线 registry + people + router。 */
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
  const registry = new ImRegistry(ctx, () => {})
  registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service })
  let counter = 0
  const newId = (prefix: string): string => `${prefix}-${++counter}`
  const people = new ImPeople({ store, logger: silent, now, newId })
  const credentials: ImCredentialStore = { async remove() {} }
  const router = new ImRouter({
    store,
    registry,
    gateway: new TestGateway(),
    credentials,
    people,
    logger: silent,
    config: {
      strangerIntake: {
        enabled: options.enabled ?? true,
        replyWindowMs: options.replyWindowMs ?? 120_000,
        maxAsksPerHour: options.maxAsksPerHour ?? 10,
        minAskIntervalMs: options.minAskIntervalMs ?? 0,
      },
    },
    now,
    newId,
  })
  return { store, service, people, router }
}

/** Seed the one account every fixture routes through. */
/** 预置所有夹具都经过的那只账号。 */
export async function seedAccount(store: MemoryStore): Promise<void> {
  await store.putAccount({ id: 'acc', provider: 'fake', token_ref: 'im/x' })
}
