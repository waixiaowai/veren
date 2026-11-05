/**
 * The accounts tab: authorized accounts as contact cards, plus the QR bind
 * wizard.
 *
 * Restored with the conversations surface: without it the panel can neither
 * show which channel is bound nor start a bind, which is exactly why an
 * unbound host looked dead.
 *
 * 账号页签：已授权账号以名片呈现，外加二维码绑定向导。
 *
 * 与会话面一起恢复：没有它，面板既看不到绑定的是哪个渠道，也无法发起绑定——正是未绑定
 * 宿主看起来「完全不能用」的原因。
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
      <div className="im-row im-row-split">
        <h2 className="im-heading">{t('accounts')}</h2>
        <button type="button" className="im-button im-button-primary" onClick={actions.onStartBind}>
          {t('bindWechat')}
        </button>
      </div>
      {state.catalog.accounts.length === 0 && <p className="im-muted">{t('noAccounts')}</p>}
      <ul className="im-list">
        {state.catalog.accounts.map(account => (
          <li key={account.id} className="im-card">
            <span className="im-avatar">{initialOf(account.displayName)}</span>
            <div className="im-card-body">
              <div className="im-name-row">
                <span className="im-strong">{account.displayName}</span>
                <span className={account.status === 'online' ? 'im-badge im-badge-on' : 'im-badge'}>
                  {account.status === 'online' ? t('statusOnline') : t('statusOffline')}
                </span>
                <button
                  type="button"
                  className="im-button im-button-danger"
                  onClick={() => { if (window.confirm(t('confirmUnbindAccount'))) actions.onUnbindAccount(account.id) }}
                >
                  {t('unbindAccount')}
                </button>
              </div>
              <div className="im-id-mono">{account.id}</div>
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

/** The avatar's single character. */
function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
