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
 * The body pieces live in their own responsibility modules: the status bar
 * (`cloud-status-bar.tsx`), the activation funnel (`cloud-authorize.tsx`), the
 * people directory (`cloud-directory.tsx`), the shared empty block
 * (`cloud-empty.tsx`), and the shared types (`cloud-home-types.ts`).
 * 主体部件各居其职：状态条（`cloud-status-bar.tsx`）、激活漏斗（`cloud-authorize.tsx`）、
 * 人员目录（`cloud-directory.tsx`）、共享空态块（`cloud-empty.tsx`）与共享类型
 * （`cloud-home-types.ts`）。
 *
 * @module @veren/im-ui/client/cloud-home
 */

import { useCallback, useEffect, useState } from 'react'
import {
  forgetSession, isExpired, isNotFound, overview, patchPerson, people,
  type CmsOverview, type CmsSession,
} from './cms.ts'
import type { DirectoryData, EditDraft, Translate } from './cloud-home-types.ts'
import { StatusBar } from './cloud-status-bar.tsx'
import { AuthorizeFunnel } from './cloud-authorize.tsx'
import { Directory } from './cloud-directory.tsx'
import { EmptyBlock } from './cloud-empty.tsx'

// ---- unchanged export surface (the type moved to cloud-home-types.ts) ----
// ---- 导出面不变（类型已移至 cloud-home-types.ts）----
export type { Translate } from './cloud-home-types.ts'

/** One CMS failure, classified for the home's error surfaces. */
/** 一次 CMS 调用失败，为主视图的错误面做好分类。 */
type HomeFailure =
  | { readonly kind: 'expired' }
  | { readonly kind: 'gap' }
  | { readonly kind: 'message'; readonly text: string }

/**
 * Classify one CMS call failure: a 401 signs the session out and flows up, a
 * 404 flags the deployment gap, anything else is a surfaced message.
 * 分类一次 CMS 调用失败：401 登出并上抛，404 标记部署差距，其余作为可展示的消息。
 */
function classifyFailure(cause: unknown, session: CmsSession, onExpired: () => void): HomeFailure {
  if (isExpired(cause)) {
    forgetSession(session.origin)
    onExpired()
    return { kind: 'expired' }
  }
  if (isNotFound(cause)) return { kind: 'gap' }
  return { kind: 'message', text: cause instanceof Error ? cause.message : String(cause) }
}

/** The snapshot setters the home's async steps drive. */
/** 主视图异步步骤驱动的快照 setter。 */
interface HomeSetters {
  readonly setInfo: (info: CmsOverview | undefined) => void
  readonly setRows: (rows: DirectoryData | undefined) => void
  readonly setError: (error: string | undefined) => void
  readonly setGap: (gap: boolean) => void
}

/**
 * One home refresh: read the overview and the directory; a 401 signs the
 * session out, a 404 flips the gap card, anything else surfaces its message.
 * 一次主视图刷新：读取概览与目录；401 登出，404 翻出差距卡，其余呈现消息。
 */
async function reloadHome(
  session: CmsSession,
  onExpired: () => void,
  set: HomeSetters,
): Promise<void> {
  try {
    set.setInfo(await overview(session))
    set.setRows(await people(session))
    // 一次成功读取会清掉错误与过期的差距标记。
    // A successful read clears the error and the stale gap flag.
    set.setError(undefined)
    set.setGap(false)
  } catch (cause) {
    const failure = classifyFailure(cause, session, onExpired)
    if (failure.kind === 'gap') set.setGap(true)
    if (failure.kind === 'message') set.setError(failure.text)
  }
}

/**
 * Patch one person's display name and note; false means the patch failed, with
 * only its message surfaced — the gap card is reserved for the first read.
 * 补丁一个人员的显示名与备注；false 表示补丁失败，只呈现消息——差距卡专属于首读。
 */
async function saveDraft(
  session: CmsSession,
  draft: EditDraft,
  onExpired: () => void,
  setError: (error: string | undefined) => void,
): Promise<boolean> {
  try {
    await patchPerson(session, draft.id, { displayName: draft.displayName, note: draft.note })
  } catch (cause) {
    const failure = classifyFailure(cause, session, onExpired)
    if (failure.kind === 'message') setError(failure.text)
    return false
  }
  return true
}

/**
 * The home's data plane: overview + directory state, the refresh cycle, and
 * the person save.
 * 主视图的数据面：概览+目录状态、刷新循环与人员保存。
 */
function useHomeData(props: {
  readonly session: CmsSession
  readonly onExpired: () => void
}): {
  readonly info: CmsOverview | undefined
  readonly rows: DirectoryData | undefined
  readonly error: string | undefined
  readonly gap: boolean
  readonly refresh: () => Promise<void>
  readonly savePerson: (draft: EditDraft) => Promise<boolean>
} {
  const { session } = props
  const [info, setInfo] = useState<CmsOverview | undefined>()
  const [rows, setRows] = useState<DirectoryData | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [gap, setGap] = useState(false)

  const refresh = useCallback(
    () => reloadHome(session, props.onExpired, { setInfo, setRows, setError, setGap }),
    [props, session],
  )

  useEffect(() => { void refresh() }, [refresh])

  const savePerson = useCallback(async (draft: EditDraft): Promise<boolean> => {
    const saved = await saveDraft(session, draft, props.onExpired, setError)
    if (!saved) return false
    await refresh()
    return true
  }, [props, refresh, session])

  return { info, rows, error, gap, refresh, savePerson }
}

/** The signed-in home: fetches overview + directory, then dispatches the body. */
/** 已登录主视图：拉取概览+目录，然后分发主体。 */
export function CloudHome(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly onSignedOut: () => void
  readonly onExpired: () => void
}): React.JSX.Element {
  const { t, session } = props
  const home = useHomeData({ session: props.session, onExpired: props.onExpired })
  return (
    <section className="im-section">
      <HomeBody t={t} session={session} info={home.info} rows={home.rows} error={home.error} gap={home.gap}
        onRefresh={() => void home.refresh()} onSignOut={props.onSignedOut}
        onAuthorized={() => void home.refresh()} onExpired={props.onExpired} onSave={home.savePerson} />
    </section>
  )
}

/** The home's one body: the status bar, the error line, and the dispatched card. */
/** 主视图的唯一主体：状态条、错误行与分发出去的卡片。 */
function HomeBody(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly info: CmsOverview | undefined
  readonly rows: DirectoryData | undefined
  readonly error: string | undefined
  readonly gap: boolean
  readonly onRefresh: () => void
  readonly onSignOut: () => void
  readonly onAuthorized: () => void
  readonly onExpired: () => void
  readonly onSave: (draft: EditDraft) => Promise<boolean>
}): React.JSX.Element {
  const { t, session, info, rows, error, gap } = props
  const authorized = info?.session_authorized === true
  return (
    <>
      <StatusBar t={t} info={info} authorized={authorized}
        onRefresh={props.onRefresh} onSignOut={props.onSignOut} />
      {error !== undefined && <p className="im-error" role="alert">{error}</p>}
      {gap
        ? <GapCard t={t} onSignOut={props.onSignOut} />
        : authorized
          ? <Directory t={t} rows={rows} onSave={props.onSave} />
          : info === undefined
            ? <EmptyBlock title={t('loading')} />
            : <AuthorizeFunnel t={t} session={session} onAuthorized={props.onAuthorized} onExpired={props.onExpired} />}
    </>
  )
}

/** The deployment-gap card: signed in, but this CMS instance has no user plane. */
/** 部署差距卡：已登录，但这个 CMS 实例没有用户面。 */
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
