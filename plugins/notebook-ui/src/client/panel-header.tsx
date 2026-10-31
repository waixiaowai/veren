/**
 * The notebook page's header: the page heading, the owner selector, the
 * refresh / new-note buttons, and the load-error banner with its retry. A
 * presentation component — every fact arrives via props, every action via a
 * callback. The heading, the owner selector, and the action buttons each render
 * in their own small component.
 *
 * 记事本页面的头部：页面标题、归属选择器、刷新/新建按钮，以及带重试的加载
 * 错误横幅。展示组件——事实全部经 props 到达，动作全部经回调发出。标题、归属
 * 选择器与动作按钮各自成小组件渲染。
 *
 * @module @veren/notebook-ui/client/panel-header
 */

/** The page's own notebook glyph, used in the panel header. */
function NotebookGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 2.5h8v11h-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 9h5M5.5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Props of {@link NotebookHeader}, all derived from the body's view. */
export interface NotebookHeaderProps {
  readonly heading: string
  readonly subtitle: string
  readonly ownerLabel: string
  readonly ownerHint: string
  readonly removedLabel: string
  readonly refreshLabel: string
  readonly newLabel: string
  readonly owners: ReadonlyArray<{ readonly id: string; readonly declared: boolean }>
  readonly owner: string | undefined
  readonly ownerDisabled: boolean
  readonly onChooseOwner: (owner: string) => void
  readonly onRefresh: () => void
  readonly onStartNew: () => void
}

/** The heading block: glyph + title + subtitle. 标题块：图形 + 标题 + 副标题。 */
function NotebookHeading({ heading, subtitle }: { readonly heading: string; readonly subtitle: string }) {
  return (
    <div className="notebook-heading">
      <div className="notebook-heading-row">
        <span className="notebook-mark" aria-hidden="true"><NotebookGlyph /></span>
        <h1>{heading}</h1>
      </div>
      <p>{subtitle}</p>
    </div>
  )
}

/** The owner selector: hidden while the owners list is empty.
 * 归属选择器：归属列表为空时不渲染。 */
function NotebookOwnerSelect({ label, hint, removedLabel, owners, owner, onChooseOwner }: {
  readonly label: string
  readonly hint: string
  readonly removedLabel: string
  readonly owners: ReadonlyArray<{ readonly id: string; readonly declared: boolean }>
  readonly owner: string | undefined
  readonly onChooseOwner: (owner: string) => void
}) {
  if (owners.length === 0) return null
  return (
    <label className="notebook-owner" title={hint}>
      <span>{label}</span>
      <select
        value={owner ?? ''}
        aria-label={label}
        onChange={event => { onChooseOwner(event.target.value) }}
      >
        {owners.map(one => (
          <option key={one.id} value={one.id}>
            {one.declared ? one.id : `${one.id} (${removedLabel})`}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The refresh / new-note action buttons. 刷新/新建动作按钮。 */
function NotebookActions({ refreshLabel, newLabel, ownerDisabled, onRefresh, onStartNew }: {
  readonly refreshLabel: string
  readonly newLabel: string
  readonly ownerDisabled: boolean
  readonly onRefresh: () => void
  readonly onStartNew: () => void
}) {
  return (
    <>
      <button type="button" className="notebook-btn" onClick={() => { onRefresh() }}>
        {refreshLabel}
      </button>
      <button type="button" className="notebook-btn is-primary" disabled={ownerDisabled} onClick={onStartNew}>
        {newLabel}
      </button>
    </>
  )
}

/** The header: heading + owner selector + refresh/new actions. */
export function NotebookHeader(props: NotebookHeaderProps) {
  return (
    <header className="notebook-header">
      <NotebookHeading heading={props.heading} subtitle={props.subtitle} />
      <div className="notebook-actions">
        <NotebookOwnerSelect
          label={props.ownerLabel}
          hint={props.ownerHint}
          removedLabel={props.removedLabel}
          owners={props.owners}
          owner={props.owner}
          onChooseOwner={props.onChooseOwner}
        />
        <NotebookActions
          refreshLabel={props.refreshLabel}
          newLabel={props.newLabel}
          ownerDisabled={props.ownerDisabled}
          onRefresh={props.onRefresh}
          onStartNew={props.onStartNew}
        />
      </div>
    </header>
  )
}

/** Props of the load-error banner. */
export interface NotebookErrorBannerProps {
  readonly failedLabel: string
  readonly error: string
  readonly retryLabel: string
  readonly onRefresh: () => void
}

/** The load-error banner with its retry button. */
export function NotebookErrorBanner(props: NotebookErrorBannerProps) {
  return (
    <div className="notebook-banner" role="alert">
      <span>{props.failedLabel}: {props.error}</span>
      <button type="button" className="notebook-btn" onClick={() => { props.onRefresh() }}>
        {props.retryLabel}
      </button>
    </div>
  )
}
