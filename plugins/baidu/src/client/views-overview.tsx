/**
 * 概览页签（设计 §12.1/§12.9/§12.10 + §13.2.1/§13.2.2/§13.2.11）：登录状态卡
 * （匿名时是登录引导向导）与容量卡。业务组件——把接口返回映射到复合组件，
 * 覆盖四态与提交中；登录与注销互斥，注销立即清空账号与到期。
 * The overview tab (design §12.1/§12.9/§12.10 + §13.2.1/§13.2.2/§13.2.11):
 * the auth-status card (the sign-in guide wizard while anonymous) and the
 * quota card. Business components — mapping the endpoints onto composites,
 * covering the four states plus pending submits; sign-in and sign-out are
 * mutually exclusive, and signing out clears account/expiry at once.
 *
 * @module @veren/baidu-pan/client/views-overview
 */

import { useState } from 'react'
import type { JSX } from 'react'
import { ErrorBlock, HintBar, KeyValueRow, ProgressBar, SectionHeading, StatusLabel } from './components.tsx'
import { formatBytes, formatIso } from './format.ts'
import type { BaiduKey } from './locales.ts'
import type { BaiduBodyProps, ViewFailure } from './panel.tsx'
import type { BaiduSnapshot } from './source.ts'
import type { SignInStartView } from './remote.ts'

/** 登录向导的本地视图状态（草稿与提交中——交互状态留在组件，不进快照）。The sign-in wizard's local view state (drafts and pending submits — interaction state stays in the component, never the snapshot). */
interface SignInWizard {
  readonly active: boolean
  readonly start: SignInStartView | undefined
  readonly code: string
  readonly submitting: boolean
  readonly failure: ViewFailure | undefined
}

/** 空向导。The empty wizard. */
function emptyWizard(): SignInWizard {
  return { active: false, start: undefined, code: '', submitting: false, failure: undefined }
}

/** 会员类型 → 文案键（闭集内映射，不拼模板串）。Membership → copy key (a closed mapping, no template strings). */
function vipKey(vipType: number | undefined): BaiduKey {
  if (vipType === 2) return 'vip2'
  if (vipType === 1) return 'vip1'
  return 'vip0'
}

/** 概览页签：登录状态 + 容量。The overview tab: auth state + quota. */
export function OverviewView(props: BaiduBodyProps): JSX.Element {
  const { state, t, actions } = props
  const [wizard, setWizard] = useState<SignInWizard>(emptyWizard)
  const begin = async (): Promise<void> => {
    setWizard({ ...emptyWizard(), active: true, submitting: true })
    const result = await actions.onBeginSignIn()
    setWizard(current => ({
      ...current, submitting: false,
      start: result.ok ? result.value : undefined,
      failure: result.ok ? undefined : result.failure,
    }))
  }
  const submit = async (): Promise<void> => {
    setWizard(current => ({ ...current, submitting: true, failure: undefined }))
    const result = await actions.onSubmitSignInCode(wizard.code)
    if (result.ok) {
      setWizard(emptyWizard())
      return
    }
    setWizard(current => ({ ...current, submitting: false, failure: result.failure }))
  }
  const anonymous = state.auth?.authorized !== true
  return (
    <div className="bdp-overview">
      {anonymous
        ? <AuthGuideCard wizard={wizard} t={t} onBegin={() => { void begin() }} onSubmit={() => { void submit() }}
          onCodeChange={code => { setWizard(current => ({ ...current, code })) }} onCancel={() => { setWizard(emptyWizard()) }} />
        : <AuthStatusCard state={state} t={t} onSignOut={() => { void actions.onSignOut() }} />}
      <QuotaCard state={state} t={t} onRefresh={actions.onRefreshOverview} />
    </div>
  )
}

/** 登录引导卡（§11.5）：须知 → 授权链接 → 粘贴授权码；失败先讲原因再给重试。The sign-in guide card (§11.5): notice → authorize link → paste the code; failures explain before offering a retry. */
function AuthGuideCard(props: {
  readonly wizard: SignInWizard
  readonly t: (key: BaiduKey) => string
  readonly onBegin: () => void
  readonly onSubmit: () => void
  readonly onCodeChange: (code: string) => void
  readonly onCancel: () => void
}): JSX.Element {
  const t = props.t
  return (
    <section className="bdp-card">
      <div className="bdp-card-head">
        <StatusLabel tone="brand" text={t('signInGuideTitle')} />
      </div>
      <div className="bdp-card-body">
        <HintBar text={t('signInNotice')} />
        {props.wizard.start === undefined
          ? <button type="button" className="bdp-button bdp-button-primary" disabled={props.wizard.submitting} onClick={props.onBegin}>{t('signInAction')}</button>
          : (
            <>
              <p className="bdp-form-label">{t('signInStepOpen')}</p>
              <div className="bdp-card-link">
                <a className="bdp-link" href={props.wizard.start.url} target="_blank" rel="noreferrer noopener">{t('signInOpenAuthorize')}</a>
              </div>
              <p className="bdp-form-label">{t('signInStepPaste')}</p>
              <div className="bdp-form-row">
                <input className="bdp-input" type="password" autoComplete="off" placeholder={t('signInCodePlaceholder')}
                  value={props.wizard.code} onChange={event => { props.onCodeChange(event.target.value) }} />
                <button type="button" className="bdp-button bdp-button-primary" disabled={props.wizard.submitting || props.wizard.code.trim().length === 0}
                  onClick={props.onSubmit}>
                  {props.wizard.submitting ? t('signInSubmitting') : t('signInSubmit')}
                </button>
                <button type="button" className="bdp-button" onClick={props.onCancel}>{t('cancel')}</button>
              </div>
            </>
          )}
        {props.wizard.failure === undefined
          ? null
          : <ErrorBlock title={t('errorTitle')} reason={props.wizard.failure.message} code={props.wizard.failure.code}
            retryable={props.wizard.failure.retryable} retryLabel={t('retry')} onRetry={props.onBegin} />}
      </div>
    </section>
  )
}

/** 卡片级入参（比页签入参窄：只读快照与文案）。The card-level inputs (narrower than the tab's: snapshot and copy only). */
interface CardProps {
  readonly state: BaiduSnapshot
  readonly t: (key: BaiduKey) => string
}

/** 登录状态卡（§12.1）：账号、有效期、会员类型 + 退出登录。The auth-status card (§12.1): account, expiry, membership + sign out. */
function AuthStatusCard(props: CardProps & { readonly onSignOut: () => void }): JSX.Element {
  const { state, t } = props
  const auth = state.auth
  if (auth === undefined) return <ErrorBlock title={t('loading')} />
  const expiring = auth.expiring
  return (
    <section className="bdp-card">
      <div className="bdp-card-head">
        <StatusLabel tone={expiring ? 'warning' : 'success'} text={expiring ? t('authExpiring') : t('authSignedIn')} />
        <button type="button" className="bdp-button" onClick={props.onSignOut}>{t('signOutAction')}</button>
      </div>
      <div className="bdp-card-body">
        <KeyValueRow label={t('accountLabel')} value={state.profile?.displayName ?? '—'} />
        <KeyValueRow label={t('vipLabel')} value={t(vipKey(state.profile?.vipType))} muted />
        <KeyValueRow label={t('expiresLabel')} value={auth.expiresAt === undefined ? '—' : formatIso(auth.expiresAt)} muted />
        {expiring ? <HintBar text={t('authExpired')} /> : null}
      </div>
    </section>
  )
}

/** 容量卡（§12.10）：三行摘要 + 进度条；异常数据不渲染为 0% 成功态。The quota card (§12.10): a three-line summary plus the bar; abnormal data never renders as a 0% success. */
function QuotaCard(props: CardProps & { readonly onRefresh: () => void }): JSX.Element {
  const { state, t } = props
  const quota = state.quota
  if (quota === undefined) {
    return (
      <section className="bdp-card">
        <SectionHeading title={t('quotaTitle')} actions={<button type="button" className="bdp-button" onClick={props.onRefresh}>{t('refresh')}</button>} />
        <p className="bdp-muted">{t('notSignedInHint')}</p>
      </section>
    )
  }
  const abnormal = quota.totalBytes <= 0 || quota.usedBytes > quota.totalBytes
  const percent = abnormal ? 0 : Math.round((quota.usedBytes / quota.totalBytes) * 100)
  return (
    <section className="bdp-card">
      <SectionHeading title={t('quotaTitle')} actions={<button type="button" className="bdp-button" onClick={props.onRefresh}>{t('refresh')}</button>} />
      {abnormal ? <ErrorBlock title={t('errorTitle')} reason={`${String(quota.totalBytes)} / ${String(quota.usedBytes)}`} /> : (
        <>
          <ProgressBar percent={percent} label={`${t('quotaUsedOf')} ${String(percent)}%`} detail={`${formatBytes(quota.usedBytes)} / ${formatBytes(quota.totalBytes)}`} />
          <KeyValueRow label={t('quotaTotal')} value={formatBytes(quota.totalBytes)} />
          <KeyValueRow label={t('quotaUsed')} value={formatBytes(quota.usedBytes)} />
          <KeyValueRow label={t('quotaFree')} value={formatBytes(quota.freeBytes)} />
          {quota.expireWithin7Days ? <HintBar text={t('quotaExpireHint')} /> : null}
        </>
      )}
    </section>
  )
}
