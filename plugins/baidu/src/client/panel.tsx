/**
 * 百度网盘面板：一个外壳，三个页签（概览 / 文件 / 传输）。展示组件——由
 * 一个可观察对象与注入面回调驱动，只持有页签视图状态，不碰 `ctx`。
 * The Baidu Netdisk panel: one shell, three tabs (overview / files /
 * transfers). A presentation component driven by one observable and the
 * inject face's callbacks; it holds only the tab state and never touches
 * `ctx`.
 *
 * @module @veren/baidu-pan/client/panel
 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BaiduKey } from './locales.ts'
import type { ActionResult, BaiduSnapshot, DomainFailure } from './source.ts'
import type { JobStartedView, ShareReceipt, SignInStartView, AuthStateView } from './remote.ts'
import { OverviewView } from './views-overview.tsx'
import { FilesView } from './views-files.tsx'
import { TransfersView } from './views-transfers.tsx'

/** Props of {@linkcode BaiduPanel}, derived from the framework shares. */
export type BaiduPanelProps = PropsRuntime<'main'>
  & InjectFace<BaiduPanelInjected>
  & PropsLocale<'baiduPanUi'>

/** 面板注入面：一个可观察对象加全部动作回调。The panel inject face: one observable plus every action callback. */
export interface BaiduPanelInjected {
  readonly hooks: { readonly baidu: HostObservable<BaiduSnapshot> }
  readonly onRefreshOverview: () => void
  readonly onRefreshJobs: () => void
  readonly onOpenDir: (dir: string) => void
  readonly onReloadDir: () => void
  readonly onRunSearch: (keyword: string, page: number) => void
  readonly onClearSearch: () => void
  readonly onBeginSignIn: () => Promise<ActionResult<SignInStartView>>
  readonly onSubmitSignInCode: (code: string) => Promise<ActionResult<AuthStateView>>
  readonly onSignOut: () => Promise<ActionResult<{ readonly signedOut: true }>>
  readonly onCreateDir: (path: string) => Promise<ActionResult<{ readonly fsid: string; readonly path: string }>>
  readonly onRenameEntry: (path: string, newName: string) => Promise<ActionResult<{ readonly path: string }>>
  readonly onTransferEntry: (op: 'copy' | 'move', sourcePath: string, destDir: string, newName?: string) => Promise<ActionResult<{ readonly path: string }>>
  readonly onRemoveItems: (paths: readonly string[], confirmPaths: readonly string[]) => Promise<ActionResult<{ readonly paths: readonly string[] }>>
  readonly onShareItems: (paths: readonly string[], period?: number) => Promise<ActionResult<ShareReceipt>>
  readonly onStartUpload: (localPath: string, remotePath: string, overwrite: boolean) => Promise<ActionResult<JobStartedView>>
  readonly onStartDownload: (remotePath: string, localPath: string) => Promise<ActionResult<JobStartedView>>
}

/** 页签视图共享的入参（快照 + 文案 + 动作）。The tab views' shared inputs (snapshot + copy + actions). */
export interface BaiduBodyProps {
  readonly state: BaiduSnapshot
  readonly t: (key: BaiduKey) => string
  readonly actions: Omit<BaiduPanelInjected, 'hooks'>
}

/** 领域失败的视图层别名（ActionResult 的失败分支展开）。The view-layer alias of a domain failure (ActionResult's failure arm). */
export type ViewFailure = DomainFailure

/** 页签（闭集）。The tabs (closed set). */
type Tab = 'overview' | 'files' | 'transfers'

/** 渲染页面外壳并解析框架席位一次。Renders the page shell and resolves the framework seat once. */
export function BaiduPanel(props: BaiduPanelProps) {
  const state = props.useBaidu((snapshot: BaiduSnapshot) => snapshot)
  return <BaiduBody state={state} t={props.t} actions={props} />
}

/** 页面主体：标题、全局错误行、页签栏与当前视图。The page body: title, the global error line, the tab bar, and the active view. */
function BaiduBody(props: BaiduBodyProps): JSX.Element {
  const { state, t, actions } = props
  const [tab, setTab] = useState<Tab>('files')
  return (
    <div className="bdp-page">
      <header className="bdp-head">
        <div>
          <h1 className="bdp-title">{t('panel')}</h1>
          <p className="bdp-subtitle">{t('panelSubtitle')}</p>
        </div>
        <div className="bdp-head-actions">
          <button type="button" className="bdp-button" onClick={actions.onRefreshOverview}>{t('refresh')}</button>
        </div>
      </header>
      {state.status === 'error' && <ErrorLine message={state.error} />}
      {state.status === 'loading' && <p className="bdp-muted">{t('loading')}</p>}
      {state.status !== 'loading' && (
        <div className="bdp-body">
          <nav className="bdp-tabs" role="tablist">
            <TabButton active={tab === 'overview'} label={t('tabOverview')} onClick={() => { setTab('overview') }} />
            <TabButton active={tab === 'files'} label={t('tabFiles')} onClick={() => { setTab('files') }} />
            <TabButton active={tab === 'transfers'} label={t('tabTransfers')} onClick={() => { setTab('transfers') }} />
          </nav>
          {tab === 'overview' && <OverviewView state={state} t={t} actions={actions} />}
          {tab === 'files' && <FilesView state={state} t={t} actions={actions} />}
          {tab === 'transfers' && <TransfersView state={state} t={t} actions={actions} />}
        </div>
      )}
    </div>
  )
}

/** 全局错误行（载体层失败）。The global error line (a carrier-layer failure). */
function ErrorLine(props: { readonly message: string }): JSX.Element {
  return <p className="bdp-error-line" role="alert">{props.message}</p>
}

/** 页签按钮。One tab button. */
function TabButton(props: { readonly active: boolean; readonly label: string; readonly onClick: () => void }): JSX.Element {
  return (
    <button type="button" role="tab" aria-selected={props.active}
      className={props.active ? 'bdp-tab bdp-tab-active' : 'bdp-tab'} onClick={props.onClick}>
      {props.label}
    </button>
  )
}
