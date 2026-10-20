// 纯函数层单测：参数校验归一与目标会话解析，全部并发安全。
// Unit tests for the pure-function layer: argument validation and target
// resolution, all concurrency-safe.
import { describe, expect, it } from 'vitest'
import { TOOL_NAME, normalizeSelectArguments, resolveTargetSessionId } from '../src/select-request.js'
import { SelectModelToolError } from '../src/types.js'

/** 断言调用抛出带指定稳定 code 的错误。Assert a call throws the given stable code. */
function codedCode(run: () => unknown): string {
  try {
    run()
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(SelectModelToolError)
    return (error as SelectModelToolError).code
  }
}

describe('normalizeSelectArguments（参数校验 / argument validation）', () => {
  it('接受完整参数 / accepts the full argument set', () => {
    expect(normalizeSelectArguments({
      sessionId: 'session-a',
      provider: 'p',
      model: 'm',
      reasoningEffort: 'high',
    })).toEqual({ sessionId: 'session-a', provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('接受最小参数（无 sessionId 与 effort）/ accepts the minimal set', () => {
    expect(normalizeSelectArguments({ provider: 'p', model: 'm' })).toEqual({ provider: 'p', model: 'm' })
  })

  it('缺 provider 或缺 model 都报成对错误 / reports a pairing error when either side is missing', () => {
    try {
      normalizeSelectArguments({ model: 'm' })
      expect.unreachable()
    } catch (error) {
      expect((error as SelectModelToolError).code).toBe('SELECT_MODEL_PROVIDER_MODEL_REQUIRED')
      expect((error as SelectModelToolError).message).toContain('provider and model')
    }
    try {
      normalizeSelectArguments({ provider: 'p' })
      expect.unreachable()
    } catch (error) {
      expect((error as SelectModelToolError).code).toBe('SELECT_MODEL_PROVIDER_MODEL_REQUIRED')
    }
  })

  it('非对象与非字符串输入报 INVALID_ARGUMENT / rejects non-objects and non-string values', () => {
    expect(codedCode(() => normalizeSelectArguments(null))).toBe('SELECT_MODEL_INVALID_ARGUMENT')
    expect(codedCode(() => normalizeSelectArguments([1]))).toBe('SELECT_MODEL_INVALID_ARGUMENT')
    expect(codedCode(() => normalizeSelectArguments({ provider: '  ', model: 'm' }))).toBe('SELECT_MODEL_INVALID_ARGUMENT')
    expect(codedCode(() => normalizeSelectArguments({ provider: 'p', model: 'm', sessionId: 7 })))
    expect(codedCode(() => normalizeSelectArguments({ provider: 'p', model: 'm', reasoningEffort: 3 })))
      .toBe('SELECT_MODEL_INVALID_ARGUMENT')
  })

  it('拒绝未知键并给出可接受的键清单 / rejects unknown keys and lists the accepted ones', () => {
    try {
      normalizeSelectArguments({ provider: 'p', model: 'm', cwd: '/tmp' })
      expect.unreachable()
    } catch (error) {
      const coded = error as SelectModelToolError
      expect(coded.code).toBe('SELECT_MODEL_INVALID_ARGUMENT')
      expect(coded.message).toContain(TOOL_NAME)
      expect(coded.message).toContain('sessionId, provider, model, reasoningEffort')
    }
  })
})

describe('resolveTargetSessionId（目标会话解析 / target resolution）', () => {
  it('缺省继承调用方会话 / inherits the calling session when omitted', () => {
    expect(resolveTargetSessionId(undefined, 'session-caller')).toBe('session-caller')
  })

  it('显式 sessionId 优先 / an explicit sessionId wins', () => {
    expect(resolveTargetSessionId('session-other', 'session-caller')).toBe('session-other')
  })

  it('两者都缺席时显性失败 / fails loud when neither exists', () => {
    try {
      resolveTargetSessionId(undefined, undefined)
      expect.unreachable()
    } catch (error) {
      expect((error as SelectModelToolError).code).toBe('SELECT_MODEL_NO_CALLER')
    }
  })
})
