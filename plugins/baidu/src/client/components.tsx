/**
 * 基础组件（设计 §10 子集）：只负责样式与交互，不取数、不绑定权限、不认识
 * 文件——所有输入都是已格式化字符串。语义色一律走 --bdp-* 令牌；状态永远
 * 带文字标签，不单靠颜色。
 * Basic components (the design §10 subset): style and interaction only — no
 * fetching, no permission binding, no knowledge of files; every input is a
 * pre-formatted string. Semantic colors ride the --bdp-* tokens; states
 * always carry a text label, never color alone.
 *
 * @module @veren/baidu-pan/client/components
 */

import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

/** 语义色调（设计 §10 公共类型）。The semantic tone (design §10's common type). */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand'

/** §10.1 StatusLabel：文字 + 语义色表达状态。StatusLabel: a state as text plus semantic color. */
export function StatusLabel(props: { readonly tone: Tone; readonly text: string }): JSX.Element {
  return <span className={`bdp-status bdp-tone-${props.tone}`}>[{props.text}]</span>
}

/** §10.2 KeyValueRow：标签—值对；copyable 时值可复制。KeyValueRow: a label–value pair; copyable values copy. */
export function KeyValueRow(props: {
  readonly label: string
  readonly value: string
  readonly muted?: boolean
  readonly copyValue?: string
  readonly copyLabel?: string
  readonly copiedLabel?: string
}): JSX.Element {
  const value = props.value.length === 0 ? '—' : props.value
  return (
    <div className="bdp-kv">
      <span className="bdp-kv-label">{props.label}</span>
      <span className={props.muted === true ? 'bdp-kv-value bdp-muted' : 'bdp-kv-value'}>
        {value}
        {props.copyValue !== undefined && props.value.length > 0
          ? <CopyAction value={props.copyValue} label={props.copyLabel ?? ''} copiedLabel={props.copiedLabel ?? ''} />
          : null}
      </span>
    </div>
  )
}

/** §10.4 ProgressBar：确定性进度；indeterminate 时不显示假百分比。ProgressBar: determinate progress; indeterminate never fakes a percent. */
export function ProgressBar(props: {
  readonly percent: number
  readonly label: string
  readonly detail?: string
  readonly indeterminate?: boolean
}): JSX.Element {
  if (props.indeterminate === true) {
    return (
      <div className="bdp-progress" role="status" aria-label={props.label}>
        <span className="bdp-progress-unknown" />
      </div>
    )
  }
  const clamped = Math.min(100, Math.max(0, Math.round(props.percent)))
  return (
    <div className="bdp-progress" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={props.label}>
      <div className="bdp-progress-fill" style={{ width: `${String(clamped)}%` }} />
    </div>
  )
}

/** §10.5 Spinner：已受理、尚无进度；附已等待秒数。Spinner: accepted, no progress yet; carries the waited seconds. */
export function Spinner(props: { readonly label: string; readonly elapsedSeconds?: number }): JSX.Element {
  return (
    <div className="bdp-spinner-row" role="status">
      <span className="bdp-spinner" aria-hidden="true" />
      <span>{props.label}</span>
      {props.elapsedSeconds === undefined ? null : <span className="bdp-muted">{`${String(props.elapsedSeconds)}s`}</span>}
    </div>
  )
}

/** §10.6 LinkLine：只渲染给定的链接，绝不自行拼 URL。LinkLine: renders the given link only — never assembles a URL. */
export function LinkLine(props: {
  readonly url?: string
  readonly hint: string
  readonly fallbackText: string
}): JSX.Element {
  if (props.url === undefined || props.url.length === 0) {
    return <span className="bdp-muted">{props.fallbackText}</span>
  }
  return (
    <a className="bdp-link" href={props.url} target="_blank" rel="noreferrer noopener">{props.hint}</a>
  )
}

/** §10.7 PathText：路径展示，完整值进 title 提示，保证根可见。PathText: shows the path; the full value lives in the title tooltip. */
export function PathText(props: { readonly display: string; readonly full: string }): JSX.Element {
  return <span className="bdp-path" title={props.full}>{props.display}</span>
}

/** §10.10 ErrorBlock：失败事实 + 原因 + 稳定码 + 下一步。ErrorBlock: the failure fact, its cause, the stable code, and the next step. */
export function ErrorBlock(props: {
  readonly title: string
  readonly reason?: string
  readonly code?: string
  readonly retryable?: boolean
  readonly retryLabel?: string
  readonly onRetry?: () => void
}): JSX.Element {
  return (
    <div className="bdp-error" role="alert">
      <div className="bdp-error-title bdp-tone-danger-text">{props.title}</div>
      {props.reason === undefined ? null : <div className="bdp-error-reason">{props.reason}</div>}
      <div className="bdp-error-meta">
        {props.code === undefined ? null : <code className="bdp-code">{props.code}</code>}
        {props.retryable === true && props.onRetry !== undefined
          ? <button type="button" className="bdp-button" onClick={props.onRetry}>{props.retryLabel ?? 'Retry'}</button>
          : null}
      </div>
    </div>
  )
}

/** §10.11 HintBar：弱化提示行。HintBar: one muted hint line. */
export function HintBar(props: { readonly text: string }): JSX.Element {
  return <p className="bdp-hint">{props.text}</p>
}

/** §10.12 EmptyState：区分"尚无数据"与"筛选无结果"，并给下一步。EmptyState: "no data yet" vs "no matches", plus a next step. */
export function EmptyState(props: {
  readonly title: string
  readonly description?: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}): JSX.Element {
  return (
    <div className="bdp-empty">
      <p className="bdp-empty-title">{props.title}</p>
      {props.description === undefined ? null : <p className="bdp-muted">{props.description}</p>}
      {props.actionLabel === undefined || props.onAction === undefined
        ? null
        : <button type="button" className="bdp-button" onClick={props.onAction}>{props.actionLabel}</button>}
    </div>
  )
}

/** §10.13 CopyAction：复制到剪贴板，2 秒复原；不可用时提示手动复制（文案切换，不用符号充当图标）。CopyAction: copies to the clipboard, reverts in 2s; falls back to manual copy (text swap, never a symbol as an icon). */
export function CopyAction(props: {
  readonly value: string
  readonly label: string
  readonly copiedLabel: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      globalThis.setTimeout(() => { setCopied(false) }, 2000)
    } catch {
      // 剪贴板不可用：退化成手动复制提示，不假装成功。
      // Clipboard unavailable: degrade to a manual-copy hint, never fake success.
      globalThis.prompt(props.value, props.value)
    }
  }
  return (
    <button type="button" className="bdp-copy" onClick={() => { void copy() }} aria-live="polite">
      {copied ? props.copiedLabel : props.label}
    </button>
  )
}

/** §10.14 SectionHeading：区块标题与计数。SectionHeading: a section title with an optional count. */
export function SectionHeading(props: { readonly title: string; readonly count?: number; readonly actions?: ReactNode }): JSX.Element {
  return (
    <div className="bdp-section-head">
      <h2 className="bdp-section-title">
        {props.title}
        {props.count === undefined ? null : <span className="bdp-muted">{` ${String(props.count)}`}</span>}
      </h2>
      {props.actions === undefined ? null : <div className="bdp-section-actions">{props.actions}</div>}
    </div>
  )
}

/** 表格列定义（设计 §10.3）。One table column definition (design §10.3). */
export interface TableColumn {
  readonly key: string
  readonly title: string
  readonly align?: 'left' | 'right'
  readonly width?: string
}

/** §10.3 Table：同构行数据；行动作经 renderRowActions 注入（组件不认识业务）。Table: homogeneous rows; row actions arrive via renderRowActions (the component stays business-blind). */
export function Table(props: {
  readonly columns: readonly TableColumn[]
  readonly rows: readonly Record<string, string>[]
  readonly loading?: boolean
  readonly emptyText?: string
  readonly onRowActivate?: (index: number) => void
  readonly renderRowActions?: (index: number) => ReactNode
}): JSX.Element {
  const hasActions = props.renderRowActions !== undefined
  return (
    <table className="bdp-table">
      <thead>
        <tr>
          {props.columns.map(column => (
            <th key={column.key} scope="col" style={column.width === undefined ? undefined : { width: column.width }}>{column.title}</th>
          ))}
          {hasActions ? <th scope="col" className="bdp-col-actions" aria-label="actions" /> : null}
        </tr>
      </thead>
      <tbody>
        {props.loading === true
          ? <tr><td className="bdp-muted" colSpan={props.columns.length + (hasActions ? 1 : 0)}><Spinner label="…" /></td></tr>
          : null}
        {props.loading !== true && props.rows.length === 0
          ? <tr><td className="bdp-muted" colSpan={props.columns.length + (hasActions ? 1 : 0)}>{props.emptyText ?? '—'}</td></tr>
          : null}
        {props.loading !== true && props.rows.map((row, index) => (
          <tr key={String(index)} className={props.onRowActivate === undefined ? undefined : 'bdp-row-active'}
            onClick={props.onRowActivate === undefined ? undefined : () => { props.onRowActivate?.(index) }}>
            {props.columns.map(column => (
              <td key={column.key} className={column.align === 'right' ? 'bdp-cell-right' : undefined}>{row[column.key] ?? ''}</td>
            ))}
            {hasActions ? <td className="bdp-cell-actions">{props.renderRowActions?.(index)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
