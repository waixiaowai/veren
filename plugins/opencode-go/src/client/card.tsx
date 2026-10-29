/**
 * 设置 → 模型 页脚的 OpenCode Go 登录卡片。组件只吃框架派生 props（铁律
 * 八/十）；五态状态机驱动，每态至多一个主动作；主按钮 = 自动获取（开浏览器
 * + 监听本机 CLI），粘贴为次级链接；视觉完全采用原生提供商行方言。
 * The OpenCode Go sign-in card in the Models settings footer. Framework-derived
 * props only (iron laws eight/ten); a five-state machine drives the card with
 * at most one primary action per state; the main button is the auto path
 * (browser + local-CLI watch) with paste demoted to a secondary link; the
 * native provider-row dialect throughout.
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

/** 卡片本体。状态机：未登录（自动主按钮+粘贴次级）→ 登录中（通知+提问+取消）→ 终局/失败/超时。 */
export function OpencodeGoCard(props: OgCardProps) {
  const snapshot = props.useOg((state: OgCardSnapshot) => state)
  const t = props.t
  const describe = snapshot.describe
  const poll = snapshot.poll
  const inFlight = poll?.inFlight === true
  const settled = poll?.settled
  const prompt = poll?.prompt
  const failed = poll?.failed
  const signedIn = describe?.signedIn === true
  const errorText = snapshot.errorCode === 'TRANSPORT'
    ? t('transportDown')
    : humanizeSignInError(failed?.code, failed?.message ?? snapshot.error, t) ?? snapshot.error

  return (
    <section className="og-card" data-state={inFlight ? 'in-flight' : signedIn ? 'signed-in' : 'signed-out'}>
      <header className="og-head">
        <div className="og-identity">
          <span className="og-name">{describe?.label ?? 'OpenCode Go'}</span>
          {!inFlight && !signedIn && <span className="og-dot og-dot-missing" />}
          <span className={inFlight ? 'og-status' : signedIn ? 'og-status og-status-ok' : 'og-status'}>
            {inFlight ? t('signingIn') : signedIn ? t('signedIn') : t('notSignedIn')}
          </span>
        </div>
        <div className="og-actions">
          {inFlight && <button type="button" className="og-button" onClick={() => props.onCancel()}>{t('cancel')}</button>}
          {!inFlight && settled === undefined && signedIn && (
            <button type="button" className="og-danger" onClick={() => props.onSignOut()}>{t('signOut')}</button>
          )}
        </div>
      </header>
      {snapshot.errorCode === 'TRANSPORT' && (
        <p className="og-error">
          {errorText}
          {' '}
          <button type="button" className="og-link" onClick={() => props.onAttach()}>{t('retry')}</button>
        </p>
      )}
      {poll?.autoTimedOut === true && !inFlight && (
        <p className="og-notice">{t('autoTimedOut')}</p>
      )}
      {failed !== undefined && !inFlight && (
        <p className="og-error">
          {humanizeSignInError(failed.code, failed.message, t) ?? failed.message}
        </p>
      )}
      {settled !== undefined && (
        <p className={settled.status === 'authorized' ? 'og-settle og-settle-ok' : 'og-settle'}>
          {settled.status === 'authorized'
            ? (poll?.autoImported === true ? t('autoImported') : t('authorizedDone'))
            : t('cancelledDone')}
          {' '}
          <button type="button" className="og-link" onClick={() => props.onDismiss()}>{t('close')}</button>
        </p>
      )}
      {!inFlight && settled === undefined && !signedIn && (
        <div className="og-methods">
          <button type="button" className="og-button og-primary" onClick={() => props.onStartAuto()}>
            {t('signIn')}
          </button>
          {snapshot.pasteOpen ? (
            (describe?.methods ?? []).map((entry) => (
              <button key={entry.id} type="button" className="og-button" onClick={() => props.onStart(entry.id)}>
                {methodCopy(entry.id, t)}
              </button>
            ))
          ) : (
            <button type="button" className="og-link" onClick={() => props.onTogglePaste()}>{t('pasteManually')}</button>
          )}
        </div>
      )}
      {inFlight && (
        <div className="og-flight">
          {(poll?.notices ?? []).map((notice, index) => (
            <p className="og-notice" key={index}>
              {notice.message}
              {notice.url !== undefined && <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>}
            </p>
          ))}
          {poll?.autoWaiting === true && <p className="og-notice">{t('waitingBrowser')}</p>}
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
    </section>
  )
}

/** method.id → 客户端文案（locale 持有归属权）；未知 id 回退「登录」。 */
function methodCopy(id: string, t: (key: OgKey) => string): string {
  if (id === 'console-key') return t('methodConsoleKey')
  if (id === 'import-local-cli') return t('methodImportLocal')
  return t('signIn')
}
