/**
 * The forum page's stateful body — now a thin composition root: it assembles
 * the state stage (`panel-page-state`), binds the action stage
 * (`panel-page-actions`), and hands the whole page to the view stage
 * (`panel-page-view`). Only this module re-renders on selection; the shell
 * above it resolves the framework seats once and never changes.
 *
 * The render output is identical to the single-file panel: the header and the
 * board bar are `PageHeader` / `BoardBar` components with the same markup.
 *
 * 论坛页面的有状态页面体——如今是薄薄的组合根：先组装状态阶段（`panel-page-state`），
 * 再绑定动作阶段（`panel-page-actions`），然后把整页交给视图阶段（`panel-page-view`）。
 * 选中变化时只有本模块重渲染；上层的壳只解析一次框架座位，此后不再变化。
 *
 * 渲染输出与单文件面板一致：页头与板块栏是 `PageHeader` / `BoardBar` 组件，标记相同。
 *
 * @module @veren/forum-ui/client/panel-body
 */

import { useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AutoPostSnapshot, CatalogQuery, PostDetailView } from './remote.ts'
import type { ForumCatalog, ForumCatalogSnapshot } from './catalog.ts'
import type { ForumKey } from './locales.ts'
import type { ForumPanelInjected } from './panel.tsx'
import { useToasts } from './panel-kit.tsx'
import type { ForumPageOps, ForumPageState } from './panel-page-state.ts'
import {
  useFeedFilters, useReaderCache, useRunner, useWorkspaceBoards,
} from './panel-page-state.ts'
import {
  commentAction, filterHandlers, inboxActions, openComposerAction, openPostAction, pinAction,
  publishAction, rereadAction, saveAutoPostAction, selectBoardAction, voteAction, voteOfCache,
} from './panel-page-actions.ts'
import { ForumPageView } from './panel-page-view.tsx'

/** Everything the page body needs, with the inject face already resolved. 页面体所需的全部输入，注入面已先行解析。 */
export interface BodyProps {
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly autoPost: AutoPostSnapshot
  readonly workspaces: readonly WorkspaceView[]
  /** The inject face's callbacks, with the hook compartment already bound away. 注入面的回调，hooks 舱已在此前解绑。 */
  readonly actions: Omit<ForumPanelInjected, 'hooks'>
  readonly refresh: ForumCatalog['refresh']
}

/**
 * Stage one — assemble the page's state: the catalog inputs, the derived
 * values, and every piece of view state through its own hook.
 * 阶段一——组装页面状态：目录输入、派生值，以及各归其钩子的每块视图状态。
 */
function useForumPageState(props: BodyProps): ForumPageState {
  const { t, catalog, autoPost, workspaces, actions, refresh } = props
  const view = catalog.catalog
  const people = view.people
  const [actor, setActor] = useState<string | undefined>(undefined)
  const active = actor ?? people[0]?.name
  const filters = useFeedFilters()
  const shownBoard = filters.boardId ?? view.boardId
  const boardTitle = view.boards.find(board => board.id === shownBoard)?.title
  const reader = useReaderCache(active)
  useWorkspaceBoards(workspaces, actions.onEnsureBoard, refresh)
  const { toasts, push } = useToasts()
  const runner = useRunner({ toasts, push }, t)
  const [open, setOpen] = useState<PostDetailView | undefined>(undefined)
  const [composerOpen, setComposerOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  // `exactOptionalPropertyTypes` rejects an explicit `undefined` for an optional
  // field, so an unselected board omits the key entirely instead of passing one.
  // `exactOptionalPropertyTypes` 下可选字段不接受显式 `undefined`，因此未选板块时
  // 整个 `boardId` 键都不出现，而不是传一个 undefined。
  const boardFilter: CatalogQuery = shownBoard === undefined ? {} : { boardId: shownBoard }
  return {
    t, catalog, autoPost, refresh, view, people, shownBoard, boardTitle,
    actor, setActor, active, filters, open, setOpen, reader,
    runner, toasts, push, boardFilter,
    composerOpen, setComposerOpen, configOpen, setConfigOpen,
  }
}

/**
 * Stage two — bind the page's ops: read helpers first, then every mutation
 * through its action factory, each fed from the state stage.
 * 阶段二——绑定页面动作：先读辅助函数，再经各自的动作工厂构建每个变更，全部取自状态阶段。
 */
function useForumPageOps(page: ForumPageState, actions: Omit<ForumPanelInjected, 'hooks'>): ForumPageOps {
  const { t, active, filters, reader, runner, push, boardFilter, refresh } = page
  const { run, setBusy, setError } = runner
  const voteOf = voteOfCache(reader.localVotes)
  const reload = (): void => { refresh({ ...boardFilter, query: filters.query, tag: filters.tag, sort: filters.sort }) }
  const reread = rereadAction({ open: page.open, setOpen: page.setOpen, onOpenPost: actions.onOpenPost })
  const openPost = openPostAction({ onOpenPost: actions.onOpenPost, setOpen: page.setOpen, setBusy, push, t })
  const vote = voteAction({
    active, voteOf, run, onVote: actions.onVote, setLocalVotes: reader.setLocalVotes, reread, reload, t,
  })
  const pin = pinAction({ active, run, onPin: actions.onPin, reread, reload, t })
  const publish = publishAction({
    run, onPublish: actions.onPublish, filters, refresh, setComposerOpen: page.setComposerOpen, t,
  })
  const comment = commentAction({ run, onComment: actions.onComment, reread, reload, t })
  const inbox = inboxActions({
    active, run, onReadInbox: actions.onReadInbox, onMarkAllRead: actions.onMarkAllRead,
    setInbox: reader.setInbox, setInboxLoaded: reader.setInboxLoaded, t,
  })
  const saveAutoPost = saveAutoPostAction({ run, onSaveAutoPost: actions.onSaveAutoPost, reload, t })
  const openComposer = openComposerAction({ setError, setComposerOpen: page.setComposerOpen })
  const selectBoard = selectBoardAction({ filters, refresh, setOpen: page.setOpen })
  const toggleConfig = (): void => { page.setConfigOpen(!page.configOpen); page.setOpen(undefined) }
  const { onQuery, onTag, onSort } = filterHandlers({ filters, boardFilter, refresh })
  return {
    voteOf, openPost, vote, pin, publish, comment,
    readInbox: inbox.readInbox, markAllRead: inbox.markAllRead, saveAutoPost,
    openComposer, selectBoard, toggleConfig, reload, onQuery, onTag, onSort,
  }
}

/** The page body: it holds the view state, so only it re-renders on selection. 页面体：持有视图状态，因此选中变化时只有它重渲染。 */
export function ForumBody(props: BodyProps) {
  const state = useForumPageState(props)
  const ops = useForumPageOps(state, props.actions)
  return <ForumPageView page={{ ...state, ...ops }} />
}
