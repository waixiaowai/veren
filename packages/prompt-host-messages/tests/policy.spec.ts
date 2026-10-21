import { describe, expect, it } from 'vitest'
import { anthropicPolicy, deepseekPolicy, estimateTokens, openaiPolicy, planMessages, policyFor, remount, toChatMessages, tokenBudgetPolicy } from '../src/index.ts'
import { MessageHost } from '../src/host.ts'

describe('policyFor', () => {
  it('已登记 provider 各归其位', () => {
    expect(policyFor('deepseek')).toBe(deepseekPolicy)
    expect(policyFor('openai')).toBe(openaiPolicy)
    expect(policyFor('anthropic')).toBe(anthropicPolicy)
  })
  it('未知 provider：显式默认 = deepseek 语义（自动前缀缓存，零断点）', () => {
    expect(policyFor('moonshot')).toBe(deepseekPolicy)
    expect(policyFor('')).toBe(deepseekPolicy)
  })
})

describe('cache policies', () => {
  it('deepseek：自动前缀缓存，零显式标记，消息原样直通', () => {
    const blocks = planMessages(deepseekPolicy, 'SYS', [
      { role: 'user', content: 'SNAPSHOT v1 {...}' },
      { role: 'user', content: 'PATCH v1->v2 {...}' },
    ])
    expect(blocks.every((block) => block.cacheControl === undefined)).toBe(true)
    expect(toChatMessages(blocks)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'SNAPSHOT v1 {...}' },
      { role: 'user', content: 'PATCH v1->v2 {...}' },
    ])
  })

  it('anthropic：尾部同步消息携带 ephemeral 断点', () => {
    const blocks = planMessages(anthropicPolicy, 'SYS', [{ role: 'user', content: 'PATCH ...' }])
    expect(blocks[0].cacheControl).toBeUndefined() // 系统提示不加（消息级断点）
    expect(blocks[1].cacheControl).toBe('ephemeral')
  })
})

describe('compaction', () => {
  it('tokenBudgetPolicy：任一阈值触顶即需要 remount', () => {
    const policy = tokenBudgetPolicy({ maxEntries: 3, maxApproxTokens: 1000 })
    expect(policy.shouldCompact({ entries: 2, approxTokens: 10, versionsSinceAnchor: 2 })).toBe(false)
    expect(policy.shouldCompact({ entries: 3, approxTokens: 10, versionsSinceAnchor: 3 })).toBe(true)
    expect(policy.shouldCompact({ entries: 1, approxTokens: 2000, versionsSinceAnchor: 1 })).toBe(true)
  })

  it('estimateTokens：字节 / 3 向上取整', () => {
    expect(estimateTokens('abcdef')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })

  it('remount：anchor 后回落全量快照，作为新会话基线', () => {
    const host = new MessageHost()
    host.append({ kind: 'static', props: { content: '任务中心' } })
    host.append({ kind: 'item', key: 't-1', props: { path: 'tasks', value: { id: 't-1' } } })
    host.flush()
    host.append({ kind: 'item', key: 't-1', props: { path: 'tasks', value: { id: 't-1', done: true } } })
    host.flush()

    const { version, snapshotText } = remount(host)
    expect(snapshotText.startsWith('SNAPSHOT v')).toBe(true)
    expect(snapshotText).toContain('"done":true')
    expect(host.renderSince(version).kind).toBe('patch')
    expect(host.renderSince(version - 1).kind).toBe('snapshot') // 压实前游标回落快照
  })

  it('logStats：entries/approxTokens/versionsSinceAnchor 可供策略消费', () => {
    const host = new MessageHost()
    host.append({ kind: 'item', key: 't-1', props: { path: 'tasks', value: { id: 't-1' } } })
    host.flush()
    const stats = host.logStats()
    expect(stats.entries).toBe(1)
    expect(stats.approxTokens).toBeGreaterThan(0)
    expect(stats.versionsSinceAnchor).toBe(1)
    expect(tokenBudgetPolicy({ maxEntries: 1 }).shouldCompact(host.logStats())).toBe(true)
  })
})
