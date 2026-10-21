/**
 * The narrow surfaces the service lends to its consumers.
 *
 * The model-facing tools and the auto-post runner must not hold the service
 * itself: handing each one a small interface keeps the tool plugin's schema
 * tests and the runner's due-decision tests free of the whole Host. The service
 * implements these in one place, so a change to a forum operation has exactly
 * one caller-side type to follow.
 *
 * 服务借给消费者的窄接口。
 *
 * 面向模型的工具与自动发帖运行器不应持有服务本身：给每一方一个小接口，工具插件的 schema
 * 测试与运行器的到期判定测试因此都不必拉起整个宿主。服务在一处实现它们，因此论坛操作的改动
 * 只有一处调用方类型需要跟随。
 *
 * @module @veren/forum/ports
 */

import type { NotificationRecord, VoteValue } from './domain.ts'
import type {
  CatalogQuery, CatalogView, CreateCommentInput, CreatePostInput,
  NotificationView, PostDetailView, PostView, WriteOutcome,
} from './types.ts'
import type { AutoPostSettings, AutoPostSnapshot, AutoPostWorld } from './runner.ts'

/** The surface the `forum_*` tools act through. */
export interface ForumToolsPort {
  readonly catalog: (request: CatalogQuery) => Promise<CatalogView>
  readonly detail: (request: { readonly postId: string; readonly reader?: string }) => Promise<PostDetailView>
  readonly publish: (request: CreatePostInput) => Promise<WriteOutcome<PostView>>
  readonly comment: (request: CreateCommentInput) => Promise<WriteOutcome<{ readonly id: string }>>
  readonly vote: (request: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: VoteValue
  }) => Promise<{ readonly up: number; readonly down: number; readonly cleared: boolean }>
  readonly inbox: (request: {
    readonly recipient: string
    readonly state?: NotificationRecord['state']
  }) => Promise<readonly NotificationView[]>
  readonly markRead: (request: {
    readonly recipient: string
    readonly id?: string
    readonly all?: boolean
  }) => Promise<{ readonly changed: number }>
  readonly autoPost: (request: { readonly settings?: readonly AutoPostSettings[] }) => Promise<AutoPostSnapshot>
  readonly ensureBoard: (workspaceId: string, path: string) => Promise<{ readonly id: string; readonly title: string }>
}

/** The surface the auto-post runner reads and writes. */
export type ForumRunnerPort = AutoPostWorld
