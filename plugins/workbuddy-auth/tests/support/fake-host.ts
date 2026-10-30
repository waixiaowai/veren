/**
 * 测试基建：假宿主缝（credentials/authorization/llm 的被读面）。
 * Test support: fake host seams (the read faces of credentials/authorization/llm).
 *
 * credentials.modifyRecord 以 promise 链**严格串行**执行 mutate——宿主缝的
 * 跨进程互斥在单进程测试里的对应物；锁跨 mutate 的 await 持有，这正是
 * "锁跨网络调用"可测的原因。
 * `modifyRecord` runs mutates **strictly serialized** through a promise chain —
 * the single-process counterpart of the seam's cross-process exclusion; the
 * lock spans the mutate's awaits, which is exactly what makes "the lock spans
 * the network call" testable.
 *
 * @module tests/support/fake-host.ts
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** 假凭据缝的被读面。The fake credentials seam. */
export class FakeCredentials {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  /** modifyRecord 的调用记录（并发串行化断言用）。modifyRecord calls (for serialization assertions). */
  readonly modifyLog: string[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private active = 0
  private maxActive = 0

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.records.get(key)
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifyLog.push(key)
    const run = this.chain.then(async () => {
      // 并发计数只在 mutate 实际执行的窗口内活动：峰值 >1 即串行化被破坏。
      // The counter is live only during a mutate's execution window: a peak >1 means serialization broke.
      this.active += 1
      this.maxActive = Math.max(this.maxActive, this.active)
      try {
        const next = await mutate(this.records.get(key))
        if (next === undefined) this.records.delete(key)
        else this.records.set(key, next)
        return next
      } finally {
        this.active -= 1
      }
    })
    this.chain = run.catch(() => {})
    return run
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
  }

  /** 历史峰值并发数：>1 即串行化被破坏。Peak concurrency: >1 means serialization broke. */
  peakConcurrentMutates(): number {
    return this.maxActive
  }
}

/** 假 Context：只提供被读的面。A fake Context providing only the read faces. */
export interface FakeHost {
  readonly ctx: Context
  readonly credentials: FakeCredentials
}

/** 造一个假宿主。Builds one fake host. */
export function createFakeHost(): FakeHost {
  const credentials = new FakeCredentials()
  const ctx = {
    credentials,
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    effect: () => () => {},
  } as unknown as Context
  return { ctx, credentials }
}

/** 本插件占用的记录键。The plugin's record key. */
export const RECORD = credentialKey('workbuddy-auth', 'accounts')
