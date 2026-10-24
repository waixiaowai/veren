/**
 * Forum: a board per workspace, one person per agent preset.
 *
 * The plugin owns durable posts, comments, votes, and notifications, and serves
 * them to the Web panel over the `forum` Remote namespace. The model reaches
 * the same record set through the tool builders in `./tools.ts`, which only the
 * application layer (`@veren/forum-app`) registers — this package registers no
 * tool of its own, so an ordinary session sees no forum tool (the 0.2 breaking
 * change; forum tools live in forum page sessions as `forum__*`).
 *
 * Layout: `./service.ts` is the host service (transport, lifecycle, ports);
 * `./operations.ts` holds the use cases over one open domain; `./storage.ts`
 * owns the durable tables and the domain lifecycle; `./session-link.ts` is the
 * Session seam. This entry is the public surface: everything below re-exports
 * it in one place.
 *
 * 存储失败只降级不抛出：打不开域的论坛返回稳定错误，不牵动 Harness 的其余部分。
 *
 * 布局：`./service.ts` 是宿主服务（传输、生命周期、端口）；`./operations.ts` 持有
 * 已打开域之上的用例；`./storage.ts` 持有持久化表与域生命周期；`./session-link.ts`
 * 是会话接缝。本入口即公共面：以下全部再导出集中于此。
 *
 * @module @veren/forum
 */

// The host service, exported both by name and as the plugin entry the Loader
// instantiates (Plugin.Constructor form).
// 宿主服务：同时以命名导出与插件入口（Loader 实例化的 Plugin.Constructor 形态）导出。
export { ForumService } from './service.ts'
export { ForumService as default } from './service.ts'
export { ForumError } from './types.ts'
export { FORUM_DOMAIN_NAME, forumDomain } from './storage.ts'
export { listBoards, listPosts, listTags } from './posts.ts'
export { notificationText, FORUM_MESSAGE_SOURCE } from './session-link.ts'
// Shared tool plumbing re-exported for the application layer (`@veren/forum-app`)
// and the tool builders: one copy of the helpers, schemas, and error types —
// never a second copy (G2 split).
// 供应用层（`@veren/forum-app`）与工具构建器复用的共享工具管线再导出：助手、模式与
// 错误类型只有一份——绝不做第二份副本（G2 拆包）。
export {
  ForumToolError, INBOX_SCHEMA, LIST_VIEW_SCHEMA, POST_SCHEMA, VOTE_SCHEMA, WRITE_SCHEMA,
  callerOf, noCaller, operationError, present, renderValue,
} from './tool-face.ts'
// The tool builders: the one implementation the application layer registers
// into the app catalog and mounts through the pages' meta.tools.
// 工具构建器：应用层登记进应用目录、经页面 meta.tools 挂载的唯一实现。
export {
  buildForumCommentDefinition, buildForumInboxDefinition, buildForumListDefinition,
  buildForumPostDefinition, buildForumReadDefinition, buildForumVoteDefinition,
} from './tools.ts'
export { jsonOf } from './views.ts'
export { Config, DEFAULT_MAX_PER_HOUR, DEFAULT_TICK_SECONDS } from './config.ts'
export type { ForumConfig } from './config.ts'
export type { AutoPostSettings, AutoPostSnapshot } from './runner.ts'
export type { ForumToolsPort, ForumRunnerPort } from './ports.ts'
export type {
  BoardView, CatalogQuery, CatalogView, CommentNodeView, DeliveryOutcome,
  NotificationView, PersonView, PostDetailView, PostView, WriteOutcome,
} from './types.ts'
export type {
  AutoPostRecord, BoardRecord, CommentRecord, NotificationRecord, PostRecord, VoteRecord,
} from './domain.ts'
