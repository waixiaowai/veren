/**
 * The canvas gesture arbiter: which presses belong to the board, and whether the
 * browser's own selection gesture survives them. The browser half itself (a real
 * drag painting nothing) is verified in the live Web GUI — these tests pin the
 * contract that makes that possible.
 *
 * 画布手势仲裁者：哪些按下属于画布，以及浏览器自己的选中手势在这些按下里能否活下来。
 * 浏览器半边（真实拖拽不刷出任何东西）在真实 Web GUI 里验证——这里钉住使那成为可能的
 * 契约。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GestureArbiter, bindCanvasGesture, isCanvasControl, pressIsSpatial } from '../src/client/canvas-gesture.ts'
import type { GestureHost, GestureSurface } from '../src/client/canvas-gesture.ts'

/** A DOM event stand-in: only the fields the arbiter reads. 事件替身：只带仲裁者会读的字段。 */
interface FakeEvent {
  readonly type: string
  readonly target: EventTarget | null
  readonly button?: number
  readonly pointerType?: string
  defaultPrevented: boolean
  preventDefault(): void
}

/** A surface that records listeners instead of dispatching real DOM events. 只记录监听器、不派发真实 DOM 事件的目标。 */
interface FakeSurface extends GestureSurface {
  readonly dispatch: (type: string, event: FakeEvent) => void
  readonly live: () => number
}

/** Build one fake event. 造一个假事件。 */
function fakeEvent(type: string, init: { button?: number, pointerType?: string, target?: EventTarget | null } = {}): FakeEvent {
  return {
    type,
    target: init.target ?? null,
    ...(init.button === undefined ? {} : { button: init.button }),
    ...(init.pointerType === undefined ? {} : { pointerType: init.pointerType }),
    defaultPrevented: false,
    preventDefault(): void { this.defaultPrevented = true },
  }
}

/** Build one fake surface. 造一个假目标。 */
function fakeSurface(): FakeSurface {
  const listeners = new Map<string, Array<(event: Event) => void>>()
  return {
    addEventListener: (type, listener): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener: (type, listener): void => {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener))
    },
    dispatch: (type, event): void => {
      for (const listener of listeners.get(type) ?? []) listener(event as unknown as Event)
    },
    live: (): number => [...listeners.values()].reduce((total, entries) => total + entries.length, 0),
  }
}

/** Bind a board to two fake surfaces and return the pieces under test. 把画布绑到两个假目标上，返回被测部件。 */
function harness(): { host: GestureHost, surface: FakeSurface, root: FakeSurface, clear: ReturnType<typeof vi.fn>, dispose: () => void } {
  const surface = fakeSurface()
  const root = fakeSurface()
  const clear = vi.fn()
  const host: GestureHost = { surface, root, clearSelection: clear }
  return { host, surface, root, clear, dispose: bindCanvasGesture(host) }
}

/** The press that opens a gesture, on the board. 在画布上起手的那次按下。 */
function pressOnBoard(surface: FakeSurface): void {
  surface.dispatch('pointerdown', fakeEvent('pointerdown', { button: 0, pointerType: 'mouse' }))
}

describe('which presses the board owns / 画布接管哪些按下', () => {
  it('takes the primary mouse button, and refuses middle and right', () => {
    expect(pressIsSpatial({ button: 0, pointerType: 'mouse', onControl: false })).toBe(true)
    expect(pressIsSpatial({ button: 1, pointerType: 'mouse', onControl: false })).toBe(false)
    expect(pressIsSpatial({ button: 2, pointerType: 'mouse', onControl: false })).toBe(false)
  })

  it('leaves controls and touch alone', () => {
    expect(pressIsSpatial({ button: 0, pointerType: 'mouse', onControl: true })).toBe(false)
    expect(pressIsSpatial({ button: 0, pointerType: 'touch', onControl: false })).toBe(false)
    expect(pressIsSpatial({ button: 0, pointerType: 'pen', onControl: false })).toBe(true)
  })

  it('never treats a non-element target as a control', () => {
    expect(isCanvasControl(null)).toBe(false)
    expect(isCanvasControl({} as EventTarget)).toBe(false)
  })
})

describe('the armed window / 布防窗口', () => {
  it('starts idle and flips both ways', () => {
    const arbiter = new GestureArbiter()
    expect(arbiter.isArmed()).toBe(false)
    arbiter.arm()
    expect(arbiter.isArmed()).toBe(true)
    arbiter.disarm()
    expect(arbiter.isArmed()).toBe(false)
  })
})

describe('binding the board / 绑定画布', () => {
  it('arms on the press and drops any earlier selection', () => {
    const { surface, clear } = harness()
    pressOnBoard(surface)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('does not arm for a right click', () => {
    const { surface, clear, root } = harness()
    surface.dispatch('pointerdown', fakeEvent('pointerdown', { button: 2, pointerType: 'mouse' }))
    const selection = fakeEvent('selectstart')
    root.dispatch('selectstart', selection)
    expect(clear).not.toHaveBeenCalled()
    expect(selection.defaultPrevented).toBe(false)
  })

  it('cancels mousedown — the event that anchors the browser selection', () => {
    const { surface } = harness()
    pressOnBoard(surface)
    const mouse = fakeEvent('mousedown', { button: 0 })
    surface.dispatch('mousedown', mouse)
    expect(mouse.defaultPrevented).toBe(true)
  })

  it('swallows selectstart and dragstart only while armed', () => {
    const { surface, root } = harness()
    const before = fakeEvent('selectstart')
    root.dispatch('selectstart', before)
    expect(before.defaultPrevented).toBe(false)

    pressOnBoard(surface)
    const during = fakeEvent('selectstart')
    const drag = fakeEvent('dragstart')
    root.dispatch('selectstart', during)
    root.dispatch('dragstart', drag)
    expect(during.defaultPrevented).toBe(true)
    expect(drag.defaultPrevented).toBe(true)
  })

  it('hands the defaults back on pointerup, pointercancel and blur', () => {
    const { surface, root } = harness()
    for (const ending of ['pointerup', 'pointercancel', 'blur']) {
      pressOnBoard(surface)
      root.dispatch(ending, fakeEvent(ending))
      const after = fakeEvent('selectstart')
      root.dispatch('selectstart', after)
      expect(after.defaultPrevented, ending).toBe(false)
    }
  })

  it('removes every listener it installed', () => {
    const { surface, root, dispose } = harness()
    expect(surface.live() + root.live()).toBeGreaterThan(0)
    dispose()
    expect(surface.live() + root.live()).toBe(0)
  })

  it('stops swallowing after the board is torn down', () => {
    const { surface, root, clear, dispose } = harness()
    dispose()
    pressOnBoard(surface)
    const selection = fakeEvent('selectstart')
    root.dispatch('selectstart', selection)
    expect(clear).not.toHaveBeenCalled()
    expect(selection.defaultPrevented).toBe(false)
  })
})

describe('control resolution in a DOM / DOM 里的控件解析', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, 'Element') })

  it('recognises a control and refuses to own its press', () => {
    class FakeElement {
      constructor(private readonly control: boolean) {}
      closest(): unknown { return this.control ? this : null }
    }
    Object.defineProperty(globalThis, 'Element', { value: FakeElement, configurable: true })
    expect(isCanvasControl(new FakeElement(true) as unknown as EventTarget)).toBe(true)
    expect(isCanvasControl(new FakeElement(false) as unknown as EventTarget)).toBe(false)
  })
})
