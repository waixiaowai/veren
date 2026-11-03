/**
 * The canvas's gesture arbiter: the one owner of the question "what does this
 * press mean?". A press on the board is a pan or a card drag; it is never a text
 * selection and never a native drag.
 *
 * The browser settles those defaults at `mousedown`, before Konva's 4px drag
 * distance has run, and a CSS `user-select: none` is a paint-time hint that
 * cannot reach a selection already anchored or one started on a descendant. So
 * the suppression has to be an input contract: arm on the press, cancel the
 * browser's own gestures for exactly as long as the gesture lasts, and hand the
 * defaults back on release.
 *
 * 画布的指针手势仲裁者：唯一回答"按下这一下意味着什么"的地方。按下画布就是平移或
 * 拖卡片，绝不是文字选中、也不是原生拖拽。
 *
 * 浏览器在 `mousedown` 那一刻就定了这些默认行为，早于 Konva 的 4px 拖拽距离；而 CSS
 * 的 `user-select: none` 只是绘制期提示，够不到已经落锚的选区，也拦不住从子元素起手
 * 的选中。所以抑制必须是一份输入契约：按下即布防，手势期间取消浏览器自己的手势，
 * 抬手即交还默认行为。
 *
 * @module @veren/notebook-ui/client/canvas-gesture
 */

/** The three facts about a press that decide whether the board owns it. 决定画布是否接管一次按下的三个事实。 */
export interface PressFacts {
  /** 0 is the primary button; middle and right never pan. 0 是主键；中键与右键从不平移。 */
  readonly button: number
  /** `PointerEvent.pointerType`; touch keeps the browser's own gestures. `PointerEvent.pointerType`；触摸保留浏览器自己的手势。 */
  readonly pointerType: string
  /** True when the press landed on a control the board does not own. 按下落在画布不拥有的控件上时为真。 */
  readonly onControl: boolean
}

/** Controls keep their own press semantics; the board must not swallow them. 控件保留自己的按下语义，画布不得吞掉。 */
export const CONTROL_SELECTOR = '[data-canvas-control], button, a[href], input, textarea, select, label, [contenteditable="true"]'

/**
 * Whether a press belongs to the board.
 * @param press - the facts of the press.
 * @returns true for a primary-button press that is neither touch nor a control.
 *
 * 这次按下是否属于画布。主键、非触摸、非控件时返回 true。
 */
export function pressIsSpatial(press: PressFacts): boolean {
  if (press.onControl) return false
  if (press.button !== 0) return false
  return press.pointerType !== 'touch'
}

/** Resolve a press target to "is this a control". 把按下目标解析为"是不是控件"。 */
export function isCanvasControl(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined') return false
  if (!(target instanceof Element)) return false
  return target.closest(CONTROL_SELECTOR) !== null
}

/** The armed window: from the press that starts a gesture until the release. 布防窗口：从开始手势的那次按下，到手抬起。 */
export class GestureArbiter {
  private armed = false

  /** Mark a gesture as started; native selection is cancelled from here on. 标记手势开始；此后原生选中被取消。 */
  arm(): void { this.armed = true }

  /** Mark the gesture as over; the browser gets its defaults back. 标记手势结束；浏览器恢复默认行为。 */
  disarm(): void { this.armed = false }

  /** True while a board gesture is in flight. 画布手势进行中时为真。 */
  isArmed(): boolean { return this.armed }
}

/** The slice of an event target the arbiter binds to. 仲裁者绑定所需的事件目标切片。 */
export interface GestureSurface {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
}

/** What the binder needs from its host. 绑定器从宿主需要的东西。 */
export interface GestureHost {
  /** The board's element: presses here may start a gesture. 画布元素：这里的按下可能开始手势。 */
  readonly surface: GestureSurface
  /** Scope where the gesture ends and native defaults are intercepted (the window). 手势结束与拦截原生默认行为的作用域（window）。 */
  readonly root: GestureSurface
  /** Drop any selection left over from before the gesture. 丢掉手势之前残留的选区。 */
  readonly clearSelection: () => void
}

/** One listener and where it lives. 一个监听器与它挂在哪里。 */
interface Binding {
  readonly type: string
  readonly onRoot: boolean
  readonly listener: (event: Event) => void
  readonly capture: boolean
}

/** Reduce a DOM event to the facts the arbiter judges. 把 DOM 事件收敛成仲裁者要判断的事实。 */
function factsOf(event: Event): PressFacts {
  const button = 'button' in event ? Number((event as MouseEvent).button) : 0
  const pointerType = 'pointerType' in event ? String((event as PointerEvent).pointerType) : 'mouse'
  return { button, pointerType, onControl: isCanvasControl(event.target) }
}

/** The listeners a bound board needs, in install order. 绑定的画布所需监听器，按安装顺序。 */
function bindingsFor(host: GestureHost, arbiter: GestureArbiter): Binding[] {
  const pressed = (event: Event): void => {
    if (!pressIsSpatial(factsOf(event))) return
    arbiter.arm()
    host.clearSelection()
  }
  // Cancelling mousedown is what actually stops the browser anchoring a
  // selection at the press point: selectstart is the detectable half, not the
  // causative one. 真正阻止浏览器在按点落锚的是取消 mousedown；selectstart 只是
  // 可观测的那一半，不是起因。
  const mousePressed = (event: Event): void => {
    if (!pressIsSpatial(factsOf(event))) return
    event.preventDefault()
  }
  const suppressed = (event: Event): void => {
    if (arbiter.isArmed()) event.preventDefault()
  }
  const released = (): void => { arbiter.disarm() }
  return [
    { type: 'pointerdown', onRoot: false, listener: pressed, capture: false },
    { type: 'mousedown', onRoot: false, listener: mousePressed, capture: false },
    { type: 'selectstart', onRoot: true, listener: suppressed, capture: true },
    { type: 'dragstart', onRoot: true, listener: suppressed, capture: true },
    { type: 'pointerup', onRoot: true, listener: released, capture: true },
    { type: 'pointercancel', onRoot: true, listener: released, capture: true },
    { type: 'blur', onRoot: true, listener: released, capture: false },
  ]
}

/** Pick the event target a binding lives on. 选出监听器所挂的事件目标。 */
function targetOf(host: GestureHost, binding: Binding): GestureSurface {
  return binding.onRoot ? host.root : host.surface
}

/**
 * Own every press on the board until the pointer is released.
 * @param host - the board element, the release scope, and the selection eraser.
 * @returns a disposer that removes every listener it installed.
 *
 * 接管画布上的每一次按下，直到指针抬起。返回卸载函数，移除它装上的每一个监听器。
 */
export function bindCanvasGesture(host: GestureHost): () => void {
  const bindings = bindingsFor(host, new GestureArbiter())
  for (const binding of bindings) {
    targetOf(host, binding).addEventListener(binding.type, binding.listener, binding.capture)
  }
  return () => {
    // Undo in reverse install order, so a teardown can never leave a live listener.
    // 按安装的逆序卸载，任何一次拆除都不会留下活着的监听器。
    for (const binding of [...bindings].reverse()) {
      targetOf(host, binding).removeEventListener(binding.type, binding.listener, binding.capture)
    }
  }
}
