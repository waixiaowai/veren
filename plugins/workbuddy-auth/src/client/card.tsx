/**
 * 设置 → 模型 页脚的 WorkBuddy 登录/账号卡片。组件只吃框架派生 props（铁律
 * 八/十）；三态状态机（未登录 / 登录中 / 已登录-账号表）；探测控件**双确认**
 * 后才调用（消耗真实积分，确认态与模型草稿都是行内局部状态）。
 * The WorkBuddy sign-in/account card in the Models settings footer.
 * Framework-derived props only (iron laws eight/ten); a three-state machine
 * (signed out / in flight / signed in with the account table); the probe
 * control calls only after a **double confirm** (it consumes real credits; the
 * confirm state and model draft are row-local state).
 *
 * @module @veren/workbuddy-auth/client/card
 */
import { useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { humanizeSignInError, type WbKey } from './locales.ts'
import type { WbAccount, WbCredits, WbDescribe, WbPoll, WbProbeOutcome } from './remote.ts'

/** owner site 注入面。The owner-site inject face. */
export interface WbCardInjected {
  hooks: {
    wb: HostObservable<WbCardSnapshot>
  }
  onStart: (method: string) => void
  onAttach: () => void
  onCancel: () => void
  onDismiss: () => void
  /** 动作面走完整 uid（describe 出的 uid 是截断显示形）。Actions take the full uid (describe's is the truncated display form). */
  onSignOut: (uid: string) => void
  onToggle: (uid: string, disabled: boolean) => void
  onCredits: (uid: string) => void
  onProbe: (uid: string, model: string) => void
}

/** 卡片的合成状态。The card's composed snapshot. */
export interface WbCardSnapshot {
  readonly describe: WbDescribe | undefined
  readonly poll: WbPoll | undefined
  readonly error: string
  readonly errorCode: string | undefined
  readonly credits: Readonly<Record<string, WbCredits | 'pending' | 'error'>>
  readonly probe: Readonly<Record<string, WbProbeOutcome | 'running'>>
}

/** Props of {@link WorkbuddyCard}, derived from the framework shares. */
export type WbCardProps = PropsRuntime<'settings.models.footer'>
  & InjectFace<WbCardInjected>
  & PropsLocale<'workbuddy-auth'>

/** 卡片本体。The card body. */
export function WorkbuddyCard(props: WbCardProps) {
  const snapshot = props.useWb((state: WbCardSnapshot) => state)
  const t = props.t
  const describe = snapshot.describe
  const poll = snapshot.poll
  const inFlight = poll?.inFlight === true
  const settled = poll?.settled
  const failed = poll?.failed
  const signedIn = describe?.signedIn === true
  const accounts = describe?.accounts ?? []

  return (
    <section className="wb-card" data-state={inFlight ? 'in-flight' : signedIn ? 'signed-in' : 'signed-out'}>
      <header className="wb-head">
        <div className="wb-identity">
          <span className="wb-name">{describe?.label ?? 'WorkBuddy'}</span>
          <span className={inFlight ? 'wb-status' : signedIn ? 'wb-status wb-status-ok' : 'wb-status'}>
            {inFlight ? t('signingIn') : signedIn ? t('signedIn') : t('notSignedIn')}
          </span>
        </div>
        <div className="wb-actions">
          {inFlight && <button type="button" className="wb-button" onClick={() => props.onCancel()}>{t('cancel')}</button>}
          {!inFlight && signedIn && <button type="button" className="wb-button" onClick={() => props.onStart('device-code-cn')}>{t('reSignIn')}</button>}
        </div>
      </header>
      {snapshot.errorCode === 'TRANSPORT' && (
        <p className="wb-error">{t('transportDown')} <button type="button" className="wb-link" onClick={() => props.onAttach()}>{t('retry')}</button></p>
      )}
      {failed !== undefined && !inFlight && (
        <p className="wb-error">{humanizeSignInError(failed.code, failed.message, t) ?? `${t('failed')}：${failed.message}`}</p>
      )}
      {settled !== undefined && (
        <p className={settled.status === 'authorized' ? 'wb-settle wb-settle-ok' : 'wb-settle'}>
          {settled.status === 'authorized' ? t('authorizedDone') : t('cancelledDone')}
          {' '}
          <button type="button" className="wb-link" onClick={() => props.onDismiss()}>{t('close')}</button>
        </p>
      )}
      {!inFlight && settled === undefined && !signedIn && (
        <div className="wb-methods">
          <button type="button" className="wb-button wb-primary" onClick={() => props.onStart('device-code-cn')}>{t('signInCn')}</button>
          <button type="button" className="wb-button wb-primary" onClick={() => props.onStart('device-code-global')}>{t('signInGlobal')}</button>
        </div>
      )}
      {inFlight && (
        <div className="wb-flight">
          {(poll?.notices ?? []).map((notice, index) => (
            <p className="wb-notice" key={index}>
              {notice.message}
              {notice.url !== undefined && <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>}
            </p>
          ))}
        </div>
      )}
      {signedIn && accounts.length > 0 && (
        <div className="wb-accounts">
          <span className="wb-accounts-title">{t('accountsTitle')}</span>
          {accounts.map(account => (
            <AccountRow key={account.uid} account={account} t={t} {...props} />
          ))}
        </div>
      )}
    </section>
  )
}

/** 一行账号：状态徽标 + 动作面（探测双确认与模型草稿是行内局部状态）。 */
/** One account row: status badges plus actions (the probe double-confirm and model draft are row-local state). */
function AccountRow(props: WbCardProps & { account: WbAccount; t: (key: WbKey) => string }) {
  const { account, t, ...actions } = props
  const snapshot = actions.useWb((state: WbCardSnapshot) => state)
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const [modelDraft, setModelDraft] = useState('')
  const credits = snapshot.credits[account.uid]
  const probe = snapshot.probe[account.uid]
  const startProbe = (): void => {
    if (confirm === 0) { setConfirm(1); return }
    if (confirm === 1) { setConfirm(2); return }
    setConfirm(0)
    actions.onProbe(account.uid, modelDraft.trim())
  }
  return (
    <div className="wb-account" data-region={account.region}>
      <div className="wb-account-line">
        <span className="wb-account-name">{account.name}</span>
        <span className="wb-tag">{account.region === 'global' ? t('regionGlobal') : t('regionCn')}</span>
        {account.enterprise && <span className="wb-tag">{t('enterpriseTag')}</span>}
        {account.disabled && <span className="wb-tag wb-tag-warn">{t('disabledTag')}</span>}
        {account.expired && !account.disabled && <span className="wb-tag wb-tag-warn">{t('expiredTag')}</span>}
        {account.cooldownRemainMs > 0 && <span className="wb-tag wb-tag-warn">{`${t('cooldownTag')} ${Math.ceil(account.cooldownRemainMs / 60_000)}min`}</span>}
      </div>
      <div className="wb-account-actions">
        {credits === 'pending' && <span className="wb-status">{t('creditsPending')}</span>}
        {credits !== undefined && credits !== 'pending' && credits !== 'error' && (
          <span className="wb-status">
            {credits.unlimited === true
              ? t('creditsUnlimited')
              : `${t('credits')} ${String(credits.total)}${credits.cycleResetTime === undefined ? '' : ` · ${credits.cycleResetTime}`}`}
          </span>
        )}
        <button type="button" className="wb-link" onClick={() => actions.onCredits(account.uid)}>{t('credits')}</button>
        <button type="button" className="wb-link" onClick={() => actions.onToggle(account.uid, !account.disabled)}>
          {account.disabled ? t('toggleEnable') : t('toggleDisable')}
        </button>
        <button type="button" className="wb-link" onClick={() => actions.onSignOut(account.uid)}>{t('signOut')}</button>
      </div>
      <div className="wb-probe">
        <input
          className="wb-probe-model"
          type="text"
          placeholder="model id"
          value={modelDraft}
          onChange={event => setModelDraft(event.target.value)}
        />
        <button type="button" className="wb-button" disabled={probe === 'running' || modelDraft.trim() === ''} onClick={startProbe}>
          {probe === 'running' ? t('probeRunning') : confirm === 0 ? t('probe') : confirm === 1 ? t('probeConfirmTitle') : t('probeConfirmAgain')}
        </button>
        {probe !== undefined && probe !== 'running' && (
          <span className="wb-status">
            {probe.validation === 'validating' ? `${t('probeValidating')}: ${probe.efforts.join(', ') || '—'}`
              : probe.validation === 'non-validating' ? t('probeNonValidating')
              : `${t('probeUnknown')}${probe.reason === undefined ? '' : ` (${probe.reason})`}`}
          </span>
        )}
      </div>
    </div>
  )
}
