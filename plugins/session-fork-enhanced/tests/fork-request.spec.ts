// fork-request 纯函数层的单元测试：参数校验归一、边界推断、有效模型选择。
// Unit tests for the fork-request pure-function layer: argument validation,
// boundary inference, and effective model selection.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { effectiveSelection, latestCompletedPrefixBoundary, normalizeArguments, sameSelection, selectionOf } from '../src/fork-request.js'
import { TOOL_NAME } from '../src/fork-request.js'

/** 构造带类型豁免的最小事件夹具：测试只关心 type/seq/surfaceOp。
 * Build a minimal event fixture with a type exemption: tests only care about
 * type/seq/surfaceOp. */
function event(partial: { type: string; seq: number; surfaceOp?: string; data?: unknown }): SessionEvent {
  return { time: 0, ...partial } as unknown as SessionEvent
}

describe('normalizeArguments', () => {
  it('拒绝非对象参数 / rejects non-object arguments', () => {
    expect(() => normalizeArguments(null)).toThrow(`${TOOL_NAME}: arguments must be an object`)
    expect(() => normalizeArguments([1])).toThrow(`${TOOL_NAME}: arguments must be an object`)
  })

  it('拒绝未知参数与空 sessionId / rejects unknown args and empty sessionId', () => {
    expect(() => normalizeArguments({ sessionId: 's', extra: 1 })).toThrow(/unknown argument/)
    expect(() => normalizeArguments({ sessionId: '  ' })).toThrow(/sessionId must be a non-empty string/)
  })

  it('拒绝非法 atSeq / rejects invalid atSeq', () => {
    expect(() => normalizeArguments({ sessionId: 's', atSeq: -1 })).toThrow(/non-negative integer/)
    expect(() => normalizeArguments({ sessionId: 's', atSeq: 1.5 })).toThrow(/non-negative integer/)
  })

  it('provider 与 model 必须成对 / provider and model must be paired', () => {
    expect(() => normalizeArguments({ sessionId: 's', provider: 'p' })).toThrow(/supplied together/)
    expect(() => normalizeArguments({ sessionId: 's', reasoningEffort: 'high' })).toThrow(/requires provider and model/)
  })

  it('归一化合法请求 / normalizes a valid request', () => {
    expect(normalizeArguments({ sessionId: 's', atSeq: 3, provider: 'p', model: 'm', reasoningEffort: 'high' }))
      .toEqual({ sessionId: 's', atSeq: 3, provider: 'p', model: 'm', reasoningEffort: 'high' })
  })
})

describe('latestCompletedPrefixBoundary', () => {
  it('没有已完成轮次时返回 undefined / returns undefined without a completed turn', () => {
    expect(latestCompletedPrefixBoundary([event({ type: 'turn/start', seq: 0 })])).toBeUndefined()
    expect(latestCompletedPrefixBoundary([])).toBeUndefined()
  })

  it('吞掉轮次结束后的独立事件，遇到新轮次边界即停 / absorbs standalone events then stops at a new turn', () => {
    const events = [
      event({ type: 'turn/start', seq: 0 }),
      event({ type: 'turn/end', seq: 1 }),
      event({ type: 'system/message', seq: 2 }),
      event({ type: 'turn/start', seq: 3 }),
    ]
    expect(latestCompletedPrefixBoundary(events)).toBe(2)
  })
})

describe('selection helpers', () => {
  it('selectionOf 字符串化 effort / selectionOf stringifies the effort', () => {
    expect(selectionOf({ provider: 'p', model: 'm', reasoningEffort: 2 })).toEqual({ provider: 'p', model: 'm', reasoningEffort: '2' })
    expect(selectionOf({ provider: 'p', model: 'm' })).toEqual({ provider: 'p', model: 'm' })
  })

  it('sameSelection 严格比较 / sameSelection compares strictly', () => {
    expect(sameSelection({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' })).toBe(true)
    expect(sameSelection({ provider: 'p', model: 'm' }, { provider: 'p', model: 'x' })).toBe(false)
    expect(sameSelection(undefined, { provider: 'p', model: 'm' })).toBe(false)
  })

  it('有效选择优先级：pending > 最后请求头 > 部署默认 / priority: pending > last header > default', () => {
    const defaultSelection = { provider: 'dp', model: 'dm' }
    const ctx = { agentDefaultModel: { currentSelection: () => defaultSelection } } as never
    const events = [
      event({ type: 'model/selection', seq: 0, data: { provider: 'pp', model: 'pm' } }),
      event({
        type: 'request/header', seq: 1,
        data: { header: { config: { provider: 'lp', model: 'lm' } } },
      }),
    ]
    // pending 未被消费：赢。The pending selection was not consumed: it wins.
    expect(effectiveSelection(ctx, events)).toEqual({ provider: 'pp', model: 'pm' })

    // pending 与最后请求头一致时被消费：回落到最后的请求头路由。
    // A pending matching the last header is consumed and the last header
    // route wins.
    const consumed = [
      event({ type: 'model/selection', seq: 0, data: { provider: 'lp', model: 'lm' } }),
      event({
        type: 'request/header', seq: 1,
        data: { header: { config: { provider: 'lp', model: 'lm' } } },
      }),
    ]
    expect(effectiveSelection(ctx, consumed)).toEqual({ provider: 'lp', model: 'lm' })

    // 空日志：直接使用部署默认。Empty log: the deployment default wins.
    expect(effectiveSelection(ctx, [])).toEqual(defaultSelection)
  })
})
