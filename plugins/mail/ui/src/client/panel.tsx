/**
 * The mail panel: one shell, two tabs (inbox / activity).
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`.
 *
 * 通知面板：一个外壳，两个页签（收件箱 / 执行记录）。
 *
 * 由可观察对象和注入面回调驱动的展示组件；它只持有视图状态，不碰 `ctx`。
 *
 * @module @veren/mail-ui/client/panel
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MailKey } from './locales.ts'
import type { MailPanelInjected, MailSnapshot, MessageView, RunView } from './remote.ts'

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
  const snapshot = props.useMail((current: MailSnapshot) => current)
  return <MailBody snapshot={snapshot} t={props.t} actions={props} />
}

/**
 * The page body: title, refresh, error line, tab bar, and the active view.
 *
 * 页面主体：标题、刷新、错误行、页签栏与当前视图。
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
        <button type="button" className="mail-button" onClick={actions.onRefresh}>{t('refresh')}</button>
      </header>
      {snapshot.status === 'error' && <p className="mail-error">{t('errorPrefix')}：{snapshot.error}</p>}
      {snapshot.status === 'loading' && <p className="mail-muted">{t('loading')}</p>}
      {snapshot.status !== 'loading' && (
        <>
          <nav className="mail-tabs" role="tablist">
            <TabButton active={tab === 'inbox'} label={t('tabInbox')} onClick={() => setTab('inbox')} />
            <TabButton active={tab === 'activity'} label={t('tabActivity')} onClick={() => setTab('activity')} />
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
 * One tab button.
 *
 * 一个页签按钮。
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

/**
 * The inbox: what reached the station inbox, with the visible-state actions.
 *
 * 收件箱：抵达站内收件箱的内容，附带可见状态操作。
 *
 * @param props - the view's props / 视图属性
 * @returns the view / 视图
 */
function InboxView(props: {
  readonly messages: readonly MessageView[]
  readonly t: (key: MailKey) => string
  readonly actions: Omit<MailPanelInjected, 'hooks'>
}): React.JSX.Element {
  const { messages, t, actions } = props
  if (messages.length === 0) return <p className="mail-muted">{t('inboxEmpty')}</p>
  return (
    <ul className="mail-list">
      {messages.map((message) => (
        <MessageRow key={message.messageId} message={message} t={t} onMark={actions.onMark} />
      ))}
    </ul>
  )
}

/**
 * One inbox message with its state and its actions.
 *
 * 一条收件箱消息，带其状态与操作。
 *
 * @param props - the row's props / 行属性
 * @returns the row / 行
 */
function MessageRow(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
  readonly onMark: (messageId: string, action: 'read' | 'unread' | 'archive' | 'unarchive') => void
}): React.JSX.Element {
  const { message, t, onMark } = props
  return (
    <li className="mail-item">
      <div className="mail-item-head">
        <span className="mail-item-recipient">{message.subscriberId}</span>
        <span className="mail-item-state">{stateLabel(message, t)}</span>
      </div>
      {message.subject !== undefined && <p className="mail-item-subject">{message.subject}</p>}
      <p className="mail-item-content">{message.content}</p>
      <div className="mail-item-actions">
        <button
          type="button"
          className="mail-link"
          onClick={() => onMark(message.messageId, message.read ? 'unread' : 'read')}
        >
          {message.read ? t('markUnread') : t('markRead')}
        </button>
        <button
          type="button"
          className="mail-link"
          onClick={() => onMark(message.messageId, message.archived ? 'unarchive' : 'archive')}
        >
          {message.archived ? t('unarchive') : t('archive')}
        </button>
      </div>
    </li>
  )
}

/**
 * The activity view: one row per execution chain, with its steps.
 *
 * 执行记录视图：每条执行链一行，附带其步骤。
 *
 * @param props - the view's props / 视图属性
 * @returns the view / 视图
 */
function ActivityView(props: {
  readonly runs: readonly RunView[]
  readonly t: (key: MailKey) => string
}): React.JSX.Element {
  const { runs, t } = props
  if (runs.length === 0) return <p className="mail-muted">{t('activityEmpty')}</p>
  return (
    <ul className="mail-list">
      {runs.map((run) => (
        <li key={run.runId} className="mail-item">
          <div className="mail-item-head">
            <span className="mail-item-recipient">{run.workflowName}</span>
            <span className="mail-item-state">{chainLabel(run, t)}</span>
          </div>
          <ol className="mail-steps">
            {run.steps.map((step) => (
              <li key={step.jobId} className="mail-step">
                <span className="mail-step-name">{step.stepId}</span>
                <span className="mail-step-state">{step.state}</span>
                {step.skipReason !== undefined && (
                  <span className="mail-step-reason">{t('skipReason')}: {step.skipReason}</span>
                )}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  )
}

/**
 * The label one message's visible state gets.
 *
 * 一条消息的可见状态所对应的标签。
 *
 * @param message - the message / 消息
 * @param t - the localized copy / 本地化文案
 * @returns the label / 标签
 */
function stateLabel(message: MessageView, t: (key: MailKey) => string): string {
  if (message.archived) return t('archived')
  return message.read ? t('read') : t('unread')
}

/**
 * The label one execution chain's outcome gets.
 *
 * 一条执行链的结果所对应的标签。
 *
 * @param run - the execution chain / 执行链
 * @param t - the localized copy / 本地化文案
 * @returns the label / 标签
 */
function chainLabel(run: RunView, t: (key: MailKey) => string): string {
  if (run.status === 'errored') return t('erroredChain')
  if (run.status === 'skipped') return t('skippedChain')
  return t('deliveredChain')
}
