/**
 * The cloud tab's router and its sign-in face.
 *
 * Two halves split by sign-in state: the sign-in card (origin/email/password;
 * credentials never leave this tab) and the signed-in home in cloud-home.tsx.
 * A 401 flows back here as a normal state — the expired hint shows above the
 * form, not as an error.
 *
 * 云端页签的路由与登录面。
 *
 * 以登录态一分为二：登录卡（CMS 地址/邮箱/密码，凭据不出本页签）与 cloud-home.tsx
 * 里的已登录主视图。401 作为常规态回流这里——过期提示显示在表单上方，而非报错。
 *
 * @module @veren/im-ui/client/views-cloud
 */

import { useCallback, useState } from 'react'
import { forgetSession, login, restoreSession, type CmsSession } from './cms.ts'
import { CloudHome, type Translate } from './cloud-home.tsx'

/** 默认 CMS 源（本机开发形态；正式部署填公网源）。 */
const DEFAULT_ORIGIN = 'https://veren.top'

/** The cloud tab: sign-in card or signed-in home, dispatched by the session. */
export function CloudView(props: { readonly t: Translate }): React.JSX.Element {
  const [session, setSession] = useState<CmsSession | undefined>(() => restoreSession(DEFAULT_ORIGIN))
  const [expired, setExpired] = useState(false)
  if (session === undefined) {
    return (
      <SignInCard t={props.t} expired={expired}
        onSignedIn={next => { setExpired(false); setSession(next) }} />
    )
  }
  return (
    <CloudHome t={props.t} session={session}
      onSignedOut={() => { forgetSession(session.origin); setSession(undefined) }}
      onExpired={() => { forgetSession(session.origin); setSession(undefined); setExpired(true) }} />
  )
}

/** The sign-in card, with the expired hint when a 401 sent us back here. */
function SignInCard(props: {
  readonly t: Translate
  readonly expired: boolean
  readonly onSignedIn: (session: CmsSession) => void
}): React.JSX.Element {
  const { t, expired } = props
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = useCallback(async () => {
    setSubmitting(true)
    setError(undefined)
    try {
      props.onSignedIn(await login(origin, email, password))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }, [props, origin, email, password])

  return (
    <section className="im-section">
      <h2 className="im-heading">{t('cloudSignInHeading')}</h2>
      <p className="im-muted">{t('cloudSubtitle')}</p>
      {expired && <p className="im-muted">{t('cloudSessionExpired')}</p>}
      <form className="im-card" onSubmit={event => { event.preventDefault(); if (!submitting) void submit() }}>
        <div className="im-card-body">
          <div className="im-row">
            <label className="im-item" htmlFor="im-cms-origin">{t('cloudOrigin')}</label>
            <input id="im-cms-origin" className="im-input" name="url" value={origin}
              onChange={event => setOrigin(event.target.value)} autoComplete="url" />
          </div>
          <div className="im-row">
            <label className="im-item" htmlFor="im-cms-email">{t('cloudEmail')}</label>
            <input id="im-cms-email" className="im-input" name="email" type="email" value={email}
              onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="email" />
          </div>
          <div className="im-row">
            <label className="im-item" htmlFor="im-cms-password">{t('cloudPassword')}</label>
            <input id="im-cms-password" className="im-input" name="password" type="password" value={password}
              onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          {error !== undefined && <p className="im-error" role="alert">{error}</p>}
          <button type="submit" className="im-button im-button-primary"
            disabled={submitting || email === '' || password === ''}>
            {submitting ? t('cloudLoggingIn') : t('cloudLogin')}
          </button>
        </div>
      </form>
      <p className="im-muted">{t('cloudCredentialNote')}</p>
    </section>
  )
}
