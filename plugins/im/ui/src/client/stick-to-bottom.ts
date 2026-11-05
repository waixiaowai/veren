/**
 * Stick-to-bottom for the timeline (design §23.3): new messages follow only
 * while the reader is already at the bottom; otherwise the page offers the
 * "jump to latest" pill instead of yanking the scroll position.
 *
 * 时间线的贴底滚动（设计 §23.3）：只有读者本就在底部时才跟随新消息；否则给出「回到最新」
 * 胶囊，而不是抢走滚动位置。
 *
 * @module @veren/im-ui/client/stick-to-bottom
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** How close to the bottom still counts as "reading the latest". */
/** 距离底部多近仍算「正在看最新」。 */
const NEAR_BOTTOM_PX = 80

/** One scroll container with pinning behaviour. */
export interface StickToBottom {
  readonly ref: RefObject<HTMLOListElement | null>
  /** Whether the reader is at (or near) the bottom. */
  readonly pinned: boolean
  /** Scroll to the newest message and resume pinning. */
  readonly jump: () => void
}

/**
 * Bind one list element to the pinning rule.
 * @param signature - a value that changes whenever new content arrives.
 * @returns the element ref, the pinned flag, and the jump callback.
 */
export function useStickToBottom(signature: string | number): StickToBottom {
  const ref = useRef<HTMLOListElement | null>(null)
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const onScroll = (): void => {
      const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
      pinnedRef.current = near
      setPinned(near)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => { element.removeEventListener('scroll', onScroll) }
  }, [])
  useLayoutEffect(() => {
    const element = ref.current
    if (element !== null && pinnedRef.current) element.scrollTop = element.scrollHeight
  }, [signature])
  const jump = useCallback(() => {
    const element = ref.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    pinnedRef.current = true
    setPinned(true)
  }, [])
  return { ref, pinned, jump }
}
