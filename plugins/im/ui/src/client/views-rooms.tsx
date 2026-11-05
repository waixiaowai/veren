/**
 * The conversations tab: room list on the left, the open room on the right.
 *
 * A pure presentation component over the rooms observable; the two panes live
 * in `rooms-side.tsx` and `rooms-main.tsx`.
 *
 * 会话页：左侧房间列表，右侧打开的房间。
 *
 * 纯展示组件，由 rooms 可观察对象驱动；两个面板分别在 `rooms-side.tsx` 与
 * `rooms-main.tsx`。
 *
 * @module @veren/im-ui/client/views-rooms
 */

import type { ImKey } from './locales.ts'
import type { ImPersonView, RoomsSnapshot } from './remote.ts'
import { RoomsMain } from './rooms-main.tsx'
import { RoomsSide } from './rooms-side.tsx'

/** Props of {@link RoomsView}: the rooms snapshot plus the locale seat. */
export interface RoomsViewProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly onOpenRoom: (roomId: string | undefined) => void
  readonly onRefresh: () => void
  readonly onSend: (body: string) => Promise<boolean>
  readonly onCreateRoom: (title: string | undefined) => void
}

/** Render the two-pane rooms view. */
export function RoomsView(props: RoomsViewProps) {
  return (
    <div className="im-rooms">
      <RoomsSide
        state={props.state}
        t={props.t}
        onOpenRoom={props.onOpenRoom}
        onCreateRoom={props.onCreateRoom}
      />
      <RoomsMain
        state={props.state}
        t={props.t}
        people={props.people}
        onSend={props.onSend}
      />
    </div>
  )
}
