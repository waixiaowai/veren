/**
 * The empty state: an illustration, a title, a hint that names the next step,
 * and at most one primary action (design §23.5: empty states say what this is,
 * why it is empty, and what to do next — never "no data").
 *
 * 空态：插画、标题、说明下一步的提示，以及最多一个主操作（设计 §23.5：空态写用途、
 * 为什么空、下一步，不写「暂无数据」）。
 *
 * @module @veren/im-ui/client/empty-state
 */

/** A speech-bubble pair, drawn once and tinted by the token layer. */
function EmptyArt(): React.JSX.Element {
  return (
    <svg className="im-empty-art" viewBox="0 0 96 72" width="96" height="72" fill="none" aria-hidden="true">
      <rect x="8" y="10" width="52" height="34" rx="12" className="im-empty-art-fill" />
      <path d="M20 44v10l12-10" className="im-empty-art-fill" />
      <rect x="34" y="28" width="54" height="32" rx="12" className="im-empty-art-line" />
      <path d="M76 60v8l-11-8" className="im-empty-art-line" />
      <circle cx="49" cy="44" r="2.5" className="im-empty-art-dot" />
      <circle cx="58" cy="44" r="2.5" className="im-empty-art-dot" />
      <circle cx="67" cy="44" r="2.5" className="im-empty-art-dot" />
    </svg>
  )
}

/** One empty state block. */
export function EmptyState(props: {
  readonly title: string
  readonly hint: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="im-empty">
      <EmptyArt />
      <h3 className="im-empty-title">{props.title}</h3>
      <p className="im-empty-hint">{props.hint}</p>
      {props.actionLabel !== undefined && props.onAction !== undefined && (
        <button type="button" className="im-button im-button-primary" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      )}
    </div>
  )
}
