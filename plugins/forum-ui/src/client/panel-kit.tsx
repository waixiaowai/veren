/**
 * Shared presentation widgets of the forum page: the centered modal, the
 * up/down vote pair, the toast stack, and the inline SVG glyphs. Every view
 * module composes these instead of restating them, so one edit here reaches
 * the whole page.
 *
 * 论坛页面的共享展示组件：居中模态框、上下投票对、提示堆栈与内联 SVG 图形。
 * 各视图模块都组合这些部件而不是各自重述，因此这里改一处即达整页。
 *
 * @module @veren/forum-ui/client/panel-kit
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForumKey } from './locales.ts'

/** One transient feedback message. 一条瞬态反馈消息。 */
interface Toast {
  readonly id: number
  readonly kind: 'success' | 'error'
  readonly text: string
}

/** The bottom-right toast stack. 右下角的提示堆栈。 */
export function ToastStack(props: { readonly toasts: readonly Toast[] }) {
  return (
    <div className="forum-toasts" role="status" aria-live="polite">
      {props.toasts.map(toast => (
        <div key={toast.id} className={toast.kind === 'success' ? 'forum-toast is-success' : 'forum-toast is-error'}>
          <span className="forum-toast-icon" aria-hidden="true">
            {toast.kind === 'success' ? <CheckIcon /> : <AlertIcon />}
          </span>
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  )
}

/** Keep one toast per action, capped at three, each gone after 3.2 seconds. 每个动作一条提示，至多三条，3.2 秒后消失。 */
export function useToasts(): {
  readonly toasts: readonly Toast[]
  readonly push: (kind: 'success' | 'error', text: string) => void
} {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const sequence = useRef(0)
  const timers = useRef<number[]>([])
  const push = (kind: 'success' | 'error', text: string): void => {
    sequence.current += 1
    const id = sequence.current
    setToasts(list => [...list.slice(-2), { id, kind, text }])
    const timer = window.setTimeout(() => {
      setToasts(list => list.filter(toast => toast.id !== id))
    }, 3200)
    timers.current.push(timer)
  }
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer)
  }, [])
  return { toasts, push }
}

/** The centered dialog: mask, card, close button, and Escape/backdrop dismissal. 居中对话框：遮罩、卡片、关闭按钮与 Escape/点击遮罩关闭。 */
export function Modal(props: {
  readonly title: string
  readonly subtitle: string
  readonly closeLabel: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div
      className="forum-overlay"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="forum-modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="forum-modal-head">
          <div>
            <h2>{props.title}</h2>
            <p>{props.subtitle}</p>
          </div>
          <button type="button" className="forum-icon-btn" aria-label={props.closeLabel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {props.children}
      </div>
    </div>
  )
}

/** The up/down pair, showing the reader's own attitude and clearing it on a second click. 上下投票对，展示读者自己的态度，再次点击即收回。 */
export function VoteButtons(props: {
  readonly t: (key: ForumKey) => string
  readonly up: number
  readonly down: number
  readonly myVote: 'up' | 'down' | undefined
  readonly disabled: boolean
  readonly onVote: (value: 'up' | 'down') => void
}) {
  const { t, up, down, myVote, disabled, onVote } = props
  return (
    <div className="forum-vote-group">
      <button
        type="button" className="forum-vote" aria-pressed={myVote === 'up'} disabled={disabled}
        aria-label={t('upvote')} onClick={() => { onVote('up') }}
      ><span aria-hidden="true">↑</span> {up}</button>
      <button
        type="button" className="forum-vote" aria-pressed={myVote === 'down'} disabled={disabled}
        aria-label={t('downvote')} onClick={() => { onVote('down') }}
      ><span aria-hidden="true">↓</span> {down}</button>
    </div>
  )
}

/** Inline SVG glyphs drawn from theme tokens; every icon is decorative. 取自主题 token 的内联 SVG 图形；所有图标均为装饰性。 */
export function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg className="forum-search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg className="forum-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8H4M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v11H10l-4.5 3v-3H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4v5M8 11.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
