/**
 * 路由席位语义：双激活让位、占有者消失后接管、拆卸后不再占有。
 * Route-seat semantics: a second activation yields, a yielded instance takes
 * over once the owner disappears, and a torn-down instance stops claiming.
 *
 * @module @veren/opencode-go/tests
 */
import { describe, expect, it, vi } from 'vitest'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { OPENCODE_GO_PROVIDER } from '../src/catalog.js'
import { keepRoute, routeServed } from '../src/route.js'

/** 假宿主：只实现 keepRoute 读到的 llm 注册面、事件与 effect。The fake host: only the registry, event, and effect faces keepRoute reads. */
function fakeSeat(options: { readonly served?: boolean } = {}) {
  const listeners = new Set<() => void>()
  const teardowns: Array<() => void> = []
  const registrations: string[][] = []
  const logs: string[] = []
  let served = options.served ?? false
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  /** 模拟另一实例释放路由（卸载、热重载）。Simulates the peer releasing the route (unload, hot reload). */
  const releasePeer = (): void => {
    served = false
    notify()
  }
  const ctx = {
    logger: { info: (message: string) => { logs.push(message) } },
    llm: {
      listProviders: () => (served ? [{ id: OPENCODE_GO_PROVIDER, name: 'OpenCode Go' }] : []),
      registerAdapter: (providers: string[]) => {
        registrations.push(providers)
        if (served) throw Object.assign(new Error('already registered'), { code: 'DUPLICATE_ADAPTER' })
        served = true
        return () => {
          served = false
          notify()
        }
      },
    },
    on: (_event: string, listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    effect: (execute: () => () => void) => {
      teardowns.push(execute())
      return () => Promise.resolve()
    },
  }
  return {
    ctx,
    registrations,
    logs,
    notify,
    releasePeer,
    isServed: () => served,
    /** 模拟插件卸载：倒序执行 effect 的拆卸函数。Simulates plugin unload: runs effect teardowns in reverse. */
    teardown: () => { for (const dispose of teardowns.reverse()) dispose() },
  }
}

const adapter = {} as LlmAdapter

describe('keepRoute', () => {
  it('路由空闲时立即占有，并把路由交给适配器', () => {
    const seat = fakeSeat()
    const onOwned = vi.fn()
    keepRoute(seat.ctx as never, adapter, onOwned)
    expect(seat.registrations).toEqual([[OPENCODE_GO_PROVIDER]])
    expect(seat.isServed()).toBe(true)
    expect(routeServed(seat.ctx as never)).toBe(true)
    expect(onOwned).toHaveBeenCalledTimes(1)
  })

  it('路由已被兄弟实例占用时让位：不重复注册、不挂登录网关', () => {
    const seat = fakeSeat({ served: true })
    const onOwned = vi.fn()
    keepRoute(seat.ctx as never, adapter, onOwned)
    expect(seat.registrations).toEqual([])
    expect(onOwned).not.toHaveBeenCalled()
    expect(seat.logs.join('\n')).toMatch(/held by another activation/)
  })

  it('占有者消失后，让位实例接管路由并补挂登录网关', () => {
    const seat = fakeSeat({ served: true })
    const onOwned = vi.fn()
    keepRoute(seat.ctx as never, adapter, onOwned)
    seat.releasePeer()
    expect(seat.registrations).toEqual([[OPENCODE_GO_PROVIDER]])
    expect(seat.isServed()).toBe(true)
    expect(onOwned).toHaveBeenCalledTimes(1)
    expect(seat.logs.join('\n')).toMatch(/claimed the provider route/)
  })

  it('自己持有路由时，目录拓扑广播不会导致重复注册', () => {
    const seat = fakeSeat()
    const onOwned = vi.fn()
    keepRoute(seat.ctx as never, adapter, onOwned)
    seat.notify()
    expect(seat.registrations).toHaveLength(1)
    expect(onOwned).toHaveBeenCalledTimes(1)
  })

  it('拆卸后释放路由，且自身广播不诱发重新占有', () => {
    const seat = fakeSeat()
    keepRoute(seat.ctx as never, adapter, vi.fn())
    seat.teardown()
    expect(seat.isServed()).toBe(false)
    expect(seat.registrations).toHaveLength(1)
  })
})
