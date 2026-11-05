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

import { useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImKey } from './locales.ts'
import type { ImPanelInjected, ImSnapshot, RoomsSnapshot } from './remote.ts'
import { AccountsView } from './views-accounts.tsx'
import { PeopleView } from './views-people.tsx'
import { RoomsView } from './views-rooms.tsx'
import { SettingsView } from './views-settings.tsx'

/** Props of {@link ImPanel}, derived from the framework shares. */
export type ImPanelProps = PropsRuntime<'main'>
  & InjectFace<ImPanelInjected>
  & PropsLocale<'im'>
  & InjectFace<{ hooks: { rooms: HostObservable<RoomsSnapshot> } }>

/** Everything a tab view needs, with the inject face already resolved. */
export interface ImBodyProps {
  readonly state: ImSnapshot
  readonly t: (key: ImKey) => string
  readonly actions: Omit<ImPanelInjected, 'hooks'>
}

/** The tabs the panel switches between. */
type Tab = 'rooms' | 'accounts' | 'people' | 'settings'

/** Render the page shell and resolve the framework seat once. */
export function ImPanel(props: ImPanelProps) {
  const state = props.useIm((snapshot: ImSnapshot) => snapshot)
  return <ImBody state={state} t={props.t} actions={props} rooms={props} />
}

/** Extra props the conversations tab needs: its own observable plus callbacks. */
export interface ImRoomsProps {
  readonly rooms: {
    readonly useRooms: HostObservableBinder<RoomsSnapshot>
    readonly onOpenRoom: (roomId: string | undefined) => void
    readonly onRoomsRefresh: () => void
    readonly onSend: (body: string) => Promise<boolean>
    readonly onCreateRoom: (title: string | undefined) => void
  }
}

/** How the slots framework binds one observable into a hook. */
type HostObservableBinder<Value> = (bind: (snapshot: Value) => Value) => Value

/** The page body: title, refresh, error line, tab bar, and the active view. */
function ImBody(props: ImBodyProps & ImRoomsProps) {
  const { state, t, actions } = props
  const [tab, setTab] = useState<Tab>('rooms')
  return (
    <div className="im-page">
      <header className="im-head">
        <div>
          <h1 className="im-title">{t('panel')}</h1>
          <p className="im-subtitle">{t('panelSubtitle')}</p>
        </div>
        <button type="button" className="im-button" onClick={actions.onRefresh}>{t('refresh')}</button>
      </header>
      {state.status === 'error' && <p className="im-error">{t('errorPrefix')}：{state.error}</p>}
      {state.status === 'loading' && <p className="im-muted">{t('loading')}</p>}
      {state.status !== 'loading' && (
        <>
          <nav className="im-tabs" role="tablist">
            <TabButton active={tab === 'rooms'} label={t('tabRooms')} onClick={() => setTab('rooms')} />
            <TabButton active={tab === 'accounts'} label={t('tabAccounts')} onClick={() => setTab('accounts')} />
            <TabButton active={tab === 'people'} label={t('tabPeople')} onClick={() => setTab('people')} />
            <TabButton active={tab === 'settings'} label={t('tabSettings')} onClick={() => setTab('settings')} />
          </nav>
          {tab === 'rooms' && <RoomsBody {...props} />}
          {tab === 'accounts' && <AccountsView state={state} t={t} actions={actions} />}
          {tab === 'people' && <PeopleView state={state} t={t} actions={actions} />}
          {tab === 'settings' && <SettingsView state={state} t={t} actions={actions} />}
        </>
      )}
    </div>
  )
}

/** Bind the rooms observable once and render the conversations tab. */
function RoomsBody(props: ImBodyProps & ImRoomsProps) {
  const state = props.rooms.useRooms((snapshot: RoomsSnapshot) => snapshot)
  return (
    <RoomsView
      state={state}
      t={props.t}
      people={props.state.catalog.people}
      onOpenRoom={props.rooms.onOpenRoom}
      onRefresh={props.rooms.onRoomsRefresh}
      onSend={props.rooms.onSend}
      onCreateRoom={props.rooms.onCreateRoom}
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
