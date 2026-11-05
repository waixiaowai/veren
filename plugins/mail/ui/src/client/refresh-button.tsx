/**
 * The header's primary action: a refresh control that narrates itself.
 *
 * A click must produce evidence. The control therefore has four phases
 * (`idle` → `loading` → `success` | `error` → `idle`): the glyph becomes a
 * spinner while the read is in flight, then a check or an alert for a moment
 * before settling back. All four labels share one grid cell, so the button
 * never reflows as they cross-fade; the idle glyph turns under the pointer as
 * an affordance that it is pressable at all.
 *
 * 页头主操作：一个会自述状态的刷新控件。
 *
 * 点击必须留下证据。因此控件有四个阶段（`idle` → `loading` → `success` | `error` → `idle`）：
 * 读取期间图标变成旋转指示器，随后短暂显示对勾或警告，再回到初始态。四个文案共用一个网格单元，
 * 交叉淡入时按钮宽度不变；初始态图标在指针悬停时旋转，作为「这里可以点」的提示。
 *
 * @module @veren/mail-ui/client/refresh-button
 */

import { useEffect, useRef, useState } from 'react'
import type { MailKey } from './locales.ts'
import type { MailReadOutcome } from './remote.ts'

/** The four phases one refresh click moves through. / 一次刷新点击经历的四个阶段。 */
export type RefreshPhase = 'idle' | 'loading' | 'success' | 'error'

/** How long a terminal phase stays visible before settling back to idle. */
/** 终态在回到初始态之前保持可见的时长。 */
const SETTLE_MS: Record<'success' | 'error', number> = { success: 1_100, error: 2_400 }

/**
 * A local read often lands in a few milliseconds; without a floor the spinner
 * would only flash for one frame and read as a glitch. The floor is short
 * enough to stay honest and long enough to be perceived.
 *
 * 本地读取常常几毫秒就落地；没有下限时指示器只闪一帧，看起来像故障。这个下限短到不失真，
 * 又长到能被感知。
 */
const MIN_LOADING_MS = 340

/** The dictionary key each phase's label uses. / 每个阶段文案所用的词典键。 */
const LABELS: Record<RefreshPhase, MailKey> = {
  idle: 'refresh',
  loading: 'refreshLoading',
  success: 'refreshSuccess',
  error: 'refreshError',
}

/** Everything the control needs: the copy and one self-describing action. */
export interface RefreshButtonProps {
  /** The localized copy. / 本地化文案。 */
  readonly t: (key: MailKey) => string
  /** Run one read and report how it ended. / 执行一次读取并报告结果。 */
  readonly onRefresh: () => Promise<MailReadOutcome>
}

/**
 * The control itself. It owns no data — only the phase of its own last click.
 *
 * 控件本身。它不持有任何数据，只持有「最近一次点击」的阶段。
 *
 * @param props - the copy and the action / 文案与动作
 * @returns the button plus its live announcement / 按钮及其读屏播报
 */
export function RefreshButton(props: RefreshButtonProps): React.JSX.Element {
  const { t, onRefresh } = props
  const [phase, trigger] = useRefreshPhase(onRefresh)
  const label = t(LABELS[phase])
  return (
    <>
      <button
        type="button"
        className="mail-refresh"
        data-phase={phase}
        aria-label={label}
        aria-busy={phase === 'loading'}
        aria-disabled={phase === 'loading'}
        onClick={() => { void trigger() }}
      >
        <RefreshGlyph phase={phase} />
        <span className="mail-refresh-labels" aria-hidden="true">
          {(Object.keys(LABELS) as RefreshPhase[]).map((key) => (
            <span key={key} className={key === phase ? 'mail-refresh-label is-shown' : 'mail-refresh-label'}>
              {t(LABELS[key])}
            </span>
          ))}
        </span>
      </button>
      <span className="mail-sr-only" role="status" aria-live="polite">{label}</span>
    </>
  )
}

/**
 * Own the phase machine: ignore a click while one is running, hold the
 * spinner for its floor, report the outcome, then settle back on a timer.
 *
 * 持有阶段状态机：读取进行中忽略重复点击，指示器保持到下限时间，再上报结果并按定时器回到初始态。
 *
 * @param onRefresh - the read to run / 要执行的读取
 * @returns the current phase and the click handler / 当前阶段与点击处理函数
 */
function useRefreshPhase(onRefresh: () => Promise<MailReadOutcome>): [RefreshPhase, () => Promise<void>] {
  const [phase, setPhase] = useState<RefreshPhase>('idle')
  const busy = useRef(false)
  const timers = usePhaseTimers(setPhase)
  const trigger = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setPhase('loading')
    const startedAt = Date.now()
    try {
      const outcome = await onRefresh()
      const floor = MIN_LOADING_MS - (Date.now() - startedAt)
      if (floor > 0) await timers.sleep(floor)
      if (!timers.alive()) return
      if (outcome === 'stale') setPhase('idle')
      else timers.settle(outcome === 'ok' ? 'success' : 'error')
    } catch {
      if (timers.alive()) timers.settle('error')
    } finally {
      busy.current = false
    }
  }
  return [phase, trigger]
}

/**
 * The two waits one click needs: the loading floor and the settle-back delay.
 * Both live in one timer slot, and unmounting resolves the pending wait so the
 * async caller can observe that it is gone instead of hanging.
 *
 * 一次点击需要的两段等待：加载下限与回到初始态的延时。两者共用同一个定时器槽位；卸载时
 * 让挂起的等待立即落定，异步调用方因此能察觉自己已消失，而不是永远悬着。
 *
 * @param write - the phase setter / 阶段写入函数
 * @returns the waits and the liveness probe / 等待函数与存活性探针
 */
function usePhaseTimers(write: (phase: RefreshPhase) => void): {
  readonly sleep: (ms: number) => Promise<void>
  readonly settle: (phase: 'success' | 'error') => void
  readonly alive: () => boolean
} {
  const timer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined)
  const wake = useRef<(() => void) | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      globalThis.clearTimeout(timer.current)
      wake.current?.()
    }
  }, [])
  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
    wake.current = resolve
    timer.current = globalThis.setTimeout(resolve, ms)
  })
  const settle = (next: 'success' | 'error'): void => {
    write(next)
    globalThis.clearTimeout(timer.current)
    timer.current = globalThis.setTimeout(() => { if (mounted.current) write('idle') }, SETTLE_MS[next])
  }
  return { sleep, settle, alive: () => mounted.current }
}

/**
 * The glyph: a rotating arrow, an indeterminate spinner, a check, or an alert.
 *
 * 图标：旋转箭头、不定进度圈、对勾或警告。
 *
 * @param props - the phase the control is in / 控件所处阶段
 * @returns the glyph / 图标
 */
function RefreshGlyph(props: { readonly phase: RefreshPhase }): React.JSX.Element {
  const { phase } = props
  return (
    <span className="mail-refresh-glyph" aria-hidden="true">
      {phase === 'success' && <CheckIcon />}
      {phase === 'error' && <AlertIcon />}
      {(phase === 'idle' || phase === 'loading') && <RefreshIcon />}
    </span>
  )
}

/** A circular arrow, drawn on a 14px grid. / 圆头箭头，14px 网格。 */
function RefreshIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M11.5 7a4.5 4.5 0 1 1-1.32-3.18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M11.9 1.9v2.6H9.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A check mark. / 对勾。 */
function CheckIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.6 7.4 5.6 10.4 11.4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** An alert: a triangle with an exclamation. / 警告：带感叹号的三角。 */
function AlertIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.9 12.6 12H1.4L7 1.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.7v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.2" r="0.75" fill="currentColor" />
    </svg>
  )
}
