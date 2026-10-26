/**
 * The bindings tab: who talks to which DSH Session, in people's names.
 *
 * The people directory resolves each bound conversation to a person, so a row
 * reads "杨明明 → session-b2c0" instead of a raw p2p id; the raw id survives as
 * the row's footer because support and tools still speak it.
 *
 * 绑定页签：谁在与哪个 DSH 会话对话，用人名呈现。
 *
 * 人员目录把每条被绑定的会话解析成人，行读作「杨明明 → session-b2c0」而不是裸
 * p2p id；裸 id 保留为行末小字，因为支持与工具仍按它寻址。
 *
 * @module @veren/im-ui/client/views-bindings
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import type { ImPersonView } from './remote.ts'

/** The bindings tab body. */
export function BindingsView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const names = nameDirectoryOf(state)
  const linked = new Set(state.catalog.bindings.map(binding => binding.conversationId))
  const unlinked = state.catalog.conversations.filter(conversation => !linked.has(conversation.id))
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('bindings')}</h2>
      <p className="im-muted">{t('bindingsHint')}</p>
      {state.catalog.bindings.length === 0 && <p className="im-muted">{t('noBindings')}</p>}
      <ul className="im-list">
        {state.catalog.bindings.map(binding => (
          <li key={binding.id} className="im-card">
            <span className="im-avatar">{initialOf(names.get(binding.conversationId) ?? binding.conversationId)}</span>
            <div className="im-card-body">
              <div className="im-name-row">
                <span className="im-strong">{names.get(binding.conversationId) ?? binding.conversationId}</span>
                <span className={binding.active ? 'im-badge im-badge-on' : 'im-badge'}>
                  {binding.active ? t('active') : t('inactive')}
                </span>
                <button type="button" className="im-button im-button-danger" onClick={() => actions.onUnbindBinding(binding.id)}>
                  {t('unbindBinding')}
                </button>
              </div>
              <div className="im-id-mono">{binding.conversationId} → {shortSession(binding.sessionId)}</div>
            </div>
          </li>
        ))}
      </ul>
      <h2 className="im-heading">{t('unlinked')}</h2>
      <p className="im-muted">{t('unlinkedHint')}</p>
      {unlinked.length === 0 && <p className="im-muted">{t('noUnlinked')}</p>}
      <ul className="im-list">
        {unlinked.map(conversation => (
          <li key={conversation.id} className="im-card">
            <span className="im-avatar">{initialOf(names.get(conversation.id) ?? conversation.id)}</span>
            <div className="im-card-body">
              <div className="im-name-row">
                <span className="im-strong">{names.get(conversation.id) ?? conversation.id}</span>
                <button type="button" className="im-button im-button-primary" onClick={() => actions.onLink(conversation.id)}>
                  {t('connect')}
                </button>
              </div>
              <div className="im-id-mono">{conversation.id}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * conversationId → the person's display name, from the directory's addresses.
 * 会话 id → 人员显示名，来自目录里的可达地址。
 */
function nameDirectoryOf(state: ImBodyProps['state']): Map<string, string> {
  const names = new Map<string, string>()
  for (const person of state.catalog.people) {
    for (const address of person.addresses) {
      if (!names.has(address.conversationId)) names.set(address.conversationId, person.displayName)
    }
  }
  return names
}

/** The avatar's single character. */
function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

/** A session id renders short: keep the first block of the uuid. */
function shortSession(sessionId: string): string {
  return sessionId.length <= 14 ? sessionId : sessionId.slice(0, 14) + '…'
}
