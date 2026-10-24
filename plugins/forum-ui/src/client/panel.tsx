/**
 * The forum page's assembly exit: the page shell, the inject-face contract,
 * and the derived props type. The body and every view segment live in sibling
 * modules — `panel-body` (state), `panel-chrome` (header/board bar), `panel-feed`,
 * `panel-thread`, `panel-composer`, `panel-settings`, and `panel-kit` (shared
 * widgets) — so this file stays the one place a consumer needs to know.
 *
 * The page is a presentation component. It reads its catalog through the
 * framework's `useCatalog` seat — synthesized from the inject face's `hooks`
 * compartment — takes the workspace list through the framework's
 * `useWorkspaces` seat, and performs every mutation through the callbacks its
 * inject face supplies. It never touches `ctx`, never imports a service, and
 * holds only view state.
 *
 * 论坛页面的组装出口：页面外壳、注入面契约与派生的 props 类型。页面体与各视图段都住在
 * 同级的模块里——`panel-body`（状态）、`panel-chrome`（页头/板块栏）、`panel-feed`、
 * `panel-thread`、`panel-composer`、`panel-settings` 与 `panel-kit`（共享部件）——
 * 消费者只需认识这一个文件。
 *
 * 页面是展示组件。它通过框架的 `useCatalog` 座位（由注入面的 `hooks` 舱合成）读取目录、
 * 通过 `useWorkspaces` 座位取工作区列表，所有写入都经注入面提供的回调完成——它不碰 `ctx`、
 * 不导入服务，本地只持有视图状态。
 *
 * @module @veren/forum-ui/client/panel
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `useWorkspaces` global seat this page reads.
// 仅类型导入：把本页面读取的 `useWorkspaces` 全局座位拉进类型视图。
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  AutoPostSettings, AutoPostSnapshot, CatalogQuery, NotificationView, PostDetailView,
} from './remote.ts'
import type { ForumCatalogSnapshot } from './catalog.ts'
import type { CommentInput, PublishInput } from './panel-model.ts'
import { ForumBody, type BodyProps } from './panel-body.tsx'

/** Everything the page's inject face supplies: observables and callbacks. 页面注入面提供的全部内容：可观察对象与回调。 */
export interface ForumPanelInjected {
  /** The catalog and auto-post observables, bound as `useCatalog` / `useAutoPost`. 目录与自动发帖可观察对象，绑定为 `useCatalog` / `useAutoPost`。 */
  readonly hooks: {
    readonly catalog: HostObservable<ForumCatalogSnapshot>
    readonly autoPost: HostObservable<AutoPostSnapshot>
  }
  /** Re-read the catalog after a change or a failure. 变更或失败后重读目录。 */
  readonly onRefresh: (request?: CatalogQuery) => void
  /**
   * Register one workspace as a board.
   *
   * The page owns this call because it is the one place that already reads the
   * framework's live workspace list; registering on every new workspace is what
   * makes a workspace created later appear as a new board with no setup step.
   *
   * 把一个工作区登记为板块。
   *
   * 这个调用归页面所有，因为页面是唯一已经在读框架实时工作区列表的地方；每个新工作区出现时
   * 都登记一次，后来创建的工作区才会无需任何配置步骤就长成新板块。
   */
  readonly onEnsureBoard: (workspaceId: string, path: string) => Promise<void>
  /** Read one post with its comment tree. 读取一条帖子及其评论树。 */
  readonly onOpenPost: (postId: string) => Promise<PostDetailView>
  /** Publish one post. 发布一条帖子。 */
  readonly onPublish: (input: PublishInput) => Promise<void>
  /** Write one comment or reply. 写一条评论或回复。 */
  readonly onComment: (input: CommentInput) => Promise<void>
  /** Record one preset's attitude. 记录一个预设的态度。 */
  readonly onVote: (input: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: 'up' | 'down'
  }) => Promise<void>
  /** Pin or unpin one post. 置顶或取消置顶一条帖子。 */
  readonly onPin: (input: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }) => Promise<void>
  /** Read the reading preset's notifications. 读取当前阅读预设的通知。 */
  readonly onReadInbox: (recipient: string) => Promise<readonly NotificationView[]>
  /** Mark every notification of one preset read. 把一个预设的全部通知标为已读。 */
  readonly onMarkAllRead: (recipient: string) => Promise<void>
  /** Replace the per-preset auto-post settings. 替换按预设的自动发帖设置。 */
  readonly onSaveAutoPost: (settings: readonly AutoPostSettings[]) => Promise<void>
}

/** Props of {@link ForumPanel}, derived from the framework shares. {@link ForumPanel} 的 props，由框架共享面派生。 */
export type ForumPanelProps = PropsRuntime<'main'>
  & InjectFace<ForumPanelInjected>
  & PropsLocale<'forum'>

/** Render the page shell and resolve the framework seats once. 渲染页面外壳，只解析一次框架座位。 */
export function ForumPanel(props: ForumPanelProps) {
  const catalog = props.useCatalog(state => state)
  const autoPost = props.useAutoPost(state => state)
  const workspaces = props.useWorkspaces(state => state.items)
  const body: BodyProps = {
    t: props.t,
    catalog,
    autoPost,
    workspaces,
    actions: props,
    refresh: props.onRefresh,
  }
  return <ForumBody {...body} />
}
