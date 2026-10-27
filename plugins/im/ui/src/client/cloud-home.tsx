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

import { useCallback, useEffect, useState } from 'react'
import type { ImKey } from './locales.ts'
import {
  forgetSession, isExpired, isNotFound, overview, patchPerson, people,
  type CmsAddress, type CmsOverview, type CmsPerson, type CmsSession,
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
            : <FunnelCard t={t} origin={session.origin} />}
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

/** The activation funnel: the unauthorized channel's one job is to get authorized. */
function FunnelCard(props: { readonly t: Translate; readonly origin: string }): React.JSX.Element {
  const { t, origin } = props
  return (
    <div className="im-card im-card-hot">
      <div className="im-card-body">
        <span className="im-strong">{t('cloudUnauthorizedTitle')}</span>
        <p className="im-muted">{t('cloudUnauthorizedHint')}</p>
        <div>
          <a className="im-button im-button-primary" href={origin} target="_blank" rel="noreferrer">
            {t('cloudOpenAdmin')}
          </a>
        </div>
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
