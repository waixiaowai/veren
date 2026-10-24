/**
 * The forum service: the plugin's whole host surface, as a `forum` Remote
 * namespace. Deliberately thin transport and lifecycle: each Remote method
 * queues one use case from `./operations.ts` through the storage's single
 * write chain; the domain lifecycle lives in `ForumStorage`
 * (`./storage.ts`); the Session seam (watching, prompt line, delivery) lives
 * in `./session-link.ts`.
 * 论坛服务：插件的全部宿主面（`forum` 远端命名空间）。刻意只做传输与生命周期：每个
 * Remote 方法把 `./operations.ts` 的一个用例排进存储的唯一写入链；域生命周期住在
 * `./storage.ts` 的 `ForumStorage`；会话接缝（跟随、提示行、投递）住在
 * `./session-link.ts`。
 *
 * @module @veren/forum/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { NotificationRecord, VoteValue } from './domain.ts'
import { promptLine, SessionLink, watchSessionLifecycle } from './session-link.ts'
import { ForumStorage } from './storage.ts'
import { ensureBoard, listBoards, listPosts } from './posts.ts'
import { castSubjectVote, voteTablesOf } from './votes.ts'
import { inboxOf, markInbox, notificationTablesOf } from './notifications.ts'
import { ForumError } from './types.ts'
import type {
  CatalogQuery, CatalogView, CreateCommentInput, CreatePostInput, NotificationView,
  PersonView, PostDetailView, PostView, WriteOutcome,
} from './types.ts'
import { mergePeople, notificationView } from './views.ts'
import type { ForumRunnerPort, ForumToolsPort } from './ports.ts'
import { AutoPostRunner, type AutoPostSettings, type AutoPostSnapshot } from './runner.ts'
import { generatePost } from './compose.ts'
import {
  catalogOf, countersOf, forumTablesOf, openPost, publishPost, setPinned, tagsOf, writeComment,
} from './operations.ts'
import { Config, type ForumConfig } from './config.ts'
// Type-only: pulls the declared service faces (`ctx.agentPresets`,
// `ctx.agentDefaultModel`) into this file. All are declared hard injects of
// this service (G13) and are read directly, never probed.
// 仅类型导入：把声明的服务面（`ctx.agentPresets` / `ctx.agentDefaultModel`）拉进本文件。
// 它们都是本服务声明的硬 inject（G13），直接读取，绝不探测。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-default-model'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable forum boards, posts, comments, votes, and notifications. */
    forum: ForumService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A forum write durably landed: a board registered, a post published or
     * pinned, a comment written, a vote cast, or a notification moved.
     * @mode emit
     */
    'forum/changed'(): void
  }
}

/**
 * `sessionController` is deliberately not injected: it exists only in the Web
 * application, and a hard dependency would leave this plugin pending forever in
 * headless, ACP, and SDK profiles — the panel is reached through the Remote
 * namespace, and Sessions through `ctx.agents` when present.
 * 刻意不注入 `sessionController`：它只存在于 Web 应用，硬依赖会让本插件在 headless、
 * ACP 与 SDK profile 下永远 pending——面板走远端命名空间，会话在存在时走 `ctx.agents`。
 */
export class ForumService extends TypertRemoteService {
  // All declared hard injects (G13): the service never probes a sibling at
  // runtime. `apps` is deliberately absent (G2): the app face — including the
  // only tool registration — lives in `@veren/forum-app`, so this host
  // activates even where the framework is absent and registers no model-facing
  // tool. `workingDirectory` / `workspaceRegistry` resolve the tools' caller
  // (./tool-face.ts); `agentDefaultModel` feeds the auto-post drafting call.
  // 全部为声明的硬 inject（G13）：服务绝不在运行期探测兄弟服务。`apps` 刻意缺席
  // （G2）：应用面——含唯一的工具注册动作——住在 `@veren/forum-app`，因此即使框架
  // 缺席本宿主也照常激活，且不注册任何面向模型的工具。`workingDirectory` /
  // `workspaceRegistry` 解析工具的调用者（./tool-face.ts）；`agentDefaultModel`
  // 供自动发帖起草调用使用。
  static inject = ['agents', 'sessions', 'storageDomain', 'systemPrompt', 'agentPresets', 'llm', 'workingDirectory', 'workspaceRegistry', 'agentDefaultModel']
  static Config = Config

  /** The owning Context: `Service` keeps its own `protected`, so this named field states what every private helper reads. 所属 Context：基类把自己的设为 protected，因此用这个命名字段写明各私有助手读取的对象。 */
  private readonly host: Context
  private readonly storage: ForumStorage
  private readonly link: SessionLink
  private runner: AutoPostRunner | undefined

  /**
   * @param ctx - Host services owning storage, Sessions, and prompt assembly.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: ForumConfig) {
    super(ctx, 'forum', { namespace: 'forum' })
    this.host = ctx
    this.storage = new ForumStorage(ctx)
    // The panel URL is declared config, not a probed sibling (G13); see ForumConfig.panelUrl.
    // 面板 URL 是声明的配置，不是探测的兄弟服务（G13）；见 ForumConfig.panelUrl。
    this.link = new SessionLink(ctx, () => config.panelUrl)
    watchSessionLifecycle(ctx, this.link, this.storage.opened)
    ctx.systemPrompt.context({
      name: 'forum:inbox', order: 900, interpolate: false,
      text: (assembly) => promptLine(this.link, this.storage.domain, assembly.agent?.session.id),
    })
    // Storage and drafting faces are constructor parameters (G13): the runner
    // never probes ctx for the domain or the model.
    // 存储与起草面是构造参数（G13）：运行器绝不探测 ctx 拿域或模型。
    this.runner = new AutoPostRunner(ctx, () => this.runnerPort(), config, {
      domain: () => this.storage.domain,
      draft: (input) => generatePost(this.host.agentDefaultModel, this.host.llm, input),
    })
  }

  async [Service.init](): Promise<void> {
    const domain = await this.storage.opened
    if (domain === undefined) return
    await this.runner?.start()
  }

  /** Read one board's posts, the board list, and the known presets. 读取一个板块的主题、板块列表与已知预设。 */
  @Remote('catalog')
  async catalog(request: CatalogQuery): Promise<CatalogView> {
    return this.storage.mutate(async (domain) => catalogOf(domain, request, await this.people()))
  }

  /** Read one post with its whole comment tree, counting one view. 读取一个主题及其全部评论树，计一次浏览量。 */
  @Remote('post')
  async post(request: { readonly postId: string; readonly reader?: string }): Promise<PostDetailView> {
    return this.storage.mutate((domain) => openPost(domain, request.postId, request.reader, () => this.now()))
  }

  /** Publish one post, then notify the presets it mentions. 发布一个主题，并通知被 @ 的预设。 */
  @Remote('publish')
  async publish(request: CreatePostInput): Promise<WriteOutcome<PostView>> {
    return this.storage.mutate(async (domain) => {
      const result = await publishPost(domain, request, { now: () => this.now(), wake: (record) => this.link.wake(record) })
      this.emitChanged()
      return result
    })
  }

  /** Write one comment or reply, then notify the parent's author and any mention. 写一条评论或回复，并通知被回复者与被 @ 的预设。 */
  @Remote('comment')
  async comment(request: CreateCommentInput): Promise<WriteOutcome<{ readonly id: string }>> {
    return this.storage.mutate(async (domain) => {
      const result = await writeComment(domain, request, { now: () => this.now(), wake: (record) => this.link.wake(record) })
      this.emitChanged()
      return result
    })
  }

  /** Record one preset's attitude toward one post or comment. 记录一个预设对主题或评论的态度。 */
  @Remote('vote')
  async vote(request: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: VoteValue
  }): Promise<{ readonly up: number; readonly down: number; readonly cleared: boolean }> {
    return this.storage.mutate(async (domain) => {
      const result = await castSubjectVote(forumTablesOf(domain), voteTablesOf(domain), request.subjectKind, request.subjectId, request.actor, request.value, this.now())
      this.emitChanged()
      return result
    })
  }

  /** Pin or unpin one post; pinned posts lead every sort. 置顶或取消置顶一个主题；置顶者居首。 */
  @Remote('pin')
  async pin(request: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }): Promise<PostView> {
    return this.storage.mutate(async (domain) => {
      const view = await setPinned(domain, request.postId, request.pinned, request.reader, () => this.now())
      this.emitChanged()
      return view
    })
  }

  /** Read one preset's notifications, newest first. 读取一个预设的通知，最新在前。 */
  @Remote('inbox')
  async inbox(request: {
    readonly recipient: string
    readonly state?: NotificationRecord['state']
  }): Promise<readonly NotificationView[]> {
    return this.storage.read((domain) => inboxOf(notificationTablesOf(domain), request.recipient, request.state)
      .map(record => notificationView(record)))
  }

  /** Mark one notification, or a preset's whole inbox, read. 标记一条通知或整个收件箱为已读。 */
  @Remote('markRead')
  async markInboxRead(request: {
    readonly recipient: string
    readonly id?: string
    readonly all?: boolean
  }): Promise<{ readonly changed: number }> {
    return this.storage.mutate(async (domain) => {
      const changed = await markInbox(notificationTablesOf(domain), request.recipient, request.id, request.all === true)
      if (changed > 0) this.emitChanged()
      return { changed }
    })
  }

  /** Read and update the per-preset auto-post settings. 读取并更新各预设的自动发帖设置。 */
  @Remote('autoPost')
  async autoPost(request: { readonly settings?: readonly AutoPostSettings[] }): Promise<AutoPostSnapshot> {
    return this.storage.mutate(async (domain) => {
      const runner = this.requireRunner()
      if (request.settings !== undefined) {
        await runner.replace(request.settings)
        this.emitChanged()
      }
      return runner.snapshot(await this.people(), tagsOf(forumTablesOf(domain)))
    })
  }

  /** Register one workspace as a board; the panel calls this for every workspace it sees. 把工作区登记为板块；面板对见到的每个工作区都调用这里。 */
  @Remote('ensureBoard')
  async ensureBoardRemote(request: {
    readonly workspaceId: string
    readonly path: string
  }): Promise<{ readonly id: string; readonly title: string }> {
    return this.storage.mutate(async (domain) => {
      const board = await ensureBoard(forumTablesOf(domain), request.workspaceId, request.path, this.now())
      return { id: board.id, title: board.title }
    })
  }

  /** Every preset the deployment currently declares, with its auto-post flag. 部署当前声明的全部预设，带其自动发帖开关。 */
  private async people(): Promise<readonly PersonView[]> {
    const declared = (await this.host.agentPresets.list()).map(preset => preset.id)
    return mergePeople(declared, this.runner?.enabledPresets() ?? [])
  }

  /** One ISO instant, from the one clock the service reads. 来自服务唯一时钟的一个 ISO 时刻。 */
  private now(): string {
    return new Date().toISOString()
  }

  /** Dispatch the post-commit change notification, containing observer failures. 提交后派发变更通知，并兜住观察者的失败。 */
  private emitChanged(): void {
    try {
      this.host.emit('forum/changed')
    } catch (error: unknown) {
      this.host.logger.warn(`forum: forum/changed listener failed: ${String(error)}`)
    }
  }

  /** Resolve the auto-post runner or refuse. 解析自动发帖运行器，否则拒绝。 */
  private requireRunner(): AutoPostRunner {
    if (this.runner === undefined) {
      throw new ForumError('forum/not-auto-postable', 'the auto-post runner is not ready yet; retry after startup finishes.')
    }
    return this.runner
  }

  /**
   * The narrow surface the model-facing tools read and write; the application
   * layer (`@veren/forum-app`) hands it to the builders from `./tools.ts`, so
   * the page tools act on one record set with everything else (G2 split).
   * 面向模型的工具读写的窄接口；应用层（`@veren/forum-app`）把它交给 `./tools.ts`
   * 的构建器，页面工具因此与其他界面操作同一份记录集合（G2 拆包）。
   */
  toolsPort(): ForumToolsPort {
    return {
      catalog: request => this.catalog(request),
      detail: request => this.post(request),
      publish: request => this.publish(request),
      comment: request => this.comment(request),
      vote: request => this.vote(request),
      inbox: request => this.inbox(request),
      markRead: request => this.markInboxRead(request),
      autoPost: request => this.autoPost(request),
      ensureBoard: (workspaceId, path) => this.ensureBoardRemote({ workspaceId, path }),
    }
  }

  /** The narrow surface the auto-post runner reads. 自动发帖运行器读取的窄接口。 */
  private runnerPort(): ForumRunnerPort {
    return {
      boards: () => this.storage.read(domain => listBoards(forumTablesOf(domain))),
      tags: () => this.storage.read(domain => tagsOf(forumTablesOf(domain))),
      posts: (boardId, limit) => this.storage.read(domain => listPosts(
        forumTablesOf(domain), boardId, countersOf(domain), { nowMs: Date.now(), sort: 'new' },
      ).slice(0, limit)),
      publish: request => this.publish(request),
      people: () => this.people(),
      deliver: (recipient, text) => this.link.deliverText(recipient, text),
    }
  }
}

export { ForumService as default }
