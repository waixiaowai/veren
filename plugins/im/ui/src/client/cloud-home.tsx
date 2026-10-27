/**
 * The cloud tab's signed-in home: one status bar, one body, three blocking cards.
 *
 * Layout contract (state × layout matrix, 2026-10-28) — the channel state lives
 * in a single status bar: dot + label on the left, the message/people meta when
 * online, and the quiet actions (refresh cloud, sign out) on the right. While
 * present, each blocking condition owns the body: channel unauthorized → the
 * activation funnel card (open the CMS admin face); imhub not deployed → the
 * deployment-gap card; a failed first read → the error card above the stale
 * data. The directory renders people cards with their inline rename/note
 * editor; an empty directory gets the designed empty block — never a bare
 * line, and never the empty copy while the first read is still in flight.
 *
 * 云端页签的已登录主视图：一条状态条、一个主体、三张阻塞卡。
 *
 * 布局契约（状态×布局矩阵，2026-10-28）——通道状态收进唯一的状态条：左侧圆点+标签，
 * 在线时附消息/人员统计，右侧是安静动作（刷新云端、登出）。阻塞条件在位时占据主体：
 * 通道未授权 → 激活漏斗卡（打开 CMS 管理面）；imhub 未部署 → 部署差距卡；首读失败 →
 * 陈旧数据上方的错误卡。目录渲染人员卡与行内改名/备注编辑器；空目录用专门设计的空态
 * 块——不再是一行灰字，首读未回时也绝不谎报「目录为空」。
 *
 * @module @veren/im-ui/client/cloud-home
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { ImKey } from './locales.ts'
import {
  authorizeStart, authorizeStatus, authorizeVerify,
  forgetSession, isExpired, isForbidden, isNotFound, overview, patchPerson, people,
  type CmsAddress, type CmsAuthorizeState, type CmsOverview, type CmsPerson, type CmsSession,
} from './cms.ts'

/** The dictionary face the cloud views render through. */
export type Translate = (key: ImKey) => string

/** One people-directory read: the rows plus each person's address bindings. */
interface DirectoryData {
  readonly people: readonly CmsPerson[]
  readonly addresses: Readonly<Record<string, readonly CmsAddress[]>>
}

/** One in-flight rename/note draft, keyed by its person. */
interface EditDraft {
  readonly id: string
  readonly displayName: string
  readonly note: string
}

/** The signed-in home: fetches overview + directory, then dispatches the body. */
export function CloudHome(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly onSignedOut: () => void
  readonly onExpired: () => void
}): React.JSX.Element {
  const { t, session } = props
  const [info, setInfo] = useState<CmsOverview | undefined>()
  const [rows, setRows] = useState<DirectoryData | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [gap, setGap] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInfo(await overview(session))
      setRows(await people(session))
      setError(undefined)
      setGap(false)
    } catch (cause) {
      if (isExpired(cause)) {
        forgetSession(session.origin)
        props.onExpired()
        return
      }
      if (isNotFound(cause)) {
        setGap(true)
        return
      }
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [props, session])

  useEffect(() => { void refresh() }, [refresh])

  const savePerson = useCallback(async (draft: EditDraft): Promise<boolean> => {
    try {
      await patchPerson(session, draft.id, { displayName: draft.displayName, note: draft.note })
    } catch (cause) {
      if (isExpired(cause)) {
        forgetSession(session.origin)
        props.onExpired()
        return false
      }
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
    await refresh()
    return true
  }, [props, refresh, session])

  const authorized = info?.session_authorized === true
  return (
    <section className="im-section">
      <StatusBar t={t} info={info} authorized={authorized}
        onRefresh={() => void refresh()} onSignOut={props.onSignedOut} />
      {error !== undefined && <p className="im-error" role="alert">{error}</p>}
      {gap
        ? <GapCard t={t} onSignOut={props.onSignedOut} />
        : authorized
          ? <Directory t={t} rows={rows} onSave={savePerson} />
          : info === undefined
            ? <EmptyBlock title={t('loading')} />
            : <AuthorizeFunnel t={t} session={session} onAuthorized={() => void refresh()} onExpired={props.onExpired} />}
    </section>
  )
}

/** The single channel-status surface: dot + label + meta, quiet actions right. */
function StatusBar(props: {
  readonly t: Translate
  readonly info: CmsOverview | undefined
  readonly authorized: boolean
  readonly onRefresh: () => void
  readonly onSignOut: () => void
}): React.JSX.Element {
  const { t, info, authorized } = props
  return (
    <div className="im-statusbar">
      <span className="im-status">
        <span className={authorized ? 'im-dot im-dot-ok' : 'im-dot'} aria-hidden="true" />
        {info === undefined ? t('cloudChecking') : authorized ? t('cloudOnline') : t('cloudUnauthorizedTitle')}
      </span>
      {authorized && info !== undefined && (
        <span className="im-statusbar-meta">
          {info.bot_id !== '' && <span className="im-id-mono">{info.bot_id}</span>}
          <span>{t('cloudStatMessages')} {info.messages}</span>
          <span>{t('cloudStatPeople')} {info.people}</span>
        </span>
      )}
      <span className="im-statusbar-actions">
        <button type="button" className="im-link-button" onClick={props.onRefresh}>{t('cloudRefresh')}</button>
        <button type="button" className="im-link-button im-link-muted" onClick={props.onSignOut}>{t('cloudLogout')}</button>
      </span>
    </div>
  )
}

/**
 * The activation funnel: the unauthorized channel's one job is to get
 * authorized — start the QR attempt here (delegates to imhub:manage on the
 * server), render the QR for the phone, poll until a terminal state, collect
 * the verify code when asked, and hand back to the refreshed home on success.
 * 激活漏斗：未授权通道的唯一任务是被授权——就在这里发起 QR 尝试（服务端转
 * imhub:manage），出二维码供手机扫，轮询到终态，需要时收验证码，成功后回到刷新后的主页。
 */
function AuthorizeFunnel(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly onAuthorized: () => void
  readonly onExpired: () => void
}): React.JSX.Element {
  const { t, session } = props
  const [phase, setPhase] = useState<'idle' | 'qr' | 'verify' | 'done'>('idle')
  const [qrData, setQrData] = useState<string | undefined>()
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | undefined>()
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  /** 3s 轮询到终态；confirmed 收口，need_verifycode 转 verify，expired 回 idle。 */
  const poll = useCallback(async (): Promise<void> => {
    try {
      const state = await authorizeStatus(session)
      if (state.session_authorized) {
        clearInterval(timer.current)
        setPhase('done')
        props.onAuthorized()
        return
      }
      if (!state.active) {
        clearInterval(timer.current)
        setPhase('idle')
        setNote(t('cloudAuthExpired'))
        return
      }
      if (state.status === 'need_verifycode') setPhase('verify')
    } catch (cause) {
      if (isExpired(cause)) {
        clearInterval(timer.current)
        forgetSession(session.origin)
        props.onExpired()
      }
      // 瞬时网络抖动不打断轮询 / a transient network blip never stops the poll
    }
  }, [props, session, t])

  useEffect(() => () => clearInterval(timer.current), [])

  const start = useCallback(async (): Promise<void> => {
    setBusy(true); setNote(undefined); setDenied(false)
    try {
      await authorizeStart(session)
      const state = await authorizeStatus(session)
      if (state.qr_url !== '') setQrData(await QRCode.toDataURL(state.qr_url, { width: 260, margin: 1 }))
      setPhase('qr')
      clearInterval(timer.current)
      timer.current = setInterval(() => void poll(), 3000)
    } catch (cause) {
      if (isForbidden(cause)) setDenied(true)
      else setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [poll, session, t])

  const submitCode = useCallback(async (): Promise<void> => {
    if (code.trim() === '') return
    setBusy(true)
    try {
      await authorizeVerify(session, code.trim())
      setNote(undefined)
      await poll()
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [code, poll, session])

  if (phase === 'done') return <EmptyBlock title={t('cloudAuthConfirmed')} />
  return (
    <div className="im-card im-card-hot">
      <div className="im-card-body">
        <span className="im-strong">{t('cloudUnauthorizedTitle')}</span>
        {phase === 'idle' && (
          <>
            <p className="im-muted">{t('cloudUnauthorizedHint')}</p>
            {denied && <p className="im-error" role="alert">{t('cloudAuthManageDenied')}</p>}
            {note !== undefined && <p className="im-error" role="alert">{note}</p>}
            <div>
              <button type="button" className="im-button im-button-primary" disabled={busy}
                onClick={() => void start()}>{busy ? t('cloudAuthStarting') : t('cloudAuthStart')}</button>
              <a className="im-link-button im-link-muted" href={session.origin} target="_blank" rel="noreferrer">
                {t('cloudOpenAdmin')}
              </a>
            </div>
          </>
        )}
        {phase === 'qr' && (
          <>
            <p className="im-muted">{t('cloudAuthScan')}</p>
            {qrData !== undefined && <img className="im-qr" src={qrData} alt="QR" width={260} height={260} />}
            {note !== undefined && <p className="im-error" role="alert">{note}</p>}
          </>
        )}
        {phase === 'verify' && (
          <>
            <p className="im-muted">{t('cloudAuthVerifyHint')}</p>
            <div className="im-rename-row">
              <input className="im-input" value={code} inputMode="numeric" placeholder={t('cloudAuthCodePlaceholder')}
                onChange={event => setCode(event.target.value)} />
              <button type="button" className="im-button im-button-primary" disabled={busy || code.trim() === ''}
                onClick={() => void submitCode()}>{t('cloudAuthVerifySubmit')}</button>
            </div>
            {note !== undefined && <p className="im-error" role="alert">{note}</p>}
          </>
        )}
      </div>
    </div>
  )
}

/** The deployment-gap card: signed in, but this CMS instance has no user plane. */
function GapCard(props: { readonly t: Translate; readonly onSignOut: () => void }): React.JSX.Element {
  const { t } = props
  return (
    <div className="im-card">
      <div className="im-card-body">
        <span className="im-strong">{t('cloudGapTitle')}</span>
        <p className="im-muted">{t('cloudGapLine')}</p>
        <p className="im-muted">{t('cloudGapHint')}</p>
        <div>
          <button type="button" className="im-button" onClick={props.onSignOut}>{t('cloudLogout')}</button>
        </div>
      </div>
    </div>
  )
}

/** The designed empty/loading block, same shape as the intake tab's. */
function EmptyBlock(props: { readonly title: string; readonly hint?: string }): React.JSX.Element {
  return (
    <div className="im-empty">
      <p className="im-empty-title">{props.title}</p>
      {props.hint !== undefined && <p className="im-muted">{props.hint}</p>}
    </div>
  )
}

/** The people directory: heading + person cards, or the designed empty block. */
function Directory(props: {
  readonly t: Translate
  readonly rows: DirectoryData | undefined
  readonly onSave: (draft: EditDraft) => Promise<boolean>
}): React.JSX.Element {
  const { t, rows } = props
  const [editing, setEditing] = useState<EditDraft | undefined>()
  if (rows === undefined) return <EmptyBlock title={t('loading')} />
  if (rows.people.length === 0) {
    return <EmptyBlock title={t('cloudEmptyTitle')} hint={t('cloudEmptyHint')} />
  }
  return (
    <>
      <h3 className="im-heading">{t('people')}</h3>
      <ul className="im-list">
        {rows.people.map(person => (
          <PersonCard key={person.id} t={t} person={person}
            bound={rows.addresses[person.id] ?? []}
            draft={editing?.id === person.id ? editing : undefined}
            onEdit={() => setEditing({ id: person.id, displayName: person.display_name, note: person.note })}
            onDraft={setEditing}
            onCancel={() => setEditing(undefined)}
            onSave={async draft => {
              if (await props.onSave(draft)) setEditing(undefined)
            }} />
        ))}
      </ul>
    </>
  )
}

/** One person card: identity facts + bindings, or the inline rename/note editor. */
function PersonCard(props: {
  readonly t: Translate
  readonly person: CmsPerson
  readonly bound: readonly CmsAddress[]
  readonly draft: EditDraft | undefined
  readonly onEdit: () => void
  readonly onDraft: (draft: EditDraft) => void
  readonly onCancel: () => void
  readonly onSave: (draft: EditDraft) => Promise<void>
}): React.JSX.Element {
  const { t, person, bound, draft } = props
  if (draft !== undefined) {
    return (
      <li className="im-item">
        <div className="im-rename-row">
          <input className="im-input im-rename-input" value={draft.displayName}
            onChange={event => props.onDraft({ ...draft, displayName: event.target.value })} />
          <input className="im-input" value={draft.note} placeholder={t('cloudNotePlaceholder')}
            onChange={event => props.onDraft({ ...draft, note: event.target.value })} />
          <button type="button" className="im-button im-button-primary"
            onClick={() => void props.onSave(draft)}>{t('cloudSave')}</button>
          <button type="button" className="im-button" onClick={props.onCancel}>{t('cloudCancel')}</button>
        </div>
      </li>
    )
  }
  return (
    <li className="im-item">
      <span className="im-strong">{person.display_name}</span>
      {person.claimed_name !== '' && person.claimed_name !== person.display_name
        && <span className="im-muted">{t('cloudSelfReported')}{person.claimed_name}</span>}
      {person.note !== '' && <span className="im-muted">{t('cloudNote')}{person.note}</span>}
      <span className="im-id-mono">{bound.map(address => `${address.provider}/${address.external_id}`).join(' · ')}</span>
      <button type="button" className="im-button" onClick={props.onEdit}>{t('cloudRenameNote')}</button>
    </li>
  )
}
