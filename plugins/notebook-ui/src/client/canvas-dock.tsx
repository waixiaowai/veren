/**
 * The intake dock: the overdue fleeting cards, pinned under the canvas, each
 * with the two exits at hand — promote (into a permanent card) or trash. The
 * throw-away stays a conscious terminal action: the trash button arms on the
 * first click and acts on the second, exactly like the editor's delete.
 *
 * 进料口：过期的闪念卡，钉在画布下方，每张的两个出口都在手边——炼成永久卡，
 * 或扔掉。「扔」保持为有意识的终局动作：扔键第一次点击只挂确认，第二次才执行，
 * 与编辑器的删除同款。
 *
 * @module @veren/notebook-ui/client/canvas-dock
 */

import { useState } from 'react'
import { agingLabelOf, agingText } from './aging.ts'
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

/** Render the intake dock; nothing renders while the queue is empty. */
export function CanvasDock(props: CanvasDockProps): React.ReactElement | null {
  const [armedId, setArmedId] = useState<string | undefined>(undefined)
  if (props.overdue.length === 0) return null
  return (
    <section className="notebook-dock" aria-label={props.t('intakeTitle')}>
      <div className="notebook-dock-head">
        <span>{props.t('intakeTitle')}</span>
        <span className="notebook-dock-count">{props.overdue.length}</span>
        <span className="notebook-dock-hint">{props.t('intakeHint')}</span>
      </div>
      <ul className="notebook-dock-rows">
        {props.overdue.map(node => (
          <DockRow
            key={node.id}
            t={props.t}
            node={node}
            busy={props.busy}
            armed={armedId === node.id}
            onPromote={props.onPromote}
            onTrash={props.onTrash}
            onArm={setArmedId}
          />
        ))}
      </ul>
    </section>
  )
}
