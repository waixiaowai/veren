/**
 * The bindings tab: every conversation binding, plus one-click linking for the
 * conversations an inbound message has already revealed but nobody linked.
 *
 * 绑定页签：全部会话绑定，外加对「入站已见过但尚未接入」会话的一键接入。
 *
 * @module @veren/im-ui/client/views-bindings
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'

/** The bindings tab body. */
export function BindingsView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const linked = new Set(state.catalog.bindings.map(binding => binding.conversationId))
  const unlinked = state.catalog.conversations.filter(conversation => !linked.has(conversation.id))
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('bindings')}</h2>
      <p className="im-muted">{t('bindingsHint')}</p>
      {state.catalog.bindings.length === 0 && <p className="im-muted">{t('noBindings')}</p>}
      <ul className="im-list">
        {state.catalog.bindings.map(binding => (
          <li key={binding.id} className="im-item">
            <span className="im-strong">{binding.conversationId}</span>
            <span className="im-arrow">→</span>
            <span>{binding.sessionId}</span>
            <span className={binding.active ? 'im-badge im-badge-on' : 'im-badge'}>
              {binding.active ? t('active') : t('inactive')}
            </span>
            <button type="button" className="im-button im-button-danger" onClick={() => actions.onUnbindBinding(binding.id)}>
              {t('unbindBinding')}
            </button>
          </li>
        ))}
      </ul>
      <h2 className="im-heading">{t('unlinked')}</h2>
      <p className="im-muted">{t('unlinkedHint')}</p>
      {unlinked.length === 0 && <p className="im-muted">{t('noUnlinked')}</p>}
      <ul className="im-list">
        {unlinked.map(conversation => (
          <li key={conversation.id} className="im-item">
            <span className="im-strong">{conversation.id}</span>
            <span className="im-badge">{conversation.accountId.slice(0, 18)}</span>
            <button type="button" className="im-button im-button-primary" onClick={() => actions.onLink(conversation.id)}>
              {t('connect')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
