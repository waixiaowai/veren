/**
 * 设置 → 模型 页脚的 OpenCode Go 登录卡片。组件只吃框架派生 props（铁律
 * 八/十）；五态状态机驱动，每态至多一个主动作；主按钮 = 自动获取（开浏览器
 * + 监听本机 CLI），粘贴为次级链接；视觉完全采用原生提供商行方言。渲染按
 * 职责拆成子组件：头部、提示区、方法选择、进行中面板（含提问表单）。
 * The OpenCode Go sign-in card in the Models settings footer. Framework-derived
 * props only (iron laws eight/ten); a five-state machine drives the card with
 * at most one primary action per state; the main button is the auto path
 * (browser + local-CLI watch) with paste demoted to a secondary link; the
 * native provider-row dialect throughout. Rendering is split by responsibility
 * into sub-components: header, notices, method picker, in-flight panel (with
 * the prompt form).
 *
 * @module @veren/opencode-go/client/card
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { humanizeSignInError, type OgKey } from './locales.ts'
import type { OgDescribe, OgPoll } from './remote.ts'

/** owner site 注入面。The owner-site inject face. */
export interface OgCardInjected {
  hooks: {
    og: HostObservable<OgCardSnapshot>
  }
  /** 主路径：开浏览器 + 宿主自动监听导入。The auto path: browser + host-side watch. */
  onStartAuto: () => void
  /** 手动方法的某一次（粘贴 / 本机导入）。One manual method (paste / local import). */
  onStart: (method: string) => void
  /** 重接尝试或恢复传输轮询。Re-attaches to a running attempt or restores polling. */
  onAttach: () => void
  onAnswer: (value: string) => void
  onCancel: () => void
  onDismiss: () => void
  onSignOut: () => void
  onTogglePaste: () => void
}

/** 卡片的合成状态。The card's composed snapshot. */
export interface OgCardSnapshot {
  readonly describe: OgDescribe | undefined
  readonly poll: OgPoll | undefined
  readonly error: string
  readonly errorCode: string | undefined
  readonly pasteOpen: boolean
}

/** Props of {@link} OpencodeGoCard, derived from the framework shares. */
export type OgCardProps = PropsRuntime<'settings.models.footer'>
  & InjectFace<OgCardInjected>
  & PropsLocale<'opencode-go'>

/** 卡片头部：身份行与取消/登出动作。The card header: the identity row plus the cancel/sign-out actions. */
function CardHeader({ describe, inFlight, signedIn, settled, t, onCancel, onSignOut }: {
  describe: OgDescribe | undefined
  inFlight: boolean
  signedIn: boolean
  settled: OgPoll['settled']
  t: (key: OgKey) => string
  onCancel: () => void
  onSignOut: () => void
}) {
  return (
    <header className="og-head">
      <div className="og-identity">
        <span className="og-name">{describe?.label ?? 'OpenCode Go'}</span>
        {!inFlight && !signedIn && <span className="og-dot og-dot-missing" />}
        <span className={inFlight ? 'og-status' : signedIn ? 'og-status og-status-ok' : 'og-status'}>
          {inFlight ? t('signingIn') : signedIn ? t('signedIn') : t('notSignedIn')}
        </span>
      </div>
      <div className="og-actions">
        {inFlight && <button type="button" className="og-button" onClick={() => onCancel()}>{t('cancel')}</button>}
        {!inFlight && settled === undefined && signedIn && (
          <button type="button" className="og-danger" onClick={() => onSignOut()}>{t('signOut')}</button>
        )}
      </div>
    </header>
  )
}

/** 提示区：传输错误、自动超时、失败与终局。The notice area: transport error, auto timeout, failure, and settlement. */
function CardNotices({ snapshot, poll, inFlight, t, errorText, onAttach, onDismiss }: {
  snapshot: OgCardSnapshot
  poll: OgPoll | undefined
  inFlight: boolean
  t: (key: OgKey) => string
  errorText: string
  onAttach: () => void
  onDismiss: () => void
}) {
  return (
    <>
      {snapshot.errorCode === 'TRANSPORT' && (
        <p className="og-error">
          {errorText}
          {' '}
          <button type="button" className="og-link" onClick={() => onAttach()}>{t('retry')}</button>
        </p>
      )}
      {poll?.autoTimedOut === true && !inFlight && (
        <p className="og-notice">{t('autoTimedOut')}</p>
      )}
      {poll?.failed !== undefined && !inFlight && (
        <p className="og-error">
          {humanizeSignInError(poll.failed.code, poll.failed.message, t) ?? poll.failed.message}
        </p>
      )}
      {poll?.settled !== undefined && (
        <p className={poll.settled.status === 'authorized' ? 'og-settle og-settle-ok' : 'og-settle'}>
          {poll.settled.status === 'authorized'
            ? (poll?.autoImported === true ? t('autoImported') : t('authorizedDone'))
            : t('cancelledDone')}
          {' '}
          <button type="button" className="og-link" onClick={() => onDismiss()}>{t('close')}</button>
        </p>
      )}
    </>
  )
}

/** 方法选择：自动获取主按钮 + 粘贴展开的手动方法。The method picker: the auto primary button + the pasted manual methods. */
function MethodPicker({ describe, pasteOpen, t, onStartAuto, onStart, onTogglePaste }: {
  describe: OgDescribe | undefined
  pasteOpen: boolean
  t: (key: OgKey) => string
  onStartAuto: () => void
  onStart: (method: string) => void
  onTogglePaste: () => void
}) {
  return (
    <div className="og-methods">
      <button type="button" className="og-button og-primary" onClick={() => onStartAuto()}>
        {t('signIn')}
      </button>
      {pasteOpen ? (
        (describe?.methods ?? []).map((entry) => (
          <button key={entry.id} type="button" className="og-button" onClick={() => onStart(entry.id)}>
            {methodCopy(entry.id, t)}
          </button>
        ))
      ) : (
        <button type="button" className="og-link" onClick={() => onTogglePaste()}>{t('pasteManually')}</button>
      )}
    </div>
  )
}

/** 提问表单：文本/密文输入与提交。The prompt form: a text/secret input and its submit. */
function PromptForm({ prompt, t, onAnswer }: {
  prompt: NonNullable<OgPoll['prompt']>
  t: (key: OgKey) => string
  onAnswer: (value: string) => void
}) {
  return (
    <form className="og-answer" onSubmit={(event) => {
      event.preventDefault()
      const input = (event.currentTarget as HTMLFormElement).querySelector('input')
      const value = input?.value ?? ''
      if (value.length > 0) onAnswer(value)
    }}>
      <label>
        <span>{t('answerPrompt')}</span>
        <input
          type={prompt.kind === 'secret' ? 'password' : 'text'}
          placeholder={prompt.placeholder ?? ''}
          required
        />
      </label>
      <button type="submit" className="og-button">{t('submit')}</button>
    </form>
  )
}

/** 进行中面板：通知流、等待浏览器提示与待答提问。The in-flight panel: the notice stream, the browser hint, and the open prompt. */
function InFlightPanel({ poll, t, onAnswer }: {
  poll: OgPoll | undefined
  t: (key: OgKey) => string
  onAnswer: (value: string) => void
}) {
  return (
    <div className="og-flight">
      {(poll?.notices ?? []).map((notice, index) => (
        <p className="og-notice" key={index}>
          {notice.message}
          {notice.url !== undefined && <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>}
        </p>
      ))}
      {poll?.autoWaiting === true && <p className="og-notice">{t('waitingBrowser')}</p>}
      {poll?.prompt !== undefined && <PromptForm prompt={poll.prompt} t={t} onAnswer={onAnswer} />}
    </div>
  )
}

/** method.id → 客户端文案（locale 持有归属权）；未知 id 回退「登录」。 */
function methodCopy(id: string, t: (key: OgKey) => string): string {
  if (id === 'console-key') return t('methodConsoleKey')
  if (id === 'import-local-cli') return t('methodImportLocal')
  return t('signIn')
}

/** 卡片本体。状态机：未登录（自动主按钮+粘贴次级）→ 登录中（通知+提问+取消）→ 终局/失败/超时。 */
export function OpencodeGoCard(props: OgCardProps) {
  const snapshot = props.useOg((state: OgCardSnapshot) => state)
  const t = props.t
  const describe = snapshot.describe
  const poll = snapshot.poll
  const inFlight = poll?.inFlight === true
  const signedIn = describe?.signedIn === true
  const settled = poll?.settled
  const errorText = snapshot.errorCode === 'TRANSPORT'
    ? t('transportDown')
    : humanizeSignInError(poll?.failed?.code, poll?.failed?.message ?? snapshot.error, t) ?? snapshot.error

  return (
    <section className="og-card" data-state={inFlight ? 'in-flight' : signedIn ? 'signed-in' : 'signed-out'}>
      <CardHeader describe={describe} inFlight={inFlight} signedIn={signedIn} settled={settled}
        t={t} onCancel={() => props.onCancel()} onSignOut={() => props.onSignOut()} />
      <CardNotices snapshot={snapshot} poll={poll} inFlight={inFlight} t={t} errorText={errorText}
        onAttach={() => props.onAttach()} onDismiss={() => props.onDismiss()} />
      {!inFlight && settled === undefined && !signedIn && (
        <MethodPicker describe={describe} pasteOpen={snapshot.pasteOpen} t={t}
          onStartAuto={() => props.onStartAuto()} onStart={(method) => props.onStart(method)}
          onTogglePaste={() => props.onTogglePaste()} />
      )}
      {inFlight && <InFlightPanel poll={poll} t={t} onAnswer={(value) => props.onAnswer(value)} />}
    </section>
  )
}
