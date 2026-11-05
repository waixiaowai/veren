/**
 * The accounts tab: authorized accounts as cards, plus the QR bind wizard.
 *
 * 账号页签：已授权账号以卡片呈现，外加二维码绑定向导。
 *
 * @module @veren/im-ui/client/views-accounts
 */

import { useState } from 'react'
import { Avatar } from './avatar.tsx'
import { fill } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'

/** The accounts tab body. */
export function AccountsView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const [code, setCode] = useState('')
  const bind = state.bind
  return (
    <section className="im-section">
      <div className="im-hero im-hero-row">
        <div>
          <h2 className="im-display">{fill(t('headingAccounts'), { n: state.catalog.accounts.length })}</h2>
          <p className="im-hero-sub">{t('accountsHint')}</p>
        </div>
        <button type="button" className="im-button im-button-primary" onClick={actions.onStartBind}>
          {t('bindWechat')}
        </button>
      </div>
      {state.catalog.accounts.length === 0 && <p className="im-muted">{t('noAccounts')}</p>}
      <ul className="im-card-grid" role="list">
        {state.catalog.accounts.map(account => (
          <li key={account.id} className="im-card">
            <Avatar name={account.displayName} kind="human" size="lg" />
            <div className="im-card-body">
              <div className="im-name-row">
                <span className="im-strong">{account.displayName}</span>
                <span className={account.status === 'online' ? 'im-badge im-badge-on' : 'im-badge'}>
                  {account.status === 'online' ? t('statusOnline') : t('statusOffline')}
                </span>
              </div>
              <div className="im-id-mono">{account.id}</div>
              <div className="im-card-actions">
                <button
                  type="button"
                  className="im-button im-button-danger"
                  onClick={() => { if (window.confirm(t('confirmUnbindAccount'))) actions.onUnbindAccount(account.id) }}
                >
                  {t('unbindAccount')}
                </button>
              </div>
            </div>
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
  return (
    <div className="im-wizard">
      <div className="im-row im-row-split">
        <h3 className="im-heading">{t('bindTitle')}</h3>
        <button type="button" className="im-button" onClick={actions.onCloseBind}>{t('closeWizard')}</button>
      </div>
      <p className="im-muted">{t('bindScanHint')}</p>
      {bind.qrDataUrl !== undefined
        ? <img className="im-qr" src={bind.qrDataUrl} alt="WeChat QR" />
        : (bind.status === 'pending' || bind.status === 'scanned' || bind.status === 'needs-code')
          ? <p className="im-error">{t('bindQrMissing')}</p>
          : null}
      <p className={`im-bindstatus im-bindstatus-${bind.status}`}>{statusOf(bind.status, t)}</p>
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
/** 每个向导状态对应一句人话。 */
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
