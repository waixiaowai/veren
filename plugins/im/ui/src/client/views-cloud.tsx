/**
 * The cloud tab: CMS sign-in + the user-plane overview + the people directory
 * with rename/note. Read-first per the data-home ADR; the only write is the
 * person rename/note.
 *
 * 云端 tab：CMS 登录 + 用户面概览 + 人员目录（改名/备注）。按归属表以读为主；
 * 唯一写面是人员改名/备注。
 *
 * @module @veren/im-ui/client/views-cloud
 */

import { useCallback, useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import type { CmsAddress, CmsOverview, CmsPerson, CmsSession } from './cms.ts'
import { forgetSession, login, overview, patchPerson, people, restoreSession } from './cms.ts'

/** 默认 CMS 源（本机开发形态；正式部署填公网源）。 */
const DEFAULT_ORIGIN = 'http://127.0.0.1:8080'

/** 提示词类型窄口（面板传入的 t）。 */
type Translate = (key: string) => string

/** The cloud tab view: self-contained login + user-plane reads. */
export function CloudView(_props: { t: Translate }): JSX.Element {
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState<CmsSession | undefined>(() => restoreSession(DEFAULT_ORIGIN))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSession(await login(origin, email, password))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [origin, email, password])

  if (session === undefined) {
    return (
      <section className='im-section'>
        <h3>登录 CMS</h3>
        <div className='im-form'>
          <input aria-label='CMS 地址' value={origin} onChange={event => setOrigin(event.target.value)} placeholder={DEFAULT_ORIGIN} />
          <input aria-label='邮箱' value={email} onChange={event => setEmail(event.target.value)} placeholder='email' />
          <input aria-label='密码' type='password' value={password} onChange={event => setPassword(event.target.value)} />
          <button type='button' className='im-button' disabled={busy || email === '' || password === ''} onClick={() => void submit()}>
            {busy ? '登录中…' : '登录'}
          </button>
          {error !== undefined && <p className='im-error'>{error}</p>}
        </div>
      </section>
    )
  }
  return <CloudHome session={session} onLogout={() => { forgetSession(session.origin); setSession(undefined) }} />
}

/** Signed-in home: overview strip + people directory. */
function CloudHome(props: { session: CmsSession; onLogout: () => void }): JSX.Element {
  const { session } = props
  const [info, setInfo] = useState<CmsOverview | undefined>()
  const [rows, setRows] = useState<{ people: CmsPerson[]; addresses: Record<string, CmsAddress[]> } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; displayName: string; note: string } | undefined>()

  const refresh = useCallback(async () => {
    try {
      setInfo(await overview(session))
      setRows(await people(session))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [session])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async (personId: string, displayName: string, note: string) => {
    try {
      await patchPerson(session, personId, { displayName, note })
      setEditing(undefined)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [session, refresh])

  if (error !== undefined && info === undefined) {
    return (
      <section className='im-section'>
        <p className='im-error'>{error}</p>
        <button type='button' className='im-button' onClick={props.onLogout}>返回登录</button>
      </section>
    )
  }
  return (
    <section className='im-section'>
      <div className='im-cloud-head'>
        <span>
          {info === undefined ? '加载中…' : info.session_authorized
            ? `通道在线：${info.bot_id} · 消息 ${info.messages} · 人员 ${info.people}`
            : '通道未授权（在 CMS 管理面扫码）'}
        </span>
        <button type='button' className='im-button' onClick={() => void refresh()}>刷新</button>
        <button type='button' className='im-button' onClick={props.onLogout}>登出</button>
      </div>
      {error !== undefined && <p className='im-error'>{error}</p>}
      <h4>人员目录（云端）</h4>
      {(rows?.people ?? []).map(person => {
        const bound = rows?.addresses[person.id] ?? []
        const editingThis = editing?.id === person.id
        return (
          <div key={person.id} className='im-person'>
            {editingThis
              ? (
                  <>
                    <input value={editing.displayName} onChange={event => setEditing({ ...editing, displayName: event.target.value })} />
                    <input value={editing.note} onChange={event => setEditing({ ...editing, note: event.target.value })} placeholder='备注' />
                    <button type='button' className='im-button' onClick={() => void save(person.id, editing.displayName, editing.note)}>保存</button>
                    <button type='button' className='im-button' onClick={() => setEditing(undefined)}>取消</button>
                  </>
                )
              : (
                  <>
                    <strong>{person.display_name}</strong>
                    {person.claimed_name !== '' && person.claimed_name !== person.display_name && <span className='im-muted'>（自称：{person.claimed_name}）</span>}
                    <span className='im-muted'>{bound.map(address => `${address.provider}/${address.external_id}`).join(' · ')}</span>
                    {person.note !== '' && <span className='im-muted'>备注：{person.note}</span>}
                    <button type='button' className='im-button' onClick={() => setEditing({ id: person.id, displayName: person.display_name, note: person.note })}>改名/备注</button>
                  </>
                )}
          </div>
        )
      })}
      {(rows?.people ?? []).length === 0 && <p className='im-muted'>云端目录为空（设备观察到发送者后会上报至此）。</p>}
    </section>
  )
}

// TFunction 只在需要 i18n 键时引入；当前中文直出，保留类型位。
export type { TFunction }
