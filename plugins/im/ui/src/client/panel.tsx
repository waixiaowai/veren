/**
 * The IM panel: one shell, four tabs (conversations / accounts / people /
 * settings).
 *
 * Conversations is the entry point: the panel is the owner's view of the
 * collaboration workspace. Accounts and people are the roster and channel faces;
 * settings holds the two 2.x surfaces (intake audit, CMS cloud) that used to be
 * primary tabs.
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`.
 *
 * IM 面板：一个外壳，四个页签（会话 / 账号 / 人员 / 设置）。
 *
 * 会话是入口：面板就是所有者眼中的协作工作区。账号与人员是渠道与名册面；设置收纳 2.x 曾经
 * 作为一级页签的两个面（采集审计、CMS 云端）。
 *
 * 由可观察对象和注入面回调驱动的展示组件；只持有视图状态，不碰 `ctx`。
 *
 * @module @veren/im-ui/client/panel
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActivitySnapshot } from './activity-source.ts'
import type { ImKey } from './locales.ts'
import type { ImPanelInjected, ImSnapshot, RoomsSnapshot } from './remote.ts'
import { AccountsView } from './views-accounts.tsx'
import { AgentsView } from './views-agents.tsx'
import { PeopleView } from './views-people.tsx'
import { RoomsView } from './views-rooms.tsx'
import { SettingsView } from './views-settings.tsx'

/** Props of {@link ImPanel}, derived from the framework shares. */
export type ImPanelProps = PropsRuntime<'main'>
  & InjectFace<ImPanelInjected>
  & PropsLocale<'im'>

/** Everything a tab view needs, with the inject face already resolved. */
export interface ImBodyProps {
  readonly state: ImSnapshot
  readonly t: (key: ImKey) => string
  readonly actions: Omit<ImPanelInjected, 'hooks'>
}

/** The tabs the panel switches between. */
type Tab = 'rooms' | 'agents' | 'accounts' | 'people' | 'settings'

/** Render the page shell and resolve the framework seat once. */
export function ImPanel(props: ImPanelProps) {
  const state = props.useIm((snapshot: ImSnapshot) => snapshot)
  return <ImBody state={state} t={props.t} actions={props} rooms={props} />
}

/** The conversations tab needs its own observable plus the room callbacks. */
export interface RoomsBodyProps {
  readonly rooms: ImPanelProps
}

/** The page body: title, refresh, error line, tab bar, and the active view. */
function ImBody(props: ImBodyProps & RoomsBodyProps) {
  const { state, t, actions } = props
  const [tab, setTab] = useState<Tab>('rooms')
  return (
    <div className="im-page">
      <ImHead t={t} onRefresh={actions.onRefresh} />
      {state.status === 'error' && <p className="im-error">{t('errorPrefix')}：{state.error}</p>}
      {state.status === 'loading' && <p className="im-muted">{t('loading')}</p>}
      {state.status !== 'loading' && (
        <div className="im-body">
          <ImTabs tab={tab} setTab={setTab} t={t} />
          {tab === 'rooms' && <RoomsBody {...props} />}
          {tab !== 'rooms' && (
            <DocumentTabs
              tab={tab}
              state={state}
              t={t}
              actions={actions}
              rooms={props.rooms}
              onOpenConversation={roomId => { props.rooms.onOpenRoom(roomId); setTab('rooms') }}
              onCreateConversation={input => { props.rooms.onCreateRoom(input); setTab('rooms') }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** The page head: the title block and the refresh action. */
function ImHead(props: { readonly t: (key: ImKey) => string, readonly onRefresh: () => void }): React.JSX.Element {
  const { t } = props
  return (
    <header className="im-head">
      <div>
        <h1 className="im-title">{t('panel')}</h1>
        <p className="im-subtitle">{t('panelSubtitle')}</p>
      </div>
      <div className="im-head-actions">
        <button type="button" className="im-button" onClick={props.onRefresh}>{t('refresh')}</button>
      </div>
    </header>
  )
}

/** The tab bar: the five top-level views. */
function ImTabs(props: {
  readonly tab: Tab
  readonly setTab: (tab: Tab) => void
  readonly t: (key: ImKey) => string
}): React.JSX.Element {
  const { tab, setTab, t } = props
  return (
    <nav className="im-tabs" role="tablist">
      <TabButton active={tab === 'rooms'} label={t('tabRooms')} onClick={() => setTab('rooms')} />
      <TabButton active={tab === 'agents'} label={t('tabAgents')} onClick={() => setTab('agents')} />
      <TabButton active={tab === 'accounts'} label={t('tabAccounts')} onClick={() => setTab('accounts')} />
      <TabButton active={tab === 'people'} label={t('tabPeople')} onClick={() => setTab('people')} />
      <TabButton active={tab === 'settings'} label={t('tabSettings')} onClick={() => setTab('settings')} />
    </nav>
  )
}

/**
 * The document tabs: one scroll column under the pinned tab bar.
 *
 * Only the conversation tab owns a full-height layout of its own, so the other
 * four share a single region that scrolls. `key` makes each tab its own
 * document: switching starts the next tab at the top instead of inheriting the
 * previous tab's scroll offset.
 *
 * 文档页签：固定页签条之下的一个滚动列。
 *
 * 只有会话页签需要自己的全高布局，其余四个共用一个滚动区。`key` 让每个页签是自己的文档：
 * 切换后从顶部开始，而不是继承上一个页签的滚动位置。
 */
function DocumentTabs(props: ImBodyProps & RoomsBodyProps & {
  readonly tab: Exclude<Tab, 'rooms'>
  readonly onOpenConversation: (roomId: string) => void
  readonly onCreateConversation: (input: {
    readonly title?: string
    readonly kind: 'direct'
    readonly memberIds: readonly string[]
  }) => void
}): React.JSX.Element {
  const { tab, state, t, actions } = props
  return (
    <div className="im-view" key={tab}>
      {tab === 'agents' && (
        <AgentsBody
          state={state}
          t={t}
          actions={actions}
          rooms={props.rooms}
          onOpenConversation={props.onOpenConversation}
          onCreateConversation={props.onCreateConversation}
        />
      )}
      {tab === 'accounts' && <AccountsView state={state} t={t} actions={actions} />}
      {tab === 'people' && <PeopleView state={state} t={t} actions={actions} />}
      {tab === 'settings' && <SettingsView state={state} t={t} actions={actions} />}
    </div>
  )
}

/** Bind the conversations observable once and render the conversations tab. */
function RoomsBody(props: ImBodyProps & RoomsBodyProps) {
  const state = props.rooms.useRooms((snapshot: RoomsSnapshot) => snapshot)
  // 实时回合只在这里绑定：工作行跟着打开的房间走，其他页签不需要它。
  // Live turns bind only here: the working row follows the open room, and no
  // other tab needs it.
  const activity = props.rooms.useActivity((snapshot: ActivitySnapshot) => snapshot)
  // 最后一个回合落定时立刻重读时间线：工作行消失与回复上屏之间不该隔着下一轮五秒轮询。
  // Re-read the timeline the moment the last turn settles: the working row's
  // exit and its reply must not be separated by the next five-second poll.
  const previousRuns = useRef(0)
  useEffect(() => {
    if (previousRuns.current > 0 && activity.runs.length === 0) props.rooms.onRoomsRefresh()
    previousRuns.current = activity.runs.length
  }, [activity.runs.length, props.rooms])
  return (
    <RoomsView
      state={state}
      t={props.t}
      people={props.state.catalog.people}
      participants={props.state.participants}
      activities={activity.runs}
      onOpenRoom={props.rooms.onOpenRoom}
      onRefresh={props.rooms.onRoomsRefresh}
      onSend={props.rooms.onSendMessage}
      onCreateRoom={props.rooms.onCreateRoom}
      onInvite={props.rooms.onInviteMembers}
    />
  )
}

/** Bind the same observable for the roster, and hand room actions back up. */
function AgentsBody(props: ImBodyProps & RoomsBodyProps & {
  readonly onOpenConversation: (roomId: string) => void
  readonly onCreateConversation: (input: { readonly kind: 'direct'; readonly memberIds: readonly string[] }) => void
}) {
  const state = props.rooms.useRooms((snapshot: RoomsSnapshot) => snapshot)
  return (
    <AgentsView
      state={props.state}
      t={props.t}
      actions={props}
      rooms={state.rooms}
      participants={props.state.participants}
      unread={state.unread.reduce((total, count) => total + count.unread, 0)}
      onOpenRoom={props.onOpenConversation}
      onCreateRoom={props.onCreateConversation}
    />
  )
}

/** One tab button. */
function TabButton(props: { readonly active: boolean; readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      className={props.active ? 'im-tab im-tab-active' : 'im-tab'}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}
