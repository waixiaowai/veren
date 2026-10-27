/**
 * The cloud tab: CMS sign-in + the user-plane overview + the people directory
 * with rename/note. Every visual decision reuses the panel's existing classes
 * (.im-card/.im-input/.im-button* — the bind-wizard dialect); no new styles.
 * 401 flows back to the sign-in card as a normal state, not an error.
 *
 * 云端 tab：CMS 登录 + 用户面概览 + 人员目录（改名/备注）。全部视觉复用面板既有类
 * （.im-card/.im-input/.im-button*——绑定向导方言），零新样式。401 作为常规状态
 * 回流登录卡，而非错误。
 *
 * @module @veren/im-ui/client/views-cloud
 */

import { useCallback, useEffect, useState } from 'react'
import type { ImSnapshot } from './remote.ts'
import type { CmsAddress, CmsOverview, CmsPerson, CmsSession } from './cms.ts'
import { forgetSession, login, overview, patchPerson, people, restoreSession } from './cms.ts'

/** 默认 CMS 源（本机开发形态；正式部署填公网源）。 */
const DEFAULT_ORIGIN = 'https://veren.top'

type Translate = (key: CloudKey) => string

/** 云端 tab 的文案键（locales.ts CloudKey 的镜像子集）。 */
type CloudKey =
  | 'cloudSubtitle' | 'cloudOrigin' | 'cloudEmail' | 'cloudPassword'
  | 'cloudLogin' | 'cloudLoggingIn' | 'cloudLogout' | 'cloudSessionExpired'
  | 'cloudCredentialNote' | 'cloudOnline' | 'cloudUnauthorized'
  | 'cloudEmptyDirectory' | 'cloudNotePlaceholder' | 'cloudSelfReported'
  | 'cloudRenameNote' | 'cloudSave' | 'cloudCancel' | 'cloudNote'

/** 已登录会话（401 过期由调用方清空回流）。 */
type SignInState = {
  session: CmsSession | undefined
  submitting: boolean
  error?: string
  expired?: boolean
}

/** The cloud tab view: sign-in card or the signed-in home. */
export function CloudView(props: { state: ImSnapshot; t: Translate }): JSX.Element {
  const t = props.t
  const pending = props.state.catalog.conversations.reduce((sum, entry) => sum + entry.pending, 0)
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<SignInState>(() => ({ session: restoreSession(DEFAULT_ORIGIN), submitting: false }))

  const submit = useCallback(async () => {
    setState(previous => ({ ...previous, session: previous.session, submitting: true, error: undefined, expired: false }))
    try {
      const session = await login(origin, email, password)
      setState({ session, submitting: false })
    } catch (cause) {
      setState(previous => ({
        session: previous.session, submitting: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }))
    }
  }, [origin, email, password])

  if (state.session === undefined) {
    return (
      <section className="im-section">
        <h3 className="im-heading">{t('cloudLogin' as CloudKey) === '' ? '' : t('cloudSubtitle' as CloudKey)}</h3>
        <p className="im-muted">{t('cloudCredentialNote' as CloudKey)}</p>
        <p className="im-muted">设备队列 pending：{pending}</p>
        <form
          className="im-card"
          onSubmit={event => { event.preventDefault(); if (!state.submitting) void submit() }}
        >
          <div className="im-card-body">
            <div className="im-row">
              <label className="im-item" htmlFor="im-cms-origin">{t('cloudOrigin' as CloudKey)}</label>
              <input id="im-cms-origin" className="im-input" name="url" value={origin}
                onChange={event => setOrigin(event.target.value)} autoComplete="url" />
            </div>
            <div className="im-row">
              <label className="im-item" htmlFor="im-cms-email">{t('cloudEmail' as CloudKey)}</label>
              <input id="im-cms-email" className="im-input" name="email" type="email" value={email}
                onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="email" />
            </div>
            <div className="im-row">
              <label className="im-item" htmlFor="im-cms-password">{t('cloudPassword' as CloudKey)}</label>
              <input id="im-cms-password" className="im-input" name="password" type="password" value={password}
                onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
            </div>
            {state.error !== undefined && <p className="im-error" role="alert">{state.error}</p>}
            <button type="submit" className="im-button im-button-primary"
              disabled={state.submitting || email === '' || password === ''}>
              {state.submitting ? t('cloudLoggingIn' as CloudKey) : t('cloudLogin' as CloudKey)}
            </button>
          </div>
        </form>
      </section>
    )
  }

  const signOut = (): void => {
    forgetSession(state.session!.origin)
    setState({ session: undefined, submitting: false })
  }
  const onExpired = (): void => {
    forgetSession(state.session!.origin)
    setState({ session: undefined, submitting: false, expired: true })
  }
  return (
    <CloudHome t={t} session={state.session} expired={state.expired === true}
      onLogout={signOut} onExpired={onExpired} />
  )
}

/** Signed-in home: overview strip + people directory + the three empty states. */
function CloudHome(props: {
  t: Translate
  session: CmsSession
  expired: boolean
  onLogout: () => void
  onExpired: () => void
}): JSX.Element {
  const t = props.t
  const [info, setInfo] = useState<CmsOverview | undefined>()
  const [rows, setRows] = useState<{ people: CmsPerson[]; addresses: Record<string, CmsAddress[]> } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [missingModule, setMissingModule] = useState(false)
  const [expired, setExpired] = useState(props.expired)
  const [editing, setEditing] = useState<{ id: string; displayName: string; note: string } | undefined>()

  const refresh = useCallback(async () => {
    try {
      setInfo(await overview(props.session))
      setRows(await people(props.session))
      setError(undefined)
      setMissingModule(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (isExpired(cause)) {
        setExpired(true)
        props.onExpired()
        return
      }
      if (isNotFound(cause)) {
        setMissingModule(true)
        return
      }
      setError(message)
    }
  }, [props])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async (personId: string, displayName: string, note: string) => {
    try {
      await patchPerson(props.session, personId, { displayName, note })
      setEditing(undefined)
      await refresh()
    } catch (cause) {
      if (isExpired(cause)) {
        setExpired(true)
        props.onExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [props])

  if (expired) {
    return (
      <section className="im-section">
        <p className="im-muted">{t('cloudSessionExpired' as CloudKey)}</p>
        <button type="button" className="im-button" onClick={() => setExpired(false)}>{t('cloudLogin' as CloudKey)}</button>
      </section>
    )
  }
  if (missingModule) {
    return (
      <section className="im-section">
        <p className="im-muted">登录成功，但该 CMS 实例还没有 IM 用户面（imhub 模块未部署）。</p>
        <p className="im-muted">部署 2.3.0 后此页即可用；或登出后把 CMS 地址改回本地实例。</p>
        <button type="button" className="im-button" onClick={props.onLogout}>{t('cloudLogout' as CloudKey)}</button>
      </section>
    )
  }
  if (error !== undefined && info === undefined) {
    return (
      <section className="im-section">
        <p className="im-error" role="alert">{error}</p>
        <button type="button" className="im-button" onClick={props.onLogout}>{t('cloudLogout' as CloudKey)}</button>
      </section>
    )
  }
  return (
    <section className="im-section">
      <div className="im-row">
        <span className="im-status">设备队列 pending：{props.pending} · </span>
        <span className="im-status">
          {info === undefined
            ? '…'
            : info.session_authorized
              ? `${t('cloudOnline' as CloudKey)} · ${info.bot_id} · ${info.messages} / ${info.people}`
              : t('cloudUnauthorized' as CloudKey)}
        </span>
        <button type="button" className="im-button" onClick={() => void refresh()}>⟳</button>
        <button type="button" className="im-button" onClick={props.onLogout}>{t('cloudLogout' as CloudKey)}</button>
      </div>
      {error !== undefined && <p className="im-error" role="alert">{error}</p>}
      <div className="im-list">
        {(rows?.people ?? []).map(person => {
          const bound = rows?.addresses[person.id] ?? []
          const editingThis = editing?.id === person.id
          return (
            <div key={person.id} className="im-item">
              {editingThis
                ? (
                    <div className="im-row">
                      <input className="im-input" value={editing.displayName}
                        onChange={event => setEditing({ ...editing, displayName: event.target.value })} />
                      <input className="im-input" value={editing.note} placeholder={t('cloudNotePlaceholder' as CloudKey)}
                        onChange={event => setEditing({ ...editing, note: event.target.value })} />
                      <button type="button" className="im-button im-button-primary"
                        onClick={() => void save(person.id, editing.displayName, editing.note)}>{t('cloudSave' as CloudKey)}</button>
                      <button type="button" className="im-button" onClick={() => setEditing(undefined)}>{t('cloudCancel' as CloudKey)}</button>
                    </div>
                  )
                : (
                    <div className="im-row">
                      <span className="im-strong">{person.display_name}</span>
                      {person.claimed_name !== '' && person.claimed_name !== person.display_name
                        && <span className="im-muted">{t('cloudSelfReported' as CloudKey)}{person.claimed_name}</span>}
                      {person.note !== '' && <span className="im-muted">{t('cloudNote' as CloudKey)}{person.note}</span>}
                      <span className="im-id-mono">{bound.map(address => `${address.provider}/${address.external_id}`).join(' · ')}</span>
                      <button type="button" className="im-button"
                        onClick={() => setEditing({ id: person.id, displayName: person.display_name, note: person.note })}>
                        {t('cloudRenameNote' as CloudKey)}
                      </button>
                    </div>
                  )}
            </div>
          )
        })}
        {(rows?.people ?? []).length === 0 && <p className="im-muted">{t('cloudEmptyDirectory' as CloudKey)}</p>}
      </div>
    </section>
  )
}

/** 401/过期判定：cms.call 把过期形态标记在错误对象上。 */
function isExpired(cause: unknown): boolean {
  return (cause as { expired?: boolean } | undefined)?.expired === true
}

/** 404 判定：目标 CMS 实例没有 imhub 用户面。 */
function isNotFound(cause: unknown): boolean {
  return (cause as { notFound?: boolean } | undefined)?.notFound === true
}
