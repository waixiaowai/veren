/**
 * The forum page's view stage: the shell (header, board bar, main column,
 * composer, toasts) and the main column's branches (error banner, settings
 * page, feed, thread). Pure presentation — every value and callback arrives
 * through the one {@link ForumPage} prop, so this module holds no state.
 *
 * 论坛页面的视图阶段：外壳（页头、板块栏、主列、写作框、提示）与主列的分支（错误横幅、
 * 配置页、信息流、主题）。纯展示——所有取值与回调都经唯一的 {@link ForumPage} prop 传入，
 * 本模块不持有状态。
 *
 * @module @veren/forum-ui/client/panel-page-view
 */

import type { ForumKey } from './locales.ts'
import type { PostDetailView } from './remote.ts'
import { BoardBar, PageHeader } from './panel-chrome.tsx'
import { ComposerModal } from './panel-composer.tsx'
import { Feed } from './panel-feed.tsx'
import { SettingsPage } from './panel-settings.tsx'
import { Thread } from './panel-thread.tsx'
import { ToastStack } from './panel-kit.tsx'
import type { ForumPage } from './panel-page-state.ts'

/** The catalog read's failure banner with its retry action. 目录读取失败的横幅与重试动作。 */
function CatalogErrorBanner(props: {
  readonly t: (key: ForumKey) => string
  readonly error: string
  readonly onRetry: () => void
}) {
  const { t, error, onRetry } = props
  return (
    <div className="forum-banner" role="alert">
      <span>{t('failed')}: {error}</span>
      <button type="button" className="forum-link" onClick={onRetry}>{t('retry')}</button>
    </div>
  )
}

/** The settings branch: the second-level page the header's gear opens. 配置分支：页头齿轮打开的二级页面。 */
function SettingsBranch(props: { readonly page: ForumPage }) {
  const { page } = props
  return (
    <SettingsPage
      t={page.t} inbox={page.reader.inbox} inboxLoaded={page.reader.inboxLoaded}
      attached={page.active !== undefined} readOnly={page.runner.busy} autoPost={page.autoPost}
      onRead={page.readInbox} onMarkAllRead={page.markAllRead} onSave={page.saveAutoPost}
      onBack={() => { page.setConfigOpen(false) }}
    />
  )
}

/** The feed branch: the board's centered post list. 信息流分支：板块的居中帖子列表。 */
function FeedBranch(props: { readonly page: ForumPage }) {
  const { page } = props
  return (
    <Feed
      t={page.t} catalog={page.catalog} posts={page.view.posts} boardTitle={page.boardTitle}
      actor={page.active} readOnly={page.runner.busy}
      query={page.filters.query} tag={page.filters.tag} sort={page.filters.sort}
      onQuery={page.onQuery} onTag={page.onTag} onSort={page.onSort}
      onOpenPost={page.openPost} onVote={page.vote} voteOf={page.voteOf}
      onPin={(postId, pinned) => { page.pin(postId, pinned, false) }}
      onCreate={page.openComposer}
    />
  )
}

/** The thread branch: the one open post's discussion. 主题分支：打开帖子的讨论视图。 */
function ThreadBranch(props: { readonly page: ForumPage; readonly detail: PostDetailView }) {
  const { page, detail } = props
  return (
    <Thread
      t={page.t} detail={detail} actor={page.active} readOnly={page.runner.busy}
      onBack={() => { page.setOpen(undefined); page.reload() }}
      onVote={page.vote} voteOf={page.voteOf}
      onPin={(postId, pinned) => { page.pin(postId, pinned, true) }}
      onComment={page.comment}
    />
  )
}

/** The main column: the error banner, then the settings/feed/thread branch. 主列：错误横幅，然后是配置/信息流/主题分支。 */
function ForumMain(props: { readonly page: ForumPage }) {
  const { page } = props
  return (
    <div className="forum-layout">
      <main className="forum-main">
        {page.catalog.status === 'error' && !page.configOpen && (
          <CatalogErrorBanner t={page.t} error={page.catalog.error} onRetry={() => { page.refresh() }} />
        )}
        {page.configOpen
          ? <SettingsBranch page={page} />
          : page.open === undefined
            ? <FeedBranch page={page} />
            : <ThreadBranch page={page} detail={page.open} />}
      </main>
    </div>
  )
}

/** The page shell the body composes: chrome, main column, composer, toasts. 页面体组合的外壳：镶边、主列、写作框与提示。 */
export function ForumPageView(props: { readonly page: ForumPage }) {
  const { page } = props
  return (
    <div className="forum-page">
      <PageHeader
        t={page.t} people={page.people} active={page.active} configOpen={page.configOpen}
        onActor={page.setActor} onToggleConfig={page.toggleConfig} onOpenComposer={page.openComposer}
      />
      <BoardBar t={page.t} boards={page.view.boards} shownBoard={page.shownBoard} onSelect={page.selectBoard} />
      <ForumMain page={page} />
      {page.composerOpen && (
        <ComposerModal
          t={page.t} boards={page.view.boards} people={page.people} actor={page.active}
          defaultBoard={page.shownBoard} readOnly={page.runner.busy} error={page.runner.error}
          onActor={page.setActor} onClose={() => { page.setComposerOpen(false) }} onSubmit={page.publish}
        />
      )}
      <ToastStack toasts={page.toasts} />
    </div>
  )
}
