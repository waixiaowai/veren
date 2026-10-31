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

/** The unauthorized channel's activation funnel card. */
/** 未授权通道的激活漏斗卡。 */
export function AuthorizeFunnel(props: {
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
        {phase === 'idle' && <IdlePhase t={t} session={session} denied={denied} note={note} busy={busy} onStart={() => void start()} />}
        {phase === 'qr' && <QrPhase t={t} qrData={qrData} note={note} />}
        {phase === 'verify' && <VerifyPhase t={t} code={code} busy={busy} note={note}
          onCode={setCode} onSubmit={() => void submitCode()} />}
      </div>
    </div>
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
