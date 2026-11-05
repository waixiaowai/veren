/**
 * 传输页签（设计 §11.4 TaskProgressPanel + §12.4 DownloadResultView 的受理
 * 态 + §13.2.5）：任务卡列表（running 在前）+ 下载表单（远端路径 → 本地绝对
 * 路径）。任务只承诺"已提交"；>60s 仍 running 追加等待提示。
 * The transfers tab (design §11.4 TaskProgressPanel + §12.4 DownloadResultView's
 * accepted state + §13.2.5): the job-card list (running first) plus the
 * download form (a remote path → an absolute local path). A job only ever
 * promises "submitted"; running past 60s adds the waiting hint.
 *
 * @module @veren/baidu-pan/client/views-transfers
 */

import { useState } from 'react'
import type { JSX } from 'react'
import { HintBar } from './components.tsx'
import { TaskProgressPanel } from './composites.tsx'
import { formatBytes } from './format.ts'
import type { BaiduKey } from './locales.ts'
import type { BaiduBodyProps } from './panel.tsx'
import type { TransferJobSnapshot } from './remote.ts'

/** 任务阶段 → StateDot 状态（终态成败分明）。A job phase → its StateDot state (terminal states split success/failure). */
function dotState(job: TransferJobSnapshot): 'done' | 'error' | 'ongoing' {
  if (job.phase === 'done') return 'done'
  if (job.phase === 'failed') return 'error'
  return 'ongoing'
}

/** 任务阶段文案键。The phase's copy key. */
function phaseKey(job: TransferJobSnapshot): BaiduKey {
  if (job.phase === 'done') return 'jobDone'
  if (job.phase === 'failed') return 'jobFailed'
  return 'jobRunning'
}

/** 任务已等待秒数（running 才有）。A running job's waited seconds. */
function elapsedOf(job: TransferJobSnapshot): number | undefined {
  return job.phase === 'running' ? Math.round((Date.now() - job.startedAt) / 1000) : undefined
}

/** 任务完成回执的一行摘要。One line summarizing a finished job's receipt. */
function receiptLine(job: TransferJobSnapshot): string | undefined {
  if (job.receipt === undefined) return undefined
  if ('localPath' in job.receipt) return `${job.receipt.localPath} · ${formatBytes(job.receipt.bytes)}`
  if ('path' in job.receipt) return `${job.receipt.path} · ${formatBytes(job.receipt.bytes)}`
  return undefined
}

/** 传输页签。The transfers tab. */
export function TransfersView(props: BaiduBodyProps): JSX.Element {
  const { state, t, actions } = props
  return (
    <div className="bdp-transfers">
      <DownloadForm t={t} actions={actions} />
      <div className="bdp-transfers-head">
        <span className="bdp-card-title">{t('transfersTitle')}</span>
        <button type="button" className="bdp-button" onClick={actions.onRefreshJobs}>{t('transfersRefresh')}</button>
      </div>
      {state.jobs.length === 0
        ? <p className="bdp-muted">{t('transfersEmpty')}</p>
        : state.jobs.map(job => (
          <TaskProgressPanel key={job.id} state={dotState(job)} stateLabel={t(phaseKey(job))}
            phase={`${t(job.kind === 'upload' ? 'jobUpload' : 'jobDownload')} · ${job.label}`}
            percent={job.phase === 'running' ? undefined : 100}
            detail={receiptLine(job) ?? job.failure?.message}
            elapsedSeconds={elapsedOf(job)} waitingHint={t('jobWaitingRemote')} />
        ))}
    </div>
  )
}

/** 下载表单：远端路径 → 本地绝对路径；受理后刷新任务列表。The download form: a remote path → an absolute local path; acceptance refreshes the job list. */
function DownloadForm(props: {
  readonly t: (key: BaiduKey) => string
  readonly actions: BaiduBodyProps['actions']
}): JSX.Element {
  const t = props.t
  const [remote, setRemote] = useState('')
  const [local, setLocal] = useState('')
  const [starting, setStarting] = useState(false)
  const startDownload = async (): Promise<void> => {
    setStarting(true)
    await props.actions.onStartDownload(remote.trim(), local.trim())
    setStarting(false)
    setRemote('')
    setLocal('')
    props.actions.onRefreshJobs()
  }
  return (
    <section className="bdp-card">
      <div className="bdp-card-head"><span className="bdp-card-title">{t('downloadFormTitle')}</span></div>
      <div className="bdp-card-body">
        <div className="bdp-form-row">
          <input className="bdp-input" placeholder={t('entryDownload')} value={remote}
            onChange={event => { setRemote(event.target.value) }} />
          <input className="bdp-input" placeholder={t('downloadLocalPlaceholder')} value={local}
            onChange={event => { setLocal(event.target.value) }} />
          <button type="button" className="bdp-button bdp-button-primary" disabled={starting || remote.trim().length === 0 || local.trim().length === 0}
            onClick={() => { void startDownload() }}>{t('downloadSubmit')}</button>
        </div>
        <HintBar text={t('transfersHint')} />
      </div>
    </section>
  )
}
