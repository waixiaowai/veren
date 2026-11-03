/**
 * The dragged-position store: what survives a reload, what is dropped as
 * malformed, and what a refusing storage costs (nothing — dragging still works
 * for the session). Positions are view state only, so every failure here is
 * silent by design and the tests pin that silence.
 *
 * 拖拽位置仓：什么能活过刷新、什么按损坏丢弃、存储拒绝时损失什么（什么都没有——
 * 本会话的拖拽照常可用）。位置只是视图态，因此这里的所有失败按设计静默，测试把这份
 * 静默钉住。
 */

import { describe, expect, it } from 'vitest'
import { loadPositions, savePositions } from '../src/client/canvas-position-store.ts'

/** A Storage implementation over a Map, for tests without a browser. 用 Map 实现的 Storage，供无浏览器测试。 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length(): number { return entries.size },
    clear: (): void => { entries.clear() },
    getItem: (key: string): string | null => entries.get(key) ?? null,
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => { entries.delete(key) },
    setItem: (key: string, value: string): void => { entries.set(key, value) },
  }
}

describe('positions round trip / 位置往返', () => {
  it('keeps one arrangement per owner', () => {
    const store = memoryStorage()
    savePositions('alice', new Map([['a', { id: 'a', x: 12.5, y: -8 }]]), store)
    savePositions('bob', new Map([['a', { id: 'a', x: 1, y: 2 }]]), store)
    expect(loadPositions('alice', store)).toEqual(new Map([['a', { id: 'a', x: 12.5, y: -8 }]]))
    expect(loadPositions('bob', store).get('a')).toEqual({ id: 'a', x: 1, y: 2 })
    expect(loadPositions('carol', store).size).toBe(0)
  })

  it('drops malformed entries and keeps the well-formed ones', () => {
    const store = memoryStorage()
    store.setItem('notebook-canvas-positions:alice', JSON.stringify({
      good: { id: 'good', x: 3, y: 4 },
      noId: { x: 1, y: 2 },
      badNumbers: { id: 'bad', x: '1', y: 2 },
      infinite: { id: 'inf', x: 1, y: Infinity },
      junk: 'nope',
    }))
    expect(loadPositions('alice', store)).toEqual(new Map([['good', { id: 'good', x: 3, y: 4 }]]))
  })

  it('treats unreadable JSON as no arrangement', () => {
    const store = memoryStorage()
    store.setItem('notebook-canvas-positions:alice', '{ not json')
    expect(loadPositions('alice', store).size).toBe(0)
  })

  it('survives a refusing storage in both directions', () => {
    const refusing = {
      ...memoryStorage(),
      getItem: (): string | null => { throw new Error('denied') },
      setItem: (): void => { throw new Error('quota') },
    } as Storage
    expect(loadPositions('alice', refusing).size).toBe(0)
    expect(() => { savePositions('alice', new Map(), refusing) }).not.toThrow()
  })

  it('does nothing when no storage exists at all', () => {
    expect(loadPositions('alice', undefined).size).toBe(0)
    expect(() => { savePositions('alice', new Map(), undefined) }).not.toThrow()
  })

  it('writes through the browser default when the store is omitted', () => {
    const store = memoryStorage()
    // Node has no localStorage field at all; install one for this assertion and
    // put the global back the way it was. Node 根本没有 localStorage 字段；为这条
    // 断言临时装上，结束后原样还原全局。
    const installed = !('localStorage' in globalThis)
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
    try {
      savePositions('alice', new Map([['a', { id: 'a', x: 5, y: 6 }]]))
      expect(store.getItem('notebook-canvas-positions:alice')).toContain('"x":5')
    } finally {
      if (installed) Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
