/**
 * The intake dock: the overdue fleeting cards, pinned under the canvas, each
 * with the two exits at hand — promote (into a permanent card) or trash. The
 * throw-away stays a conscious terminal action: the trash button arms on the
 * first click and acts on the second, exactly like the editor's delete.
 *
 * A long queue collapses to its count line: past three overdue cards the list
 * costs more canvas height than it returns, so it waits behind one expand
 * button until the reader asks for it.
 *
 * 进料口：过期的闪念卡，钉在画布下方，每张的两个出口都在手边——炼成永久卡，
 * 或扔掉。「扔」保持为有意识的终局动作：扔键第一次点击只挂确认，第二次才执行，
 * 与编辑器的删除同款。
 *
 * 长队列收成计数行：过期超过三张时，列表吃掉的画布高度超过它的价值，因此藏在
 * 一个展开钮后面，等读者自己要看。
 *
 * @module @veren/notebook-ui/client/canvas-dock
 */

import { useState } from 'react'
import { agingLabelOf, agingText } from './aging.ts'
import { dockView } from './canvas-dock-fold.ts'
import type { CanvasNodeView } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Everything the dock renders and the two intents it hands back. */
export interface CanvasDockProps {
  readonly t: (key: NotebookKey) => string
  /** The overdue fleeting cards, oldest first (the graph face's order). 过期的闪念卡，最早优先（图面的顺序）。 */
  readonly overdue: readonly CanvasNodeView[]
  readonly busy: boolean
  readonly onPromote: (id: string) => void
  readonly onTrash: (id: string) => void
}

/** The trash button: the first click arms, the second fires. 「扔」键：第一次点击挂确认，第二次执行。 */
function TrashButton({ t, id, busy, armed, onArm, onFire }: {
  readonly t: (key: NotebookKey) => string
  readonly id: string
  readonly busy: boolean
  readonly armed: boolean
  readonly onArm: (id: string | undefined) => void
  readonly onFire: (id: string) => void
}): React.ReactElement {
  return (
    <button
      type="button" className={`notebook-btn${armed ? ' is-danger' : ''}`}
      disabled={busy}
      onClick={() => {
        if (armed) {
          onArm(undefined)
          onFire(id)
        } else {
          onArm(id)
        }
      }}
    >
      {armed ? t('confirmDelete') : t('trash')}
    </button>
  )
}

/** One dock row: the title, aging chip, and the two exits. 一行进料：标题、老化章、两个出口。 */
function DockRow({ t, node, busy, armed, onPromote, onTrash, onArm }: {
  readonly t: (key: NotebookKey) => string
  readonly node: CanvasNodeView
  readonly busy: boolean
  readonly armed: boolean
  readonly onPromote: (id: string) => void
  readonly onTrash: (id: string) => void
  readonly onArm: (id: string | undefined) => void
}): React.ReactElement {
  const aging = node.expiresAt !== undefined ? agingLabelOf(node.expiresAt, Date.now()) : undefined
  return (
    <li className="notebook-dock-row">
      <span className="notebook-dock-title">{node.title}</span>
      {aging !== undefined && (
        <span className="notebook-canvas-node-aging is-overdue">{agingText(aging, t)}</span>
      )}
      <span className="notebook-dock-actions">
        <button
          type="button" className="notebook-btn is-accent"
          disabled={busy} onClick={() => { onPromote(node.id) }}
        >
          {t('promote')}
        </button>
        <TrashButton
          t={t} id={node.id} busy={busy} armed={armed} onArm={onArm}
          onFire={onTrash}
        />
      </span>
    </li>
  )
}

/** The dock's count line: title, count, hint while compact, and the queue's
 * expand/collapse switch when it is long enough to fold. 进料口的计数行：标题、
 * 计数、紧凑时的提示，以及长到可折叠时的展开/收起开关。 */
function DockHead({ t, count, folded, expanded, onToggle }: {
  readonly t: (key: NotebookKey) => string
  readonly count: number
  readonly folded: boolean
  readonly expanded: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  return (
    <div className="notebook-dock-head">
      <span>{t('intakeTitle')}</span>
      <span className="notebook-dock-count">{count}</span>
      {!folded && <span className="notebook-dock-hint">{t('intakeHint')}</span>}
      {folded && (
        <button
          type="button" className="notebook-btn notebook-dock-toggle"
          aria-expanded={expanded} onClick={onToggle}
        >
          {expanded ? t('dockCollapse') : t('dockExpand')}
        </button>
      )}
    </div>
  )
}

/** The queue's rows: one dock row per overdue card, in the face's order. 队列各行：每张过期卡一行，顺序同图面。 */
function DockRows({ t, rows, busy, armedId, onPromote, onTrash, onArm }: {
  readonly t: (key: NotebookKey) => string
  readonly rows: readonly CanvasNodeView[]
  readonly busy: boolean
  readonly armedId: string | undefined
  readonly onPromote: (id: string) => void
  readonly onTrash: (id: string) => void
  readonly onArm: (id: string | undefined) => void
}): React.ReactElement {
  return (
    <ul className="notebook-dock-rows">
      {rows.map(node => (
        <DockRow
          key={node.id}
          t={t}
          node={node}
          busy={busy}
          armed={armedId === node.id}
          onPromote={onPromote}
          onTrash={onTrash}
          onArm={onArm}
        />
      ))}
    </ul>
  )
}

/** Whether the queue folds, and whether its rows show right now. 队列是否折叠、此刻是否显示各行。 */

/** Render the intake dock; nothing renders while the queue is empty. */
export function CanvasDock(props: CanvasDockProps): React.ReactElement | null {
  const [armedId, setArmedId] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  if (props.overdue.length === 0) return null
  const { folded, showRows } = dockView(props.overdue.length, expanded)
  const toggle = (): void => {
    setExpanded(value => !value)
    setArmedId(undefined)
  }
  return (
    <section className={`notebook-dock${showRows ? '' : ' is-folded'}`} aria-label={props.t('intakeTitle')}>
      <DockHead
        t={props.t}
        count={props.overdue.length}
        folded={folded}
        expanded={expanded}
        onToggle={toggle}
      />
      {showRows && (
        <DockRows
          t={props.t}
          rows={props.overdue}
          busy={props.busy}
          armedId={armedId}
          onPromote={props.onPromote}
          onTrash={props.onTrash}
          onArm={setArmedId}
        />
      )}
    </section>
  )
}
