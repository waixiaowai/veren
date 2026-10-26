/**
 * The accounts tab: the authorized list plus the QR bind wizard.
 *
 * The wizard is fully view-side stateless: the observable's `bind` field is the
 * whole state machine (pending/scanned/needs-code/bound/expired/failed), the
 * QR arrives as a data URL, and the poll loop runs in the source while the
 * panel has subscribers.
 *
 * 账号页签：已授权列表与二维码绑定向导。
 *
 * 向导刻意无组件态：可观察对象的 `bind` 字段就是整个状态机
 * （pending/scanned/needs-code/bound/expired/failed），二维码以 data URL 到达，
 * 轮询循环在源里随订阅运行。
 *
 * @module @veren/im-ui/client/views-accounts
 */

import { useState } from 'react'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'

/** The accounts tab body. */
export function AccountsView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const [code, setCode] = useState('')
  const bind = state.bind
  return (
    <section className="im-section">
      <div className="im-row">
        <h2 className="im-heading">{t('accounts')}</h2>
        <button type="button" className="im-button im-button-primary" onClick={actions.onStartBind}>
          {t('bindWechat')}
        </button>
      </div>
      {state.catalog.accounts.length === 0 && <p className="im-muted">{t('noAccounts')}</p>}
      <ul className="im-list">
        {state.catalog.accounts.map(account => (
          <li key={account.id} className="im-item">
            <span className="im-strong">{account.displayName}</span>
            <span className="im-muted">{account.id}</span>
            <span className="im-badge">{account.provider}</span>
            <span className={account.status === 'online' ? 'im-status im-status-online' : 'im-status'}>
              {account.status === 'online' ? t('statusOnline') : t('statusOffline')}
            </span>
            <button
              type="button"
              className="im-button im-button-danger"
              onClick={() => { if (window.confirm(t('confirmUnbindAccount'))) actions.onUnbindAccount(account.id) }}
            >
              {t('unbindAccount')}
            </button>
          </li>
        ))}
      </ul>
      {bind !== undefined && <BindWizard bind={bind} t={t} actions={actions} code={code} setCode={setCode} />}
    </section>
  )
}

/** The bind wizard card: QR, live status, optional verify-code input. */
function BindWizard(props: {
  readonly bind: NonNullable<ImBodyProps['state']['bind']>
  readonly t: (key: ImKey) => string
  readonly actions: ImBodyProps['actions']
  readonly code: string
  readonly setCode: (code: string) => void
}): React.JSX.Element {
  const { bind, t, actions } = props
  const statusText = statusOf(bind.status, t)
  return (
    <div className="im-wizard">
      <div className="im-row">
        <h3 className="im-heading">{t('bindTitle')}</h3>
        <button type="button" className="im-button" onClick={actions.onCloseBind}>{t('closeWizard')}</button>
      </div>
      <p className="im-muted">{t('bindScanHint')}</p>
      {bind.qrDataUrl !== undefined
        ? <img className="im-qr" src={bind.qrDataUrl} alt="WeChat QR" />
        : <p className="im-error">{t('bindQrMissing')}</p>}
      <p className={`im-bindstatus im-bindstatus-${bind.status}`}>{statusText}</p>
      {bind.status === 'needs-code' && (
        <div className="im-row">
          <input
            type="text"
            className="im-input"
            placeholder={t('codePlaceholder')}
            value={props.code}
            onChange={event => props.setCode(event.target.value)}
          />
          <button
            type="button"
            className="im-button im-button-primary"
            disabled={props.code.trim() === ''}
            onClick={() => actions.onSubmitCode(props.code.trim())}
          >
            {t('submitCode')}
          </button>
        </div>
      )}
      {bind.error !== undefined && <p className="im-error">{bind.error.message}</p>}
    </div>
  )
}

/** One human line per wizard status. */
function statusOf(status: string, t: (key: ImKey) => string): string {
  switch (status) {
    case 'pending': return t('bindPending')
    case 'scanned': return t('bindScanned')
    case 'needs-code': return t('bindNeedsCode')
    case 'bound': return t('bindBound')
    case 'expired': return t('bindExpired')
    default: return t('bindFailed')
  }
}
