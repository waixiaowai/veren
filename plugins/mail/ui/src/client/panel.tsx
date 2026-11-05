/**
 * The mail panel: one shell, two tabs (inbox / activity).
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`. The shell
 * declares all four list states (loading / empty / error / data) up front —
 * shipping only "has data" is an unfinished panel.
 *
 * 通知面板：一个外壳，两个页签（收件箱 / 执行记录）。
 *
 * 由可观察对象和注入面回调驱动的展示组件；它只持有视图状态，不碰 `ctx`。外壳 upfront 声明
 * 列表四态（加载 / 空 / 失败 / 有数据）——只实现「有数据」的面板是未完成的面板。
 *
 * @module @veren/mail-ui/client/panel
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ActivityView } from './activity.tsx'
import { InboxView } from './inbox.tsx'
import type { MailKey } from './locales.ts'
import type { MailPanelInjected, MailSnapshot } from './remote.ts'

/** Props of {@link MailPanel}, derived from the framework shares. */
export type MailPanelProps = PropsRuntime<'main'>
  & InjectFace<MailPanelInjected>
  & PropsLocale<'mail-ui'>

/** Everything a tab view needs, with the inject face already resolved. */
export interface MailBodyProps {
  /** The current snapshot. / 当前快照。 */
  readonly snapshot: MailSnapshot
  /** The localized copy. / 本地化文案。 */
  readonly t: (key: MailKey) => string
  /** The panel's callbacks. / 面板回调。 */
  readonly actions: Omit<MailPanelInjected, 'hooks'>
}

/** The tabs the panel switches between. */
type Tab = 'inbox' | 'activity'

/**
 * Render the page shell and resolve the framework seat once.
 *
 * 渲染页面外壳并解析一次框架座位。
 *
 * @param props - the derived framework shares / 派生的框架共享面
 * @returns the panel / 面板
 */
export function MailPanel(props: MailPanelProps) {
  console.log('[mail-diag] MailPanel rendering')
  const snapshot = props.useMail((current: MailSnapshot) => current)
  return <MailBody snapshot={snapshot} t={props.t} actions={props} />
}

/**
 * The page body: header with the primary action top-right, the error banner,
 * the tab bar, and the active view.
 *
 * 页面主体：主操作固定右上的页头、错误横幅、页签栏与当前视图。
 *
 * @param props - the body's props / 主体属性
 * @returns the body / 主体
 */
function MailBody(props: MailBodyProps) {
  const { snapshot, t, actions } = props
  const [tab, setTab] = useState<Tab>('inbox')
  return (
    <div className="mail-page">
      <header className="mail-head">
        <div>
          <h1 className="mail-title">{t('panel')}</h1>
          <p className="mail-subtitle">{t('panelSubtitle')}</p>
        </div>
        <button type="button" className="mail-refresh" onClick={actions.onRefresh}>{t('refresh')}</button>
      </header>
      {snapshot.status === 'error' && (
        <p className="mail-error" role="alert">{t('errorPrefix')}：{snapshot.error}</p>
      )}
      {snapshot.status === 'loading' && <p className="mail-muted">{t('loading')}</p>}
      {snapshot.status !== 'loading' && (
        <>
          <nav className="mail-tabs" role="tablist" aria-label={t('panel')}>
            <TabButton active={tab === 'inbox'} label={t('tabInbox')} onClick={() => { setTab('inbox') }} />
            <TabButton active={tab === 'activity'} label={t('tabActivity')} onClick={() => { setTab('activity') }} />
          </nav>
          {tab === 'inbox'
            ? <InboxView messages={snapshot.messages} t={t} actions={actions} />
            : <ActivityView runs={snapshot.runs} t={t} />}
        </>
      )}
    </div>
  )
}

/**
 * One tab button: an underline indicator plus a weight shift, never color
 * alone.
 *
 * 一个页签按钮：下划线指示条加字重变化，绝不只用颜色。
 *
 * @param props - the button's props / 按钮属性
 * @returns the button / 按钮
 */
function TabButton(props: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      className={props.active ? 'mail-tab mail-tab-active' : 'mail-tab'}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}
