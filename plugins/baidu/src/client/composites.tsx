/**
 * 复合组件（设计 §11 子集）：由基础组件组合而成，负责布局与对齐，仍不取数
 * ——数据由视图层以已格式化形式传入。三条组合一致性规则：标题在最上、动作
 * 在最右；链接单独成行；提交中在原地切换文案。
 * Composite components (the design §11 subset): assembled from the basics,
 * owning layout and alignment, still fetch-free — data arrives pre-formatted
 * from the view layer. The three composition-consistency rules: title on top,
 * actions right; links on their own line; pending submits swap copy in place.
 *
 * @module @veren/baidu-pan/client/composites
 */

import { useEffect, useRef } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JSX, ReactNode } from 'react'
import {
  HintBar, KeyValueRow, LinkLine, PathText, ProgressBar, SectionHeading, StatusLabel, Table, EmptyState,
  type TableColumn, type Tone,
} from './components.tsx'

/** §11.1 ResultCard：单结果操作的统一呈现（动作、落点、路径、链接、提示）。ResultCard: the one-shot result card (action, landing, path, link, note). */
export function ResultCard(props: {
  readonly tone: Tone
  readonly title: string
  readonly rows: readonly { readonly label: string; readonly value: string }[]
  readonly path?: { readonly display: string; readonly full: string }
  readonly link?: { readonly url: string; readonly hint: string }
  readonly note?: string
  readonly copyLabel?: string
  readonly copiedLabel?: string
}): JSX.Element {
  return (
    <section className="bdp-card">
      <div className="bdp-card-head">
        <StatusLabel tone={props.tone} text={props.title} />
      </div>
      <div className="bdp-card-body">
        {props.rows.map(row => (
          <KeyValueRow key={row.label} label={row.label} value={row.value}
            copyValue={row.value.startsWith('http') ? row.value : undefined}
            copyLabel={props.copyLabel} copiedLabel={props.copiedLabel} />
        ))}
        {props.path === undefined ? null : <div className="bdp-card-path"><PathText display={props.path.display} full={props.path.full} /></div>}
        {props.link === undefined ? null : (
          <div className="bdp-card-link">
            <LinkLine url={props.link.url} hint={props.link.hint} fallbackText={props.link.hint} />
          </div>
        )}
        {props.note === undefined ? null : <HintBar text={props.note} />}
      </div>
    </section>
  )
}

/** §11.2 FileListPanel：目录浏览的统一容器（标题 + 表格 + 汇总 + 空态）。FileListPanel: the listing container (heading + table + summary + empty state). */
export function FileListPanel(props: {
  readonly title: string
  readonly columns: readonly TableColumn[]
  readonly rows: readonly Record<string, string>[]
  readonly total: number
  readonly summaryPrefix: string
  readonly summaryUnit: string
  readonly emptyTitle: string
  readonly emptyHint?: string
  readonly emptyActionLabel?: string
  readonly onEmptyAction?: () => void
  readonly loading?: boolean
  readonly onActivateRow?: (index: number) => void
  readonly renderRowActions?: (index: number) => ReactNode
}): JSX.Element {
  if (props.loading !== true && props.rows.length === 0) {
    return (
      <section className="bdp-filelist">
        <SectionHeading title={props.title} count={0} />
        <EmptyState title={props.emptyTitle} description={props.emptyHint}
          actionLabel={props.emptyActionLabel} onAction={props.onEmptyAction} />
      </section>
    )
  }
  return (
    <section className="bdp-filelist">
      <SectionHeading title={props.title} actions={
        props.loading === true ? <span className="bdp-muted">{props.summaryPrefix}…</span>
          : <span className="bdp-muted">{`${props.summaryPrefix} ${String(props.total)} ${props.summaryUnit}`}</span>
      } />
      <Table columns={props.columns} rows={props.rows} loading={props.loading}
        onRowActivate={props.onActivateRow} renderRowActions={props.renderRowActions} />
    </section>
  )
}

/** §11.4 TaskProgressPanel：异步任务的进度呈现（进行中带 StateDot 与已等待秒数）。TaskProgressPanel: async-job progress (a StateDot plus waited seconds while running). */
export function TaskProgressPanel(props: {
  readonly state: 'done' | 'warning' | 'ongoing' | 'error'
  readonly phase: string
  readonly percent?: number
  readonly detail?: string
  readonly elapsedSeconds?: number
  readonly waitingHint?: string
  readonly stateLabel: string
}): JSX.Element {
  const indeterminate = props.percent === undefined
  return (
    <section className="bdp-card">
      <div className="bdp-card-head">
        <StateDot state={props.state} />
        <span className="bdp-card-title">{props.phase}</span>
        <StatusLabel tone={props.state === 'error' ? 'danger' : props.state === 'done' ? 'success' : 'neutral'} text={props.stateLabel} />
      </div>
      <div className="bdp-card-body">
        {props.state === 'ongoing'
          ? <ProgressBar percent={props.percent ?? 0} label={props.phase} indeterminate={indeterminate} />
          : null}
        {props.detail === undefined || props.state !== 'ongoing' ? null : <KeyValueRow label="" value={props.detail} muted />}
        {props.elapsedSeconds === undefined || props.state !== 'ongoing' ? null : <KeyValueRow label="" value={`${String(props.elapsedSeconds)}s`} muted />}
        {props.state === 'ongoing' && props.waitingHint !== undefined && (props.elapsedSeconds ?? 0) > 60
          ? <HintBar text={props.waitingHint} />
          : null}
      </div>
    </section>
  )
}

/** §11.6 ConfirmDialog：高危操作的确认容器（对象清单 + 后果 + 取消在左）。ConfirmDialog: the dangerous-operation container (object list + consequence, Cancel on the left). */
export function ConfirmDialog(props: {
  readonly question: string
  readonly objects: readonly { readonly text: string; readonly kind: string }[]
  readonly consequence: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onCancel()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => { globalThis.removeEventListener('keydown', onKey) }
  }, [props])
  return (
    <div className="bdp-dialog-backdrop" role="presentation">
      <div className="bdp-dialog" role="alertdialog" aria-modal="true" aria-label={props.question}>
        <p className="bdp-dialog-question">{props.question}</p>
        <ObjectList objects={props.objects} />
        <p className="bdp-dialog-consequence">{props.consequence}</p>
        <div className="bdp-dialog-actions">
          <button type="button" ref={cancelRef} className="bdp-button" disabled={props.busy === true} onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button type="button" className="bdp-button bdp-button-danger" disabled={props.busy === true} onClick={props.onConfirm}>
            {props.busy === true ? '…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 对象清单：最多 8 行，其余折叠计数（设计 §11.6）。The object list: at most 8 rows, the rest folded into a count (design §11.6). */
function ObjectList(props: { readonly objects: readonly { readonly text: string; readonly kind: string }[] }): JSX.Element {
  const visible = props.objects.slice(0, 8)
  const hidden = props.objects.length - visible.length
  return (
    <>
      <ul className="bdp-dialog-objects">
        {visible.map(object => (
          <li key={object.text}><span className="bdp-muted">{`[${object.kind}]`}</span> {object.text}</li>
        ))}
      </ul>
      {hidden > 0 ? <p className="bdp-muted">{`+${String(hidden)}`}</p> : null}
    </>
  )
}
