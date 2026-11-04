import { describe, expect, it } from 'vitest'
import { ImError } from '@veren/im'
import { bindRequestOf, excerptOf, fail, jsonOf, ok, outsideRoom, requireString } from '../src/values.ts'
import { registerImTools } from '../src/tools.ts'
import { build } from './fixtures.ts'

describe('tool values', () => {
  it('wraps successes and failures into stable envelopes', () => {
    expect(ok({ n: 1 })).toEqual({ ok: true, n: 1 })
    const refused = fail(new ImError('IM_NOT_FOUND', '没有')) as { ok: false; error: { code: string; message: string } }
    expect(refused).toEqual({ ok: false, error: { code: 'IM_NOT_FOUND', message: '没有' } })
    const internal = fail(new Error('boom')) as { error: { code: string } }
    expect(internal.error.code).toBe('IM_INTERNAL')
    // requireString 只验证非空，不改动原值 / requireString validates non-empty and returns the original
    expect(requireString('  x ', 'f')).toBe('  x ')
    expect(() => requireString('  ', 'f')).toThrow()
    const outside = outsideRoom() as { ok: boolean }
    expect(outside.ok).toBe(false)
    expect(excerptOf('一二三四五', 3)).toBe('一二三')
    expect(jsonOf({ a: 1 })).toEqual({ a: 1 })
  })

  it('builds bind requests per method', () => {
    expect(bindRequestOf('qrcode', {})).toEqual({ method: 'qrcode' })
    expect(bindRequestOf('token', { token: 't', label: 'L' })).toEqual({ method: 'token', token: 't', label: 'L' })
    expect(bindRequestOf('password', { username: 'u', password: 'p' })).toEqual({ method: 'password', username: 'u', password: 'p' })
    expect(() => bindRequestOf('token', {})).toThrow()
  })
})

describe('tool registration', () => {
  it('registers the full family and unregisters in reverse order', () => {
    const stack = build()
    const registered: string[] = []
    const disposed: string[] = []
    let effectDisposer: (() => void) | undefined
    const ctx = {
      // 驱动 effect 工厂立即执行，并记录注册与逆序注销。
      // Drive the effect factory immediately, recording registrations and
      // reverse disposal.
      effect: (factory: () => () => void) => {
        effectDisposer = factory()
      },
      tools: {
        register: (tool: { name: string }) => {
          registered.push(tool.name)
          return () => { disposed.push(tool.name) }
        },
      },
    } as unknown as Parameters<typeof registerImTools>[0]
    registerImTools(ctx, {
      conversation: stack.conversation,
      coordination: stack.coordination,
      turn: stack.turn,
      directory: stack.directory,
      intake: stack.intake,
      memory: stack.memory,
      participants: stack.participants,
      bindings: stack.bindings,
      registry: stack.registry,
      credentials: { async remove() {} },
      people: stack.people,
      logger: { warn() {}, error() {} },
    })
    expect(registered).toEqual([
      'im_bind', 'im_unbind', 'im_send', 'im_rooms', 'im_read', 'im_people',
      'im_person_save', 'im_intake', 'im_person_report', 'im_remember', 'im_recall',
    ])
    effectDisposer?.()
    expect(disposed).toEqual([...registered].reverse())
  })
})
