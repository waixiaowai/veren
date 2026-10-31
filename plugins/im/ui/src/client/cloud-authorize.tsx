/**
 * The activation funnel: the unauthorized channel's one job is to get
 * authorized — start the QR attempt here (delegates to imhub:manage on the
 * server), render the QR for the phone, poll until a terminal state, collect
 * the verify code when asked, and hand back to the refreshed home on success.
 *
 * 激活漏斗：未授权通道的唯一任务是被授权——就在这里发起 QR 尝试（服务端转
 * imhub:manage），出二维码供手机扫，轮询到终态，需要时收验证码，成功后回到刷新后的主页。
 *
 * The funnel is a three-phase state machine (idle → qr → verify → done); each
 * phase renders through its own small component below.
 * 漏斗是一台三阶段状态机（idle → qr → verify → done）；每个阶段各由下方的小组件渲染。
 *
 * @module @veren/im-ui/client/cloud-authorize
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  authorizeStart, authorizeStatus, authorizeVerify,
  forgetSession, isExpired, isForbidden,
  type CmsSession,
} from './cms.ts'
import type { Translate } from './cloud-home-types.ts'
import { EmptyBlock } from './cloud-empty.tsx'

/** The funnel's phases. */
/** 漏斗的阶段。 */
type FunnelPhase = 'idle' | 'qr' | 'verify' | 'done'

/** The interval ref the funnel's steps share. */
/** 漏斗各步骤共享的定时器 ref。 */
type FunnelTimer = { current: ReturnType<typeof setInterval> | undefined }

/**
 * The state setters the funnel's async steps drive, bundled so each step has
 * one readable parameter. React setState identities are stable.
 * 漏斗异步步骤驱动的状态 setter，打包成一个参数保持可读。React 的 setState 身份稳定。
 */
interface FunnelSetters {
  readonly setPhase: (phase: FunnelPhase) => void
  readonly setQrData: (data: string | undefined) => void
  readonly setNote: (note: string | undefined) => void
  readonly setDenied: (denied: boolean) => void
  readonly setBusy: (busy: boolean) => void
}

/** The terminal outcomes the funnel reports back to the home. */
/** 漏斗向主页上报的终态结果。 */
interface FunnelOutcome {
  readonly onAuthorized: () => void
  readonly onExpired: () => void
}

/**
 * One status poll: confirmed closes the funnel, an inactive session goes back
 * to idle with the expired note, and a verify demand switches to the verify
 * phase. A session expiry forgets the session and reports it; a transient
 * network blip never stops the poll.
 * 一次状态轮询：已确认收口漏斗；会话失效回到 idle 并提示过期；要求验证码则切到 verify。
 * 会话过期时忘掉会话并上报；瞬时网络抖动绝不打断轮询。
 */
async function pollAuthorize(
  session: CmsSession,
  t: Translate,
  timer: FunnelTimer,
  setters: Pick<FunnelSetters, 'setPhase' | 'setNote'>,
  outcome: FunnelOutcome,
): Promise<void> {
  try {
    const state = await authorizeStatus(session)
    if (state.session_authorized) {
      clearInterval(timer.current)
      setters.setPhase('done')
      outcome.onAuthorized()
      return
    }
    if (!state.active) {
      clearInterval(timer.current)
      setters.setPhase('idle')
      setters.setNote(t('cloudAuthExpired'))
      return
    }
    if (state.status === 'need_verifycode') setters.setPhase('verify')
  } catch (cause) {
    if (isExpired(cause)) {
      clearInterval(timer.current)
      forgetSession(session.origin)
      outcome.onExpired()
    }
    // 瞬时网络抖动不打断轮询 / a transient network blip never stops the poll
  }
}

/**
 * Start the authorization: request the QR, render it locally, then poll every
 * 3s. An admin-forbidden session flips the denied flag; other failures surface
 * as a note.
 * 发起授权：请求二维码、本地渲染，然后每 3 秒轮询。管理员面拒绝时翻转 denied 标记；
 * 其他失败以提示呈现。
 */
async function startAuthorize(
  session: CmsSession,
  timer: FunnelTimer,
  setters: FunnelSetters,
  poll: () => Promise<void>,
): Promise<void> {
  setters.setBusy(true); setters.setNote(undefined); setters.setDenied(false)
  try {
    await authorizeStart(session)
    const state = await authorizeStatus(session)
    if (state.qr_url !== '') setters.setQrData(await QRCode.toDataURL(state.qr_url, { width: 260, margin: 1 }))
    setters.setPhase('qr')
    clearInterval(timer.current)
    timer.current = setInterval(() => void poll(), 3000)
  } catch (cause) {
    if (isForbidden(cause)) setters.setDenied(true)
    else setters.setNote(cause instanceof Error ? cause.message : String(cause))
  } finally {
    setters.setBusy(false)
  }
}

/** Submit the verify code, then poll once for the verdict. */
/** 提交验证码，然后轮询一次拿裁决。 */
async function submitAuthorize(
  session: CmsSession,
  code: string,
  setters: Pick<FunnelSetters, 'setNote' | 'setBusy'>,
  poll: () => Promise<void>,
): Promise<void> {
  if (code.trim() === '') return
  setters.setBusy(true)
  try {
    await authorizeVerify(session, code.trim())
    setters.setNote(undefined)
    await poll()
  } catch (cause) {
    setters.setNote(cause instanceof Error ? cause.message : String(cause))
  } finally {
    setters.setBusy(false)
  }
}

/**
 * The funnel card's body: the phase branches for idle/qr/verify. The done
 * phase is handled by the parent (it renders the confirmed empty block).
 * 漏斗卡的主体：idle/qr/verify 三个阶段的分支。done 阶段由父组件处理
 * （渲染已确认空态块）。
 */
function FunnelBody(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly phase: FunnelPhase
  readonly qrData: string | undefined
  readonly code: string
  readonly note: string | undefined
  readonly denied: boolean
  readonly busy: boolean
  readonly onCode: (code: string) => void
  readonly onStart: () => void
  readonly onSubmit: () => void
}): React.JSX.Element {
  const { t, session, phase, qrData, code, note, denied, busy } = props
  return (
    <div className="im-card im-card-hot">
      <div className="im-card-body">
        <span className="im-strong">{t('cloudUnauthorizedTitle')}</span>
        {phase === 'idle' && <IdlePhase t={t} session={session} denied={denied} note={note} busy={busy} onStart={props.onStart} />}
        {phase === 'qr' && <QrPhase t={t} qrData={qrData} note={note} />}
        {phase === 'verify' && <VerifyPhase t={t} code={code} busy={busy} note={note}
          onCode={props.onCode} onSubmit={props.onSubmit} />}
      </div>
    </div>
  )
}

/** The unauthorized channel's activation funnel card. */
/** 未授权通道的激活漏斗卡。 */
export function AuthorizeFunnel(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly onAuthorized: () => void
  readonly onExpired: () => void
}): React.JSX.Element {
  const { t, session } = props
  const [phase, setPhase] = useState<FunnelPhase>('idle')
  const [qrData, setQrData] = useState<string | undefined>()
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | undefined>()
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => () => clearInterval(timer.current), [])
  const setters: FunnelSetters = { setPhase, setQrData, setNote, setDenied, setBusy }
  const outcome: FunnelOutcome = { onAuthorized: props.onAuthorized, onExpired: props.onExpired }
  // 3s 轮询到终态；confirmed 收口，need_verifycode 转 verify，expired 回 idle。
  const poll = useCallback(() => pollAuthorize(session, t, timer, setters, outcome), [props, session, t])
  const start = useCallback(() => startAuthorize(session, timer, setters, poll), [poll, session, t])
  const submitCode = useCallback(() => submitAuthorize(session, code, setters, poll), [code, poll, session])

  if (phase === 'done') return <EmptyBlock title={t('cloudAuthConfirmed')} />
  return (
    <FunnelBody t={t} session={session} phase={phase} qrData={qrData} code={code} note={note}
      denied={denied} busy={busy} onCode={setCode}
      onStart={() => void start()} onSubmit={() => void submitCode()} />
  )
}

/** The idle phase: the hint, the start button, and the admin link. */
/** idle 阶段：提示、开始按钮与管理面链接。 */
function IdlePhase(props: {
  readonly t: Translate
  readonly session: CmsSession
  readonly denied: boolean
  readonly note: string | undefined
  readonly busy: boolean
  readonly onStart: () => void
}): React.JSX.Element {
  const { t, session, denied, note, busy } = props
  return (
    <>
      <p className="im-muted">{t('cloudUnauthorizedHint')}</p>
      {denied && <p className="im-error" role="alert">{t('cloudAuthManageDenied')}</p>}
      {note !== undefined && <p className="im-error" role="alert">{note}</p>}
      <div>
        <button type="button" className="im-button im-button-primary" disabled={busy}
          onClick={props.onStart}>{busy ? t('cloudAuthStarting') : t('cloudAuthStart')}</button>
        <a className="im-link-button im-link-muted" href={session.origin} target="_blank" rel="noreferrer">
          {t('cloudOpenAdmin')}
        </a>
      </div>
    </>
  )
}

/** The qr phase: the scan hint and the QR image. */
/** qr 阶段：扫码提示与二维码图。 */
function QrPhase(props: {
  readonly t: Translate
  readonly qrData: string | undefined
  readonly note: string | undefined
}): React.JSX.Element {
  const { t, qrData, note } = props
  return (
    <>
      <p className="im-muted">{t('cloudAuthScan')}</p>
      {qrData !== undefined && <img className="im-qr" src={qrData} alt="QR" width={260} height={260} />}
      {note !== undefined && <p className="im-error" role="alert">{note}</p>}
    </>
  )
}

/** The verify phase: the code input and the submit button. */
/** verify 阶段：验证码输入与提交按钮。 */
function VerifyPhase(props: {
  readonly t: Translate
  readonly code: string
  readonly busy: boolean
  readonly note: string | undefined
  readonly onCode: (code: string) => void
  readonly onSubmit: () => void
}): React.JSX.Element {
  const { t, code, busy, note } = props
  return (
    <>
      <p className="im-muted">{t('cloudAuthVerifyHint')}</p>
      <div className="im-rename-row">
        <input className="im-input" value={code} inputMode="numeric" placeholder={t('cloudAuthCodePlaceholder')}
          onChange={event => props.onCode(event.target.value)} />
        <button type="button" className="im-button im-button-primary" disabled={busy || code.trim() === ''}
          onClick={props.onSubmit}>{t('cloudAuthVerifySubmit')}</button>
      </div>
      {note !== undefined && <p className="im-error" role="alert">{note}</p>}
    </>
  )
}
