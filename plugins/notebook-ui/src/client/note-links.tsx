/**
 * The selected card's link sections: outgoing and incoming, fetched on
 * selection change.
 *
 * A presentation component over one callback from the inject face — it holds
 * only its own fetch state and never talks to `ctx`. Every state is stated
 * honestly: no selection, a new draft, loading, a refusal, an empty pair of
 * directions.
 *
 * 选中卡片的链接两段：出链与反链，选择变化即取。
 *
 * 注入面单一回调之上的展示组件——只持有自己的取数状态，绝不碰 `ctx`。每种状态都
 * 如实说明：未选中、新建草稿、读取中、被拒、两向皆空。
 *
 * @module @veren/notebook-ui/client/note-links
 */

import { useEffect, useRef, useState } from 'react'
import type { NotebookKey } from './locales.ts'
import type { CardLinkView } from './remote.ts'

/** Everything the sections render and the callbacks they need. 两段渲染所需的一切与所需回调。 */
export interface NoteLinksProps {
  readonly t: (key: NotebookKey) => string
  readonly owner: string | undefined
  readonly selectedId: string | undefined
  readonly editingNew: boolean
  readonly fetchLinks: (input: { readonly owner: string; readonly id: string }) => Promise<CardLinkView>
  /** Open one linked card in the editor — the follow-a-link gesture. 在编辑器里打开某张链接卡——「顺链接走」的动作。 */
  readonly onOpenCard: (id: string) => void
}

/** 段内状态：读取中 / 两向 / 失败说明。The section state: loading / both directions / a failure line. */
type LinksState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly links: CardLinkView }
  | { readonly kind: 'failed'; readonly message: string }

/** 选中卡的链接两向：选择变化即取，其余时刻不动。
 * The selected card's two link directions: fetched on selection change, untouched otherwise. */
function useCardLinks(owner: string | undefined, selectedId: string | undefined, editingNew: boolean, fetchLinks: NoteLinksProps['fetchLinks']): LinksState {
  const [state, setState] = useState<LinksState>({ kind: 'idle' })
  // The fetch callback rides a ref: it is an action, not data. Keying the
  // effect on the callback's identity refetched cardLinks on every render —
  // together with the owner-reset loop this stormed the endpoint until the
  // browser exhausted its socket pool.
  // 拉取回调走 ref：它是动作，不是数据。把回调身份放进 effect 依赖会让 cardLinks
  // 每次渲染都重取——与归属重置循环叠加后把端点打成风暴，直到浏览器 socket 池耗尽。
  const fetchRef = useRef(fetchLinks)
  fetchRef.current = fetchLinks
  useEffect(() => {
    if (owner === undefined || selectedId === undefined || editingNew) {
      setState({ kind: 'idle' })
      return
    }
    let live = true
    setState({ kind: 'loading' })
    fetchRef.current({ owner, id: selectedId })
      .then((links) => { if (live) setState({ kind: 'ready', links }) })
      .catch((cause: unknown) => {
        if (!live) return
        const message = cause instanceof Error ? cause.message : String(cause)
        setState({ kind: 'failed', message })
      })
    return () => { live = false }
  }, [owner, selectedId, editingNew])
  return state
}

/** Render the selected card's two link directions. 渲染选中卡片的两个链接方向。 */
export function NoteLinks(props: NoteLinksProps): React.ReactElement | null {
  const { t, owner, selectedId, editingNew, fetchLinks, onOpenCard } = props
  const state = useCardLinks(owner, selectedId, editingNew, fetchLinks)
  if (state.kind === 'idle') return null
  return (
    <section className="notebook-links" aria-label={t('linksTitle')}>
      <h3 className="notebook-links-title">{t('linksTitle')}</h3>
      {state.kind === 'loading' && <p className="notebook-links-hint">{t('linksLoading')}</p>}
      {state.kind === 'failed' && <p className="notebook-links-hint">{`${t('linksFailed')} ${state.message}`}</p>}
      {state.kind === 'ready' && (
        <>
          <LinkRows label={t('outgoing')} empty={t('outgoingEmpty')} onOpenCard={onOpenCard} rows={state.links.outgoing.map(row => ({
            key: row.targetId, title: row.targetTitle, id: row.targetId, excerpt: undefined,
          }))} />
          <LinkRows label={t('incoming')} empty={t('incomingEmpty')} onOpenCard={onOpenCard} rows={state.links.incoming.map(row => ({
            key: row.sourceId, title: row.sourceTitle, id: row.sourceId, excerpt: row.excerpt,
          }))} />
        </>
      )}
    </section>
  )
}

/** Props of {@link LinkRows}. */
interface LinkRowsProps {
  readonly label: string
  readonly empty: string
  /** Open the clicked card in the editor — the follow-a-link gesture. 在编辑器里打开被点的卡——「顺链接走」的动作。 */
  readonly onOpenCard: (id: string) => void
  readonly rows: readonly { readonly key: string; readonly title: string; readonly id: string; readonly excerpt: string | undefined }[]
}

/** One direction's rows — buttons, since following a link is the method's core gesture — or its honest empty line. 一个方向的行——按钮，因为顺链接走是方法的核心动作——或如实的空态行。 */
function LinkRows(props: LinkRowsProps): React.ReactElement {
  if (props.rows.length === 0) return <p className="notebook-links-hint">{props.empty}</p>
  return (
    <div className="notebook-links-group">
      <h4 className="notebook-links-label">{props.label}</h4>
      <ul className="notebook-links-rows">
        {props.rows.map(row => (
          <li key={row.key} className="notebook-links-row">
            <button type="button" className="notebook-links-open" aria-label={row.title}
              onClick={() => { props.onOpenCard(row.id) }}>
              <span className="notebook-links-title-text">{row.title}</span>
              <span className="notebook-links-id">{row.id}</span>
              {row.excerpt !== undefined && <span className="notebook-links-excerpt">{row.excerpt}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
