/**
 * 文件页签的动作弹层构建器与结果卡区域（§12.3/§12.4/§12.5/§12.9 的业务接线
 * + §11.1 ResultCard 的宿主）。每个构建器返回一个自足的弹层描述——提交闭包
 * 调用动作面、装配结果卡、关弹层；失败一律带稳定码交 ErrorBlock。
 * The files tab's action-dialog builders and the result-card area (the §12.3/
 * §12.4/§12.5/§12.9 business wiring plus the §11.1 ResultCard host). Each
 * builder returns a self-contained dialog — its submit closure calls the
 * action face, assembles the result card, and closes; failures always carry
 * the stable code into an ErrorBlock.
 *
 * @module @veren/baidu-pan/client/views-files-actions
 */

import type { JSX } from 'react'
import { CopyAction, ErrorBlock } from './components.tsx'
import { ResultCard } from './composites.tsx'
import { displayPath, formatBytes } from './format.ts'
import type { BaiduKey } from './locales.ts'
import type { ViewFailure } from './panel.tsx'
import type { FileEntry, ShareReceipt } from './remote.ts'
import type { ActionResult } from './source.ts'
import type { FilesDialog, FormField } from './views-files-dialog.tsx'

/** 一次性操作的结果卡（本地状态，不进共享快照）。One operation's result card (local state, never the shared snapshot). */
export interface OpResult {
  readonly ok: boolean
  readonly title: string
  readonly detail?: string
  readonly path?: string
  readonly link?: string
  readonly failure?: ViewFailure
  readonly conflict?: { readonly localPath: string; readonly remotePath: string }
}

/** 行内操作与弹层构建所需的上下文（与 views-files 共享形状）。The context the row actions and dialog builders need (shared shape with views-files). */
export interface FilesContext {
  readonly t: (key: BaiduKey) => string
  readonly actions: {
    readonly onReloadDir: () => void
    readonly onOpenDir: (dir: string) => void
    readonly onCreateDir: (path: string) => Promise<ActionResult<{ readonly fsid: string; readonly path: string }>>
    readonly onRenameEntry: (path: string, newName: string) => Promise<ActionResult<{ readonly path: string }>>
    readonly onTransferEntry: (op: 'copy' | 'move', sourcePath: string, destDir: string, newName?: string) => Promise<ActionResult<{ readonly path: string }>>
    readonly onRemoveItems: (paths: readonly string[], confirmPaths: readonly string[]) => Promise<ActionResult<{ readonly paths: readonly string[] }>>
    readonly onShareItems: (paths: readonly string[], period?: number) => Promise<ActionResult<ShareReceipt>>
    readonly onStartUpload: (localPath: string, remotePath: string, overwrite: boolean) => Promise<ActionResult<JobStartedView>>
    readonly onStartDownload: (remotePath: string, localPath: string) => Promise<ActionResult<JobStartedView>>
  }
  readonly dir: string
  readonly setDialog: (dialog: FilesDialog) => void
  readonly setResult: (result: OpResult | undefined) => void
}

/** 成功结果卡的快捷装配。Assembles a success card quickly. */
export function okResult(title: string, detail?: string, path?: string, link?: string): OpResult {
  return { ok: true, title, ...(detail === undefined ? {} : { detail }), ...(path === undefined ? {} : { path }), ...(link === undefined ? {} : { link }) }
}

/** 目录拼接（根目录容忍尾斜杠）。Joins a directory (tolerating a root trailing slash). */
function joinPath(dir: string, name: string): string {
  return `${dir === '/' ? '' : dir}/${name}`
}

/** 本地路径的文件名（Windows 与 POSIX 分隔符都认）。The local path's file name (both Windows and POSIX separators). */
function baseName(localPath: string): string {
  const cut = Math.max(localPath.lastIndexOf('\\'), localPath.lastIndexOf('/'))
  return cut < 0 ? localPath : localPath.slice(cut + 1)
}

/** 通用表单弹层的骨架（builder 共用）。The generic form-dialog skeleton (shared by the builders). */
function formDialog(context: FilesContext, title: string, fields: readonly FormField[], confirmLabel: string, run: (values: Record<string, string>) => Promise<void>): FilesDialog {
  return {
    kind: 'form', title, fields, confirmLabel,
    cancelLabel: context.t('cancel'), busyLabel: context.t('loading'),
    onSubmit: async values => {
      await run(values)
      context.setDialog({ kind: 'none' })
    },
  }
}

/** 建目录弹层。The mkdir dialog. */
export function mkdirDialog(context: FilesContext): FilesDialog {
  return formDialog(context, context.t('mkdirAction'), [
    { key: 'name', label: context.t('mkdirPrompt'), placeholder: context.t('namePlaceholder'), value: context.t('mkdirDefaultName') },
  ], context.t('mkdirAction'), async values => {
    const name = values['name']?.trim() ?? ''
    if (name.length === 0) {
      context.setResult(failResult(context.t('errorTitle'), { code: 'BDPAN_INVALID_ARG', message: context.t('fieldRequired'), retryable: false }))
      return
    }
    const outcome = await context.actions.onCreateDir(joinPath(context.dir, name))
    context.setResult(outcome.ok ? okResult(context.t('doneMkdir'), undefined, outcome.value.path) : failResult(context.t('errorTitle'), outcome.failure))
  })
}

/** 上传弹层：本地绝对路径 + 远端文件名（缺省取本地名）；冲突走覆盖确认。The upload dialog: an absolute local path + a remote file name (defaults to the local one); conflicts go to the overwrite confirm. */
export function uploadDialog(context: FilesContext): FilesDialog {
  return formDialog(context, context.t('uploadAction'), [
    { key: 'localPath', label: context.t('uploadLocalPlaceholder'), placeholder: context.t('uploadLocalPlaceholder') },
    { key: 'remoteName', label: context.t('newNamePrompt'), placeholder: context.t('namePlaceholder') },
  ], context.t('uploadSubmit'), async values => {
    const localPath = values['localPath']?.trim() ?? ''
    const name = values['remoteName']?.trim() ?? ''
    if (localPath.length === 0) {
      context.setResult(failResult(context.t('errorTitle'), { code: 'BDPAN_INVALID_ARG', message: context.t('fieldRequired'), retryable: false }))
      return
    }
    const remotePath = joinPath(context.dir, name.length > 0 ? name : baseName(localPath))
    const outcome = await context.actions.onStartUpload(localPath, remotePath, false)
    if (outcome.ok) {
      context.setResult(okResult(context.t('transfersTitle'), context.t('transfersHint')))
      return
    }
    const conflict = outcome.failure.code === 'BDPAN_ALREADY_EXISTS'
      ? { localPath, remotePath }
      : undefined
    context.setResult({ ...failResult(context.t('conflictTitle'), outcome.failure), ...(conflict === undefined ? {} : { conflict }) })
  })
}

/** 重命名弹层。The rename dialog. */
export function renameDialog(entry: FileEntry, context: FilesContext): FilesDialog {
  return formDialog(context, context.t('entryRename'), [
    { key: 'name', label: context.t('renamePrompt'), placeholder: context.t('namePlaceholder'), value: entry.name },
  ], context.t('entryRename'), async values => {
    const name = values['name']?.trim() ?? ''
    if (name.length === 0 || name === entry.name) return
    const outcome = await context.actions.onRenameEntry(entry.path, name)
    context.setResult(outcome.ok ? okResult(context.t('doneRename'), name, entry.path) : failResult(context.t('errorTitle'), outcome.failure))
  })
}

/** 复制/移动弹层：目标目录 + 可选新名。The copy/move dialog: a destination directory plus an optional new name. */
export function destDialog(op: 'copy' | 'move', entry: FileEntry, context: FilesContext): FilesDialog {
  const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  return formDialog(context, op === 'copy' ? context.t('entryCopy') : context.t('entryMove'), [
    { key: 'destDir', label: context.t('destDirPrompt'), placeholder: parent, value: parent },
    { key: 'newName', label: context.t('newNamePrompt'), placeholder: context.t('namePlaceholder') },
  ], op === 'copy' ? context.t('entryCopy') : context.t('entryMove'), async values => {
    const destDir = values['destDir']?.trim() ?? ''
    const newName = values['newName']?.trim() ?? ''
    if (destDir.length === 0) return
    const outcome = await context.actions.onTransferEntry(op, entry.path, destDir, newName.length > 0 ? newName : undefined)
    const title = op === 'copy' ? context.t('doneCopy') : context.t('doneMove')
    context.setResult(outcome.ok ? okResult(title, destDir, entry.path) : failResult(context.t('errorTitle'), outcome.failure))
  })
}

/** 删除确认弹层：凭证恰好集合 = 服务端路径本身。The delete-confirm dialog: the voucher is exactly the server path itself. */
export function deleteDialog(entry: FileEntry, context: FilesContext): FilesDialog {
  return {
    kind: 'delete', paths: [entry.path],
    confirmLabel: context.t('deleteConfirmTitle'), busyLabel: context.t('deleteExecute'),
    cancelLabel: context.t('cancel'), consequence: context.t('deleteConsequence'),
    onConfirm: async () => {
      const outcome = await context.actions.onRemoveItems([entry.path], [entry.path])
      context.setResult(outcome.ok ? okResult(context.t('doneDelete'), undefined, entry.path) : failResult(context.t('errorTitle'), outcome.failure))
      context.setDialog({ kind: 'none' })
    },
  }
}

/** 分享弹层：有效期选择；链接与提取码进结果卡。The share dialog: a period picker; link and password land on the result card. */
export function shareDialog(entry: FileEntry, context: FilesContext): FilesDialog {
  const t = context.t
  const periods = [
    { value: '0', label: t('sharePeriod0') }, { value: '1', label: t('sharePeriod1') },
    { value: '7', label: t('sharePeriod7') }, { value: '30', label: t('sharePeriod30') },
  ]
  return formDialog(context, t('entryShare'), [
    { key: 'period', label: t('sharePeriodLabel'), select: periods, value: '7' },
  ], t('shareCreate'), async values => {
    const outcome = await context.actions.onShareItems([entry.path], Number(values['period'] ?? '7'))
    context.setResult(outcome.ok ? shareOk(outcome.value, t, entry.path) : failResult(t('errorTitle'), outcome.failure))
  })
}

/** 分享结果卡：链接可复制、提取码、有效期；永久链接带安全提示。The share result card: a copyable link, the password, the period; forever links carry the safety hint. */
function shareOk(receipt: ShareReceipt, t: (key: BaiduKey) => string, path: string): OpResult {
  const forever = receipt.period === 0 ? ` · ${t('shareForeverHint')}` : ''
  const detail = `${t('sharePwdLabel')} ${receipt.password} · ${t('sharePeriodShort')} ${String(receipt.period)}${forever}`
  return okResult(t('doneShare'), detail, path, receipt.link)
}

/** 下载弹层：本地绝对路径。The download dialog: an absolute local path. */
export function downloadDialog(entry: FileEntry, context: FilesContext): FilesDialog {
  return formDialog(context, context.t('entryDownload'), [
    { key: 'localPath', label: context.t('downloadLocalPlaceholder'), placeholder: context.t('downloadLocalPlaceholder') },
  ], context.t('downloadSubmit'), async values => {
    const localPath = values['localPath']?.trim() ?? ''
    if (localPath.length === 0) {
      context.setResult(failResult(context.t('errorTitle'), { code: 'BDPAN_INVALID_ARG', message: context.t('fieldRequired'), retryable: false }))
      return
    }
    const outcome = await context.actions.onStartDownload(entry.path, localPath)
    context.setResult(outcome.ok ? okResult(context.t('transfersTitle'), context.t('transfersHint')) : failResult(context.t('errorTitle'), outcome.failure))
  })
}

/** 失败结果卡的快捷装配。Assembles a failure card quickly. */
export function failResult(title: string, failure: ViewFailure): OpResult {
  return { ok: false, title, failure }
}

/** 结果卡区域：成功走 ResultCard，失败走 ErrorBlock（冲突附带覆盖按钮）。The result area: success rides ResultCard, failure rides ErrorBlock (conflicts add the overwrite button). */
export function OpResultArea(props: {
  readonly result: OpResult
  readonly t: (key: BaiduKey) => string
  readonly onDismiss: () => void
  readonly onOverwrite?: () => Promise<void>
}): JSX.Element {
  const t = props.t
  return (
    <div className="bdp-opresult">
      {props.result.ok
        ? <ResultCard tone="success" title={props.result.title}
          rows={props.result.detail === undefined ? [] : [{ label: '', value: props.result.detail }]}
          path={props.result.path === undefined ? undefined : { display: displayPath(props.result.path), full: props.result.path }}
          link={props.result.link === undefined ? undefined : { url: props.result.link, hint: props.result.link }}
          copyLabel={t('copy')} copiedLabel={t('copied')} />
        : (
          <>
            <ErrorBlock title={props.result.title} reason={props.result.failure?.message} code={props.result.failure?.code}
              retryable={props.result.failure?.retryable} retryLabel={t('retry')} onRetry={props.onDismiss} />
            {props.result.conflict === undefined ? null
              : <button type="button" className="bdp-button bdp-button-danger" onClick={() => { void props.onOverwrite?.() }}>{t('conflictOverwrite')}</button>}
          </>
        )}
    </div>
  )
}
