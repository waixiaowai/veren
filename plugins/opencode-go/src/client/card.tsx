/**
 * 设置 → 模型 页脚的 OpenCode Go 登录卡片。组件只吃框架派生 props（铁律
 * 八/十）：状态走 `useOg` 可观察席位，动作是 owner site 穿下来的回调，文案
 * 走 PropsLocale。
 * The OpenCode Go sign-in card in the Models settings footer. The component
 * consumes framework-derived props only (iron laws eight/ten): state rides
 * the `useOg` observable seat, actions are callbacks threaded from the owner
 * site, and copy comes through PropsLocale.
 *
 * @module @veren/opencode-go/client/card
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OgKey } from './locales.ts'
import type { OgDescribe, OgPoll } from './remote.ts'

/** owner site 注入面。The owner-site inject face. */
export interface OgCardInjected {
  hooks: {
    /** describe+poll 合成的单一可观察状态。One observable over describe+poll. */
    og: HostObservable<OgCardSnapshot>
  }
  onStart: (method: string | undefined) => void
  onAnswer: (value: string) => void
  onCancel: () => void
  onDismiss: () => void
}

/** 卡片的合成状态。The card's composed snapshot. */
export interface OgCardSnapshot {
  readonly describe: OgDescribe | undefined
  readonly poll: OgPoll | undefined
  readonly error: string
}

/** Props of {@link OpencodeGoCard}, derived from the framework shares. */
export type OgCardProps = PropsRuntime<'settings.models.footer'>
  & InjectFace<OgCardInjected>
  & PropsLocale<'opencode-go'>

/** 卡片本体：未登录 = 登录按钮；进行中 = 通知 + 提问框；终局 = 横幅。The card: unsigned = a button; in flight = notices + the prompt; settled = a banner. */
export function OpencodeGoCard(props: OgCardProps) {
  const snapshot = props.useOg((state: OgCardSnapshot) => state)
  const t = props.t
  const describe = snapshot.describe
  const poll = snapshot.poll
  const inFlight = poll?.inFlight === true
  const settled = poll?.settled
  const prompt = poll?.prompt

  return (
    <section className="og-card" data-state={inFlight ? 'in-flight' : describe?.signedIn ? 'signed-in' : 'signed-out'}>
      <header className="og-head">
        <strong>{describe?.label ?? 'OpenCode Go'}</strong>
        <span className={describe?.signedIn ? 'og-badge og-badge-ok' : 'og-badge'}>
          {describe === undefined ? '' : describe.signedIn ? t('signedIn') : t('notSignedIn')}
        </span>
      </header>
      {snapshot.error.length > 0 && <p className="og-error">{snapshot.error}</p>}
      {settled !== undefined && (
        <p className={settled.status === 'authorized' ? 'og-settle og-settle-ok' : 'og-settle'}>
          {settled.status === 'authorized' ? t('authorizedDone') : t('cancelledDone')}
          {' '}
          <button type="button" className="og-link" onClick={() => props.onDismiss()}>{t('close')}</button>
        </p>
      )}
      {!inFlight && settled === undefined && (
        <div className="og-methods">
          {(describe?.methods ?? []).map((entry) => (
            <button key={entry.id} type="button" className="og-primary" onClick={() => props.onStart(entry.id)}>
              {entry.label}
            </button>
          ))}
          {(describe?.methods ?? []).length === 0 && (
            <button type="button" className="og-primary" onClick={() => props.onStart(undefined)}>
              {describe?.signedIn === true ? t('reSignIn') : t('signIn')}
            </button>
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
              <button type="submit">{t('submit')}</button>
            </form>
          )}
          <button type="button" className="og-link" onClick={() => props.onCancel()}>{t('cancel')}</button>
        </div>
      )}
    </section>
  )
}

void ({} as Record<OgKey, string>)
