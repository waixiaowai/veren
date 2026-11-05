/**
 * 文件页签（设计 §12.2/§12.3/§12.4/§12.6/§12.9 + §13.2.3/§13.2.4/§13.2.5/
 * §13.2.7/§13.2.10）：面包屑 + 工具栏（检索/排序/筛选/建目录/上传）+ 列表
 * （行内操作：打开/分享/下载/重命名/复制/移动/删除/复制路径）+ 检索结果 +
 * 分页。筛选变化把页码重置为 1；删除的确认凭证传归一前服务端路径的恰好
 * 集合；一次性操作的结果卡留在本视图本地状态。
 * The files tab (design §12.2/§12.3/§12.4/§12.6/§12.9 + §13.2.3/13.2.4/
 * 13.2.5/13.2.7/13.2.10): breadcrumb + toolbar (search/sort/filter/mkdir/
 * upload) + the listing (row actions: open/share/download/rename/copy/move/
 * delete/copy path) + search results + paging. Filter changes reset the page
 * to 1; the delete voucher carries exactly the set of pre-normalization
 * server paths; one-shot results live in this view's local state.
 *
 * @module @veren/baidu-pan/client/views-files
 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { CopyAction, ErrorBlock, HintBar, type TableColumn } from './components.tsx'
import { FileListPanel } from './composites.tsx'
import { formatBytes, formatTime } from './format.ts'
import type { BaiduKey } from './locales.ts'
import type { BaiduBodyProps } from './panel.tsx'
import type { FileEntry } from './remote.ts'
import { DialogHost, type FilesDialog } from './views-files-dialog.tsx'
import {
  deleteDialog, destDialog, downloadDialog, mkdirDialog, renameDialog, shareDialog, uploadDialog,
  OpResultArea, failResult, okResult, type OpResult,
} from './views-files-actions.tsx'

/** 排序与筛选的视图状态（设计 §13.1：能放进参数的状态）。Sort/filter view state (design §13.1: state that fits in parameters). */
interface ListPrefs {
  readonly order: 'name' | 'time' | 'size'
  readonly desc: boolean
  readonly folderOnly: boolean
}

/** 行内操作与弹层构建所需的上下文（视图内部传递，不碰框架席位）。The context the row actions and dialog builders need (view-internal; never the framework seat). */
interface FilesContext {
  readonly t: (key: BaiduKey) => string
  readonly actions: BaiduBodyProps['actions']
  readonly dir: string
  readonly setDialog: (dialog: FilesDialog) => void
  readonly setResult: (result: OpResult | undefined) => void
}

/** 父目录路径（纯字符串运算）。The parent path (pure string math). */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
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

/** 条目的客户端排序与筛选（取数一次拉满，排序在本地做；目录恒在前）。Client-side sort/filter over entries (one full fetch, local sort; directories first). */
function sortEntries(entries: readonly FileEntry[], prefs: ListPrefs): readonly FileEntry[] {
  const filtered = prefs.folderOnly ? entries.filter(entry => entry.isDir) : entries
  const factor = prefs.desc ? -1 : 1
  const sorted = [...filtered]
  sorted.sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    if (prefs.order === 'name') return factor * left.name.localeCompare(right.name)
    if (prefs.order === 'time') return factor * (left.serverMtime - right.serverMtime)
    return factor * (left.size - right.size)
  })
  return sorted
}

/** 文件页签。The files tab. */
export function FilesView(props: BaiduBodyProps): JSX.Element {
  const { state, t, actions } = props
  const [prefs, setPrefs] = useState<ListPrefs>({ order: 'name', desc: false, folderOnly: false })
  const [keyword, setKeyword] = useState('')
  const [dialog, setDialog] = useState<FilesDialog>({ kind: 'none' })
  const [result, setResult] = useState<OpResult | undefined>(undefined)
  const context: FilesContext = { t, actions, dir: state.dir, setDialog, setResult }
  const searching = state.search !== undefined
  const entries = searching ? state.search?.entries ?? [] : state.listing.entries
  const visible = useMemo(() => sortEntries(entries, prefs), [entries, prefs])
  return (
    <div className="bdp-files">
      <ToolsBar state={state} t={t} keyword={keyword} onKeyword={setKeyword} prefs={prefs} onPrefs={setPrefs}
        onSearch={page => { actions.onRunSearch(keyword, page) }} onClear={() => { actions.onClearSearch(); setKeyword('') }}
        onMkdir={() => { setDialog(mkdirDialog(context)) }} onUpload={() => { setDialog(uploadDialog(context)) }} />
      <Breadcrumb dir={state.dir} t={t} onOpen={actions.onOpenDir} />
      {state.auth?.authorized !== true ? <HintBar text={t('notSignedInHint')} /> : null}
      {result === undefined ? null : <OpResultArea result={result} t={t} onDismiss={() => { setResult(undefined) }}
        onOverwrite={result.conflict === undefined ? undefined : async () => {
          const conflict = result.conflict
          if (conflict === undefined) return
          const outcome = await actions.onStartUpload(conflict.localPath, conflict.remotePath, true)
          setResult(outcome.ok ? okResult(t('transfersTitle'), t('transfersHint')) : failResult(t('conflictTitle'), outcome.failure))
        }} />}
      <DialogHost dialog={dialog} onClose={() => { setDialog({ kind: 'none' }) }} />
      {searching
        ? <SearchArea state={state} t={t} visible={visible} context={context} onClear={() => { actions.onClearSearch(); setKeyword('') }} />
        : <ListingArea state={state} t={t} visible={visible} context={context} />}
    </div>
  )
}

/** 工具栏：检索框、排序与筛选、建目录、上传。The toolbar: search box, sort/filter, mkdir, upload. */
function ToolsBar(props: {
  readonly state: BaiduBodyProps['state']
  readonly t: (key: BaiduKey) => string
  readonly keyword: string
  readonly onKeyword: (next: string) => void
  readonly prefs: ListPrefs
  readonly onPrefs: (next: ListPrefs) => void
  readonly onSearch: (page: number) => void
  readonly onClear: () => void
  readonly onMkdir: () => void
  readonly onUpload: () => void
}): JSX.Element {
  const { t } = props
  return (
    <div className="bdp-toolbar">
      <div className="bdp-form-row">
        <input className="bdp-input" placeholder={t('searchPlaceholder')} value={props.keyword}
          onChange={event => { props.onKeyword(event.target.value) }} />
        <button type="button" className="bdp-button bdp-button-primary" disabled={props.keyword.trim().length === 0}
          onClick={() => { props.onSearch(1) }}>{t('searchAction')}</button>
        {props.state.search === undefined ? null : <button type="button" className="bdp-button" onClick={props.onClear}>{t('searchClear')}</button>}
      </div>
      <div className="bdp-form-row bdp-toolbar-prefs">
        <label className="bdp-check"><span className="bdp-muted">{t('orderLabel')}</span>
          <select className="bdp-input bdp-input-inline" value={props.prefs.order}
            onChange={event => { props.onPrefs({ ...props.prefs, order: event.target.value as ListPrefs['order'] }) }}>
            <option value="name">{t('orderName')}</option>
            <option value="time">{t('orderTime')}</option>
            <option value="size">{t('orderSize')}</option>
          </select>
        </label>
        <label className="bdp-check"><input type="checkbox" checked={props.prefs.desc}
          onChange={event => { props.onPrefs({ ...props.prefs, desc: event.target.checked }) }} />{t('orderDesc')}</label>
        <label className="bdp-check"><input type="checkbox" checked={props.prefs.folderOnly}
          onChange={event => { props.onPrefs({ ...props.prefs, folderOnly: event.target.checked }) }} />{t('folderOnly')}</label>
        <span className="bdp-toolbar-gap" />
        <button type="button" className="bdp-button" onClick={props.onMkdir}>{t('mkdirAction')}</button>
        <button type="button" className="bdp-button" onClick={props.onUpload}>{t('uploadAction')}</button>
      </div>
      <HintBar text={t('uploadHint')} />
    </div>
  )
}

/** 面包屑：授权根 → 逐级目录，全部可点。The breadcrumb: root → each level, all clickable. */
function Breadcrumb(props: { readonly dir: string; readonly t: (key: BaiduKey) => string; readonly onOpen: (dir: string) => void }): JSX.Element {
  const prefix = props.dir.startsWith('/apps/') ? '/apps' : ''
  const rest = props.dir.slice(prefix.length)
  const segments = rest.split('/').filter(segment => segment.length > 0)
  const crumb = (index: number): string => index < 0 ? (prefix === '' ? '/' : prefix) : joinPath(index === 0 ? prefix : crumb(index - 1), segments[index] ?? '')
  return (
    <nav className="bdp-crumbs" aria-label="breadcrumb">
      <button type="button" className="bdp-crumb" onClick={() => { props.onOpen(prefix === '' ? '/' : prefix) }}>{props.t('breadcrumbRoot')}</button>
      {segments.map((segment, index) => (
        <button key={`${String(index)}:${segment}`} type="button" className="bdp-crumb" onClick={() => { props.onOpen(crumb(index)) }}>{segment}</button>
      ))}
    </nav>
  )
}

/** 目录列表区：四态 + 行内操作。The listing area: the four states plus row actions. */
function ListingArea(props: {
  readonly state: BaiduBodyProps['state']
  readonly t: (key: BaiduKey) => string
  readonly visible: readonly FileEntry[]
  readonly context: FilesContext
}): JSX.Element {
  const { state, t, context } = props
  if (state.listing.error !== undefined) {
    return <ErrorBlock title={t('errorTitle')} reason={state.listing.error.message} code={state.listing.error.code}
      retryable={state.listing.error.retryable} retryLabel={t('retry')} onRetry={context.actions.onReloadDir} />
  }
  const filtered = state.listing.entries.length > 0 && props.visible.length === 0
  return (
    <FileListPanel title={t('filesTitle')} columns={COLUMNS(t)} rows={toRows(props.visible)}
      total={props.visible.length} loading={state.listing.loading}
      summaryPrefix={t('summaryTotal')} summaryUnit={t('itemsUnit')}
      emptyTitle={filtered ? t('emptySearchTitle') : t('emptyDirTitle')}
      emptyHint={filtered ? t('emptySearchHint') : t('emptyDirHint')}
      onActivateRow={index => { openIfDir(props.visible[index], context) }}
      renderRowActions={index => <RowActions entry={props.visible[index]} context={context} />} />
  )
}

/** 检索结果区：结果 + 分页 + 清除筛选。The search area: results + paging + clear filters. */
function SearchArea(props: {
  readonly state: BaiduBodyProps['state']
  readonly t: (key: BaiduKey) => string
  readonly visible: readonly FileEntry[]
  readonly context: FilesContext
  readonly onClear: () => void
}): JSX.Element {
  const { state, t, context } = props
  const search = state.search
  if (search === undefined) return <div className="bdp-none" />
  if (search.error !== undefined) {
    return <ErrorBlock title={t('errorTitle')} reason={search.error.message} code={search.error.code}
      retryable={search.error.retryable} retryLabel={t('retry')}
      onRetry={() => { context.actions.onRunSearch(search.keyword, search.page) }} />
  }
  const lastPage = Math.max(1, Math.ceil(search.total / 20))
  return (
    <>
      <FileListPanel title={`${t('searchAction')}：${search.keyword}`} columns={COLUMNS(t)} rows={toRows(props.visible)}
        total={search.total} loading={search.loading} summaryPrefix={t('summaryTotal')} summaryUnit={t('itemsUnit')}
        emptyTitle={t('emptySearchTitle')} emptyHint={t('emptySearchHint')} emptyActionLabel={t('searchClear')} onEmptyAction={props.onClear}
        onActivateRow={index => { openIfDir(props.visible[index], context) }}
        renderRowActions={index => <RowActions entry={props.visible[index]} context={context} />} />
      <div className="bdp-pager">
        <button type="button" className="bdp-button" disabled={search.loading || search.page <= 1}
          onClick={() => { context.actions.onRunSearch(search.keyword, search.page - 1) }}>{'‹'}</button>
        <span className="bdp-muted">{`${String(search.page)} / ${String(lastPage)}`}</span>
        <button type="button" className="bdp-button" disabled={search.loading || search.page >= lastPage}
          onClick={() => { context.actions.onRunSearch(search.keyword, search.page + 1) }}>{'›'}</button>
      </div>
    </>
  )
}

/** 表格列定义（设计 §9.4：名称/大小/时间，固定顺序）。The table columns (design §9.4: name/size/time, fixed order). */
function COLUMNS(t: (key: BaiduKey) => string): TableColumn[] {
  return [
    { key: 'name', title: t('colName') },
    { key: 'size', title: t('colSize'), align: 'right', width: '7em' },
    { key: 'time', title: t('colTime'), width: '11em' },
  ]
}

/** 条目 → 表格行（已格式化字符串）。Entries → table rows (pre-formatted strings). */
function toRows(entries: readonly FileEntry[]): readonly Record<string, string>[] {
  return entries.map(entry => ({
    name: entry.name,
    size: entry.isDir ? '—' : formatBytes(entry.size),
    time: formatTime(entry.serverMtime),
  }))
}

/** 行激活：仅目录可进入。Row activation: only directories open. */
function openIfDir(entry: FileEntry | undefined, context: FilesContext): void {
  if (entry?.isDir === true) context.actions.onOpenDir(entry.path)
}

/** 行内操作按钮组。The per-row action buttons. */
function RowActions(props: { readonly entry: FileEntry; readonly context: FilesContext }): JSX.Element {
  const { entry, context } = props
  return (
    <span className="bdp-row-actions">
      {entry.isDir ? <button type="button" className="bdp-button" onClick={() => { context.actions.onOpenDir(entry.path) }}>{context.t('entryOpen')}</button> : null}
      <button type="button" className="bdp-button" onClick={() => { context.setDialog(shareDialog(entry, context)) }}>{context.t('entryShare')}</button>
      {entry.isDir ? null : <button type="button" className="bdp-button" onClick={() => { context.setDialog(downloadDialog(entry, context)) }}>{context.t('entryDownload')}</button>}
      <button type="button" className="bdp-button" onClick={() => { context.setDialog(renameDialog(entry, context)) }}>{context.t('entryRename')}</button>
      <button type="button" className="bdp-button" onClick={() => { context.setDialog(destDialog('copy', entry, context)) }}>{context.t('entryCopy')}</button>
      <button type="button" className="bdp-button" onClick={() => { context.setDialog(destDialog('move', entry, context)) }}>{context.t('entryMove')}</button>
      <button type="button" className="bdp-button bdp-button-danger" onClick={() => { context.setDialog(deleteDialog(entry, context)) }}>{context.t('entryDelete')}</button>
      <CopyAction value={entry.path} label={context.t('entryCopyPath')} copiedLabel={context.t('copied')} />
    </span>
  )
}
