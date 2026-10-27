/**
 * The IM panel: one shell, four tabs (accounts / conversations / people / intake).
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`.
 *
 * IM 面板：一个外壳，四个页签（账号 / 绑定 / 人员 / 采集）。
 *
 * 由可观察对象和注入面回调驱动的展示组件；只持有视图状态，不碰 `ctx`。
 *
 * @module @veren/im-ui/client/panel
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImKey } from './locales.ts'
import type { ImPanelInjected, ImSnapshot } from './remote.ts'
import { IntakeView } from './views-intake.tsx'
import { CloudView } from './views-cloud.tsx'

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
type Tab = 'intake' | 'cloud'

/** Render the page shell and resolve the framework seat once. */
export function ImPanel(props: ImPanelProps) {
  const state = props.useIm((snapshot: ImSnapshot) => snapshot)
  return <ImBody state={state} t={props.t} actions={props} />
}

/** The page body: title, refresh, error line, tab bar, and the active view. */
function ImBody(props: ImBodyProps) {
  const { state, t, actions } = props
  const [tab, setTab] = useState<Tab>('cloud')
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
            <TabButton active={tab === 'cloud'} label={t('tabCloud')} onClick={() => setTab('cloud')} />
            <TabButton active={tab === 'intake'} label={t('tabIntake')} onClick={() => setTab('intake')} />
          </nav>
          {tab === 'cloud' && <CloudView t={key => t(key as ImKey)} />}
          {tab === 'intake' && <IntakeView state={state} t={t} actions={actions} />}
        </>
      )}
    </div>
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
