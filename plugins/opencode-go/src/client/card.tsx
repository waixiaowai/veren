/**
 * 设置 → 模型 页脚的 OpenCode Go 登录卡片。组件只吃框架派生 props（铁律
 * 八/十）；五态状态机驱动：未登录 / 登录中 / 终局 / 错误，每态至多一个
 * 主动作；视觉完全采用原生提供商行方言，颜色全走 shell 令牌。
 * The OpenCode Go sign-in card in the Models settings footer. Framework-derived
 * props only (iron laws eight/ten); a five-state machine drives the card —
 * signed out / signing in / settled / error — at most one primary action per
 * state, native provider-row dialect, shell tokens only.
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
    /** describe+poll 合成的单一可观察状态。One observable over describe+poll. */
    og: HostObservable<OgCardSnapshot>
  }
  onStart: (method: string) => void
  /** 重接一次已在进行的尝试（ALREADY_IN_FLIGHT 的唯一正解）。Re-attaches to a running attempt (the only right answer to ALREADY_IN_FLIGHT). */
  onAttach: () => void
  onAnswer: (value: string) => void
  onCancel: () => void
  onDismiss: () => void
  onSignOut: () => void
}

/** 卡片的合成状态。The card's composed snapshot. */
export interface OgCardSnapshot {
  readonly describe: OgDescribe | undefined
  readonly poll: OgPoll | undefined
  readonly error: string
  readonly errorCode: string | undefined
}

/** Props of {@link OpencodeGoCard}, derived from the framework shares. */
export type OgCardProps = PropsRuntime<'settings.models.footer'>
  & InjectFace<OgCardInjected>
  & PropsLocale<'opencode-go'>

/** 卡片本体。状态机：未登录 → 方法按钮；登录中 → 通知+提问+取消；终局 → 横幅；错误 → 人话+继续。 */
export function OpencodeGoCard(props: OgCardProps) {
  const snapshot = props.useOg((state: OgCardSnapshot) => state)
  const t = props.t
  const describe = snapshot.describe
  const poll = snapshot.poll
  const inFlight = poll?.inFlight === true
  const settled = poll?.settled
  const prompt = poll?.prompt
  const errorText = humanizeSignInError(snapshot.errorCode, snapshot.error, t) ?? snapshot.error
  const signedIn = describe?.signedIn === true

  return (
    <section className="og-card" data-state={inFlight ? 'in-flight' : signedIn ? 'signed-in' : 'signed-out'}>
      <header className="og-head">
        <div className="og-identity">
          <span className="og-name">{describe?.label ?? 'OpenCode Go'}</span>
          {!inFlight && !signedIn && <span className="og-dot og-dot-missing" />}
          {!inFlight && (
            <span className={signedIn ? 'og-status og-status-ok' : 'og-status'}>
              {inFlight ? t('signingIn') : signedIn ? t('signedIn') : t('notSignedIn')}
            </span>
          )}
          {inFlight && <span className="og-status">{t('signingIn')}</span>}
        </div>
        <div className="og-actions">
          {inFlight && <button type="button" className="og-button" onClick={() => props.onCancel()}>{t('cancel')}</button>}
          {!inFlight && settled === undefined && signedIn && (
            <button type="button" className="og-danger" onClick={() => props.onSignOut()}>{t('signOut')}</button>
          )}
        </div>
      </header>
      {!inFlight && settled === undefined && !signedIn && (
        <div className="og-methods">
          {(describe?.methods ?? []).map((entry) => (
            <button key={entry.id} type="button" className="og-button" onClick={() => props.onStart(entry.id)}>
              {methodCopy(entry.id, t)}
            </button>
          ))}
        </div>
      )}
      {snapshot.error.length > 0 && (
        <p className="og-error">
          {errorText}
          {snapshot.errorCode === 'ALREADY_IN_FLIGHT' && (
            <button type="button" className="og-link" onClick={() => props.onAttach()}>{t('continueAttach')}</button>
          )}
        </p>
      )}
      {inFlight && (
        <div className="og-flight">
          {(poll?.notices ?? []).map((notice, index) => (
            <p className="og-notice" key={index}>
              {notice.message}
              {notice.url !== undefined && <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>}
            </p>
          ))}
          {prompt !== undefined && (
            <form className="og-answer" onSubmit={(event) => {
              event.preventDefault()
              const input = (event.currentTarget as HTMLFormElement).querySelector('input')
              const value = input?.value ?? ''
              if (value.length > 0) props.onAnswer(value)
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
          )}
        </div>
      )}
      {settled !== undefined && (
        <p className={settled.status === 'authorized' ? 'og-settle og-settle-ok' : 'og-settle'}>
          {settled.status === 'authorized' ? t('authorizedDone') : t('cancelledDone')}
          {' '}
          <button type="button" className="og-link" onClick={() => props.onDismiss()}>{t('close')}</button>
        </p>
      )}
    </section>
  )
}

/** method.id → 客户端文案（locale 持有归属权）；未知 id 回退流程标签由调用侧处理。 */
function methodCopy(id: string, t: (key: OgKey) => string): string {
  if (id === 'console-key') return t('methodConsoleKey')
  if (id === 'import-local-cli') return t('methodImportLocal')
  return t('signIn')
}
