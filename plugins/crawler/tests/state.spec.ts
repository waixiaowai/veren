import { describe, expect, it } from 'vitest'
import { transition } from '../src/task/state.ts'

// 状态机契约（design/states.md §1）：合法转移放行，非法转移带码拒绝。
// State machine contract (design/states.md §1): legal transitions pass,
// illegal ones reject with their failure codes.
describe('crawler task state machine', () => {
  it('walks the legal happy path idle→starting→running→idle', () => {
    expect(transition('idle', 'starting')).toBe('starting')
    expect(transition('starting', 'running')).toBe('running')
    expect(transition('running', 'idle')).toBe('idle')
  })

  it('allows running→stopping and stopping→idle', () => {
    expect(transition('running', 'stopping')).toBe('stopping')
    expect(transition('stopping', 'idle')).toBe('idle')
  })

  it('allows running→error and error→idle reset', () => {
    expect(transition('running', 'error')).toBe('error')
    expect(transition('error', 'idle')).toBe('idle')
  })

  it('rejects double-start with CRAWLER_ALREADY semantics (code CRAWLER_NOT_RUNNING family)', () => {
    expect(() => transition('running', 'starting')).toThrowError(/非法状态转移/)
    expect(() => transition('starting', 'starting')).toThrowError()
  })

  it('rejects stop when idle and start when stopping', () => {
    expect(() => transition('idle', 'stopping')).toThrowError()
    expect(() => transition('stopping', 'starting')).toThrowError()
  })
})
