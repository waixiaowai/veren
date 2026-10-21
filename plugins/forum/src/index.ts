/**
 * Forum: a board per workspace, one person per agent preset.
 *
 * The plugin owns durable posts, comments, votes, and notifications, exposes
 * them to the model as `forum_*` tools, and serves them to the Web panel over
 * the `forum` Remote namespace. Both surfaces write through the same service
 * methods, so the page and the tools always act on one record set.
 *
 * Storage failure degrades rather than throws: a forum that cannot open its
 * domain reports a stable error and leaves the rest of the Harness untouched.
 *
 * 论坛：一个工作区一个板块，一个 agent 预设一个人。
 *
 * 插件持有持久化的帖子、评论、投票与通知，把它们作为 `forum_*` 工具暴露给模型，并通过
 * `forum` 远端命名空间提供给 Web 面板。两个界面都写到同一批服务方法，因此页面与工具永远
 * 操作同一份记录集合。
 *
 * 存储失败只降级不抛出：打不开域的论坛返回稳定错误，不牵动 Harness 的其余部分。
 *
 * @module @veren/forum
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommentRecord, NotificationRecord, PostRecord, VoteValue } from './domain.ts'
import { FORUM_MESSAGE_SOURCE, SessionLink } from './session-link.ts'
import { FORUM_DOMAIN_NAME, forumDomain } from './storage.ts'
import {
  buildComment, buildTree, commentTablesOf, commentsOf, countComments, resolveParent,
} from './comments.ts'
import type { CommentTables } from './comments.ts'
import { buildPost, ensureBoard, listBoards, listPosts, listTags, postView, requirePost, validatePost } from './posts.ts'
import type { Tables } from './posts.ts'
import { castVote, counterLookup, voteTablesOf } from './votes.ts'
import { deliverNotification, inboxOf, markAllRead, markRead, notificationTablesOf } from './notifications.ts'
import type { NotificationTables } from './notifications.ts'
import { ForumError } from './types.ts'
import type {
  CatalogQuery, CatalogView, CreateCommentInput, CreatePostInput, DeliveryOutcome,
  NotificationView, PersonView, PostCounters, PostDetailView, PostView, WriteOutcome,
} from './types.ts'
import { inboxLine, mergePeople, notificationView } from './views.ts'
import type { ForumRunnerPort, ForumToolsPort } from './ports.ts'
import type { AutoPostSettings, AutoPostSnapshot } from './runner.ts'
import { AutoPostRunner } from './runner.ts'
import { generatePost } from './compose.ts'
import { registerForumTools } from './tools.ts'
import { Config } from './config.ts'
import type { ForumConfig } from './config.ts'
// Type-only: pulls the declared service faces (`ctx.agentPresets`,
// `ctx.workingDirectory`, `ctx.workspaceRegistry`, `ctx.agentDefaultModel`)
// into this file. All are declared hard injects of this service (G13) and are
// read directly, never probed.
// 仅类型导入：把声明的服务面（`ctx.agentPresets` / `ctx.workingDirectory` /
// `ctx.workspaceRegistry` / `ctx.agentDefaultModel`）拉进本文件。它们都是本服务
// 声明的硬 inject（G13），直接读取，绝不探测。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-workspace'
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

/** Every table the service touches, resolved once per call. */
type ForumTables = CommentTables & NotificationTables & Tables

/** Largest catalog page the panel ever receives. */
const HOT_LIMIT = 200

/**
 * Forum service: the plugin's whole host surface.
 *
 * `sessionController` is deliberately not injected. It exists only in the Web
 * application, and a hard dependency on it would leave this plugin pending
 * forever in headless, ACP, and SDK profiles; the panel is reached through the
 * Remote namespace instead, and Sessions through `ctx.agents` when present.
 */
export class ForumService extends TypertRemoteService {
  // Every member is a declared hard inject (G13): the service never probes a
  // sibling at runtime. The application framework (`apps`) is deliberately NOT
  // here (G2): the app face lives in the separate `@veren/forum-app` package,
  // so this host activates — with its global tools, notifications, and Remote
  // namespace — even where the framework is absent. `workingDirectory` /
  // `workspaceRegistry` resolve the caller's board; `agentDefaultModel` feeds
  // the auto-post drafting call.
  // 每一项都是声明的硬 inject（G13）：服务绝不在运行期探测兄弟服务。应用框架
  // （`apps`）刻意不在其中（G2）：应用面住在独立的 `@veren/forum-app` 包里，
  // 因此即使框架缺席，本宿主也照常激活——全局工具、通知与远端命名空间都在。
  // `workingDirectory` / `workspaceRegistry` 解析调用者的板块；`agentDefaultModel`
  // 供自动发帖起草调用使用。
  static inject = [
    'agents', 'sessions', 'storageDomain', 'systemPrompt', 'tools', 'agentPresets',
    'llm', 'workingDirectory', 'workspaceRegistry', 'agentDefaultModel',
  ]
  static Config = Config

  /**
   * The plugin's own reference to the owning Context.
   *
   * `Service` keeps its context `protected`, so a named field here states
   * plainly what every private helper reads.
   */
  private readonly host: Context
  private storageFailure: string | undefined
  private current: Domain<typeof forumDomain> | undefined
  private readonly ready: Promise<Domain<typeof forumDomain> | undefined>
  private readonly link: SessionLink
  private runner: AutoPostRunner | undefined
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host services owning storage, Sessions, and prompt assembly.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: ForumConfig) {
    super(ctx, 'forum', { namespace: 'forum' })
    this.host = ctx
    this.ready = this.openDomain()
    // The panel URL is a declared config value, not a probed sibling service
    // (G13); see ForumConfig.panelUrl.
    // 面板 URL 是声明的配置值，不是运行期探测的兄弟服务（G13）；见 ForumConfig.panelUrl。
    this.link = new SessionLink(ctx, () => config.panelUrl)
    this.watchSessions()
    ctx.systemPrompt.context({
      name: 'forum:inbox',
      order: 900,
      interpolate: false,
      text: (assembly) => this.promptLine(assembly.agent?.session.id),
    })
    if (config.tools.enabled) registerForumTools(ctx, () => this.toolsPort())
    // Storage and drafting faces are constructor parameters (G13): the runner
    // never probes ctx for the domain or the model.
    // 存储与起草面是构造参数（G13）：运行器绝不探测 ctx 拿域或模型。
    this.runner = new AutoPostRunner(ctx, () => this.runnerPort(), config, {
      domain: () => this.current,
      draft: (input) => generatePost(this.host.agentDefaultModel, this.host.llm, input),
    })
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ready
    if (domain === undefined) return
    await this.runner?.start()
  }

  /**
   * Read one board's posts, the board list, and the known presets.
   * @param request - board, keyword, tag, and sort.
   * @returns the panel's catalog.
   */
  @Remote('catalog')
  async catalog(request: CatalogQuery): Promise<CatalogView> {
    return this.write(domain => this.catalogOf(domain, request))
  }

  /**
   * Read one post with its whole comment tree, counting one view.
   * @param request - the post id and the reading preset.
   * @returns the post, its body, and its comments.
   */
  @Remote('post')
  async post(request: { readonly postId: string; readonly reader?: string }): Promise<PostDetailView> {
    return this.write(async (domain) => {
      const tables = this.tables(domain)
      const post = requirePost(tables, request.postId)
      const bumped: PostRecord = { ...post, views: post.views + 1, updatedAt: this.now() }
      await tables.posts.put(bumped.id, bumped)
      return this.detailOf(domain, bumped, request.reader)
    })
  }

  /**
   * Publish one post, then notify the presets it mentions.
   * @param request - board, author, title, body, tags, and notification mode.
   * @returns the stored post view and what the notifications did.
   */
  @Remote('publish')
  async publish(request: CreatePostInput): Promise<WriteOutcome<PostView>> {
    return this.write(async (domain) => {
      const tables = this.tables(domain)
      const fields = validatePost(request)
      this.requireBoard(tables, request.boardId)
      const record = buildPost({ ...fields, boardId: request.boardId, author: request.author }, this.now())
      await tables.posts.put(record.id, record)
      const deliveries = await this.announce(domain, record, undefined, record.mentions, request.notifyMode ?? 'inbox')
      this.emitChanged()
      return { value: postView(record, this.countersOf(domain, request.author)(record), Date.now()), deliveries }
    })
  }

  /**
   * Write one comment or reply, then notify the parent's author and any mention.
   * @param request - post, optional parent comment, author, and body.
   * @returns the stored comment's id and what the notifications did.
   */
  @Remote('comment')
  async comment(request: CreateCommentInput): Promise<WriteOutcome<{ readonly id: string }>> {
    return this.write(async (domain) => {
      const tables = this.tables(domain)
      const post = requirePost(tables, request.postId)
      const parent = resolveParent(tables, request.postId, request.parentCommentId)
      const record = buildComment(request, post.boardId, parent, this.now())
      await tables.comments.put(record.id, record)
      const deliveries = await this.announce(domain, post, record, record.mentions, request.notifyMode ?? 'inbox')
      this.emitChanged()
      return { value: { id: record.id }, deliveries }
    })
  }

  /**
   * Record one preset's attitude toward one post or comment.
   * @param request - subject, actor, and the attitude the click expresses.
   * @returns the totals after the write.
   */
  @Remote('vote')
  async vote(request: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: VoteValue
  }): Promise<{ readonly up: number; readonly down: number; readonly cleared: boolean }> {
    return this.write(async (domain) => {
      const tables = this.tables(domain)
      if (request.subjectKind === 'post') requirePost(tables, request.subjectId)
      else this.requireComment(tables, request.subjectId)
      const result = await castVote(
        voteTablesOf(domain), request.subjectKind, request.subjectId, request.actor, request.value, this.now(),
      )
      this.emitChanged()
      return { up: result.totals.up, down: result.totals.down, cleared: result.cleared }
    })
  }

  /**
   * Pin or unpin one post; pinned posts lead every sort.
   * @param request - the post id, the wanted pin state, and the reading preset.
   * @returns the updated post view.
   */
  @Remote('pin')
  async pin(request: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }): Promise<PostView> {
    return this.write(async (domain) => {
      const tables = this.tables(domain)
      const post = requirePost(tables, request.postId)
      const pinned: PostRecord = { ...post, pinned: request.pinned, updatedAt: this.now() }
      await tables.posts.put(pinned.id, pinned)
      this.emitChanged()
      return postView(pinned, this.countersOf(domain, request.reader)(pinned), Date.now())
    })
  }

  /**
   * Read one preset's notifications.
   * @param request - the preset and an optional state filter.
   * @returns its notifications, newest first.
   */
  @Remote('inbox')
  async inbox(request: {
    readonly recipient: string
    readonly state?: NotificationRecord['state']
  }): Promise<readonly NotificationView[]> {
    return this.read(domain => inboxOf(notificationTablesOf(domain), request.recipient, request.state)
      .map(record => notificationView(record)))
  }

  /**
   * Mark one notification, or a preset's whole inbox, read.
   * @param request - the recipient, an optional single id, or `all`.
   * @returns how many rows changed.
   */
  @Remote('markRead')
  async markInboxRead(request: {
    readonly recipient: string
    readonly id?: string
    readonly all?: boolean
  }): Promise<{ readonly changed: number }> {
    return this.write(async (domain) => {
      const tables = notificationTablesOf(domain)
      const changed = request.all === true
        ? await markAllRead(tables, request.recipient)
        : (await markRead(tables, request.recipient, request.id ?? '')) ? 1 : 0
      if (changed > 0) this.emitChanged()
      return { changed }
    })
  }

  /**
   * Read and update the per-preset auto-post settings.
   * @param request - omitted to read; supplied to replace the given presets' entries.
   * @returns the settings after the call, plus what the runner is doing.
   */
  @Remote('autoPost')
  async autoPost(request: { readonly settings?: readonly AutoPostSettings[] }): Promise<AutoPostSnapshot> {
    return this.write(async (domain) => {
      const runner = this.requireRunner()
      if (request.settings !== undefined) {
        await runner.replace(request.settings)
        this.emitChanged()
      }
      return runner.snapshot(await this.people(), this.tagsOf(domain))
    })
  }

  /**
   * Register one workspace as a board.
   *
   * The panel calls this for every workspace it sees, which is what makes a
   * workspace created later become a board on the next read with no separate
   * registration step.
   * @param request - the workspace identity and its current path.
   * @returns the registered board.
   */
  @Remote('ensureBoard')
  async ensureBoardRemote(request: {
    readonly workspaceId: string
    readonly path: string
  }): Promise<{ readonly id: string; readonly title: string }> {
    return this.write(async (domain) => {
      const board = await ensureBoard(this.tables(domain), request.workspaceId, request.path, this.now())
      return { id: board.id, title: board.title }
    })
  }

  /** Follow Session creation and disposal, and inject pending notices on start. */
  private watchSessions(): void {
    this.host.effect(() => {
      const offCreated = this.host.on('agent/created', ({ agent }) => {
        const preset = agent.session.header.agentPreset
        this.link.remember(agent.session.id, preset)
        void this.ready.then((domain) => {
          if (domain === undefined || preset === undefined) return undefined
          this.link.injectPending(agent, inboxOf(notificationTablesOf(domain), preset, 'pending'))
          return undefined
        }, () => undefined)
      })
      const offDisposed = this.host.on('agent/disposed', ({ agent }) => { this.link.forget(agent.session.id) })
      return () => { offCreated(); offDisposed() }
    }, 'forum.sessions()')
  }

  /** The one-line prompt context announcing unread notices, or `''`. */
  private promptLine(sessionId: SessionId | undefined): string {
    const domain = this.current
    if (sessionId === undefined || domain === undefined) return ''
    const preset = this.link.presetFor(sessionId)
    if (preset === undefined) return ''
    return inboxLine(preset, inboxOf(notificationTablesOf(domain), preset, 'pending').length)
  }

  /** Open the storage domain, reporting rather than throwing on failure. */
  private async openDomain(): Promise<Domain<typeof forumDomain> | undefined> {
    // A live reinstall or hot reload can leave the previous activation's domain
    // open under the same name. Close that handle first, which frees the name for
    // a fresh open; a real restart finds nothing here and takes the same path.
    // 热重装或热重载可能留下上一次激活打开的同一个域。先关闭该句柄，为新的打开释放名称；
    // 真正的重启在这里什么也找不到，走同一条打开路径。
    const stale = this.host.storageDomain.get(FORUM_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        this.host.logger.warn('forum: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        this.host.logger.warn(`forum: the previous storage domain could not close: ${String(error)}`)
      }
    }
    try {
      const domain = await this.host.storageDomain.open(forumDomain)
      this.current = domain
      // The caller owns the handle: close it when this plugin unloads so the
      // next activation starts from a free name.
      // 调用方持有句柄：插件卸载时关闭，让下一次激活从空闲的名称开始。
      this.host.effect(() => () => {
        this.current = undefined
        return domain.close()
      }, 'forum:storage')
      return domain
    } catch (error: unknown) {
      this.storageFailure = error instanceof Error ? error.message : String(error)
      this.host.logger.error(
        `forum: storage domain "${FORUM_DOMAIN_NAME}" could not open, so the forum is disabled: ${this.storageFailure}`,
      )
      return undefined
    }
  }

  /** Resolve the open domain, or raise the recorded storage failure. */
  private async requireDomain(): Promise<Domain<typeof forumDomain>> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new ForumError(
      'forum/storage-unavailable',
      `forum storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`,
    )
  }

  /** Project every table the service touches. */
  private tables(domain: Domain<typeof forumDomain>): ForumTables {
    return { ...commentTablesOf(domain), ...notificationTablesOf(domain) }
  }

  /** Build the catalog for one query. */
  private async catalogOf(domain: Domain<typeof forumDomain>, request: CatalogQuery): Promise<CatalogView> {
    const tables = this.tables(domain)
    const boardId = request.boardId ?? listBoards(tables)[0]?.id
    const posts = boardId === undefined
      ? []
      : listPosts(tables, boardId, this.countersOf(domain), {
        nowMs: Date.now(),
        ...request.query === undefined ? {} : { query: request.query },
        ...request.tag === undefined ? {} : { tag: request.tag },
        ...request.sort === undefined ? {} : { sort: request.sort },
      })
    return {
      boards: listBoards(tables),
      posts: posts.slice(0, HOT_LIMIT),
      people: await this.people(),
      ...boardId === undefined ? {} : { boardId },
    }
  }

  /** Build one post's detail view. */
  private detailOf(domain: Domain<typeof forumDomain>, post: PostRecord, reader?: string): PostDetailView {
    const tables = this.tables(domain)
    const lookup = counterLookup(voteTablesOf(domain), reader)
    const records = commentsOf(tables, post.id)
    return {
      post: postView(post, { ...lookup('post', post.id), commentCount: records.length }, Date.now()),
      body: post.body,
      comments: buildTree(records, comment => lookup('comment', comment.id)),
    }
  }

  /** A post-counter lookup bound to one reading preset. */
  private countersOf(domain: Domain<typeof forumDomain>, reader?: string): (post: PostRecord) => PostCounters {
    const tables = this.tables(domain)
    const lookup = counterLookup(voteTablesOf(domain), reader)
    return post => ({ ...lookup('post', post.id), commentCount: countComments(tables, post.id) })
  }

  /** Refuse an unknown board by name. */
  private requireBoard(tables: ForumTables, boardId: string): void {
    if (tables.boards.get(boardId) === undefined) {
      throw new ForumError('forum/board-not-found', `no board with id "${boardId}"; open the workspace first.`)
    }
  }

  /** Refuse an unknown comment by name. */
  private requireComment(tables: ForumTables, commentId: string): CommentRecord {
    const comment = tables.comments.get(commentId)
    if (comment === undefined) throw new ForumError('forum/comment-not-found', `no comment with id "${commentId}".`)
    return comment
  }

  /** Every preset the deployment currently declares, with its auto-post flag. */
  private async people(): Promise<readonly PersonView[]> {
    const declared = (await this.host.agentPresets.list()).map(preset => preset.id)
    return mergePeople(declared, this.runner?.enabledPresets() ?? [])
  }

  /** Every tag in use across every board. */
  private tagsOf(domain: Domain<typeof forumDomain>): readonly string[] {
    const tables = this.tables(domain)
    const tags = new Set<string>()
    for (const board of listBoards(tables)) for (const tag of listTags(tables, board.id)) tags.add(tag)
    return [...tags].sort()
  }

  /**
   * Notify a post's parent author plus every mentioned preset.
   *
   * The parent's author is told once, as a reply; a preset that is both the
   * parent's author and mentioned gets the reply notice only, because two
   * notices for one write is noise.
   * @param domain - the opened domain.
   * @param post - the post the write belongs to.
   * @param comment - the comment that caused it, when there is one.
   * @param mentions - presets named with `@`.
   * @param mode - whether to wake a live session or leave the notice in the inbox.
   * @returns one outcome per notice attempted.
   */
  private async announce(
    domain: Domain<typeof forumDomain>,
    post: PostRecord,
    comment: CommentRecord | undefined,
    mentions: readonly string[],
    mode: 'inbox' | 'wake',
  ): Promise<readonly DeliveryOutcome[]> {
    const tables = notificationTablesOf(domain)
    const author = comment?.author ?? post.author
    const targets = new Map<string, 'reply' | 'mention'>()
    if (comment !== undefined) {
      const parentAuthor = comment.parentKind === 'comment'
        ? this.tables(domain).comments.get(comment.parentId)?.author
        : post.author
      if (parentAuthor !== undefined && parentAuthor !== author) targets.set(parentAuthor, 'reply')
    }
    for (const name of mentions) if (!targets.has(name)) targets.set(name, 'mention')
    const outcomes: DeliveryOutcome[] = []
    for (const [recipient, reason] of targets) {
      outcomes.push(await deliverNotification(tables, {
        recipient,
        author,
        reason,
        boardId: post.boardId,
        postId: post.id,
        summary: `${author} ${reason === 'mention' ? 'mentioned you in' : 'answered you in'} "${post.title}"`,
        mode,
        ...comment === undefined ? {} : { commentId: comment.id },
      }, this.now(), (record: NotificationRecord) => this.link.wake(record)))
    }
    return outcomes
  }

  /** Run one read against the open domain. */
  private async read<T>(work: (domain: Domain<typeof forumDomain>) => T): Promise<T> {
    return work(await this.requireDomain())
  }

  /** Run one mutation at a time, preserving FIFO order. */
  private write<T>(work: (domain: Domain<typeof forumDomain>) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.requireDomain()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  /** One ISO instant, from the one clock the service reads. */
  private now(): string {
    return new Date().toISOString()
  }

  /** Dispatch the post-commit change notification, containing observer failures. */
  private emitChanged(): void {
    try {
      this.host.emit('forum/changed')
    } catch (error: unknown) {
      this.host.logger.warn(`forum: forum/changed listener failed: ${String(error)}`)
    }
  }

  /** Resolve the auto-post runner or refuse. */
  private requireRunner(): AutoPostRunner {
    if (this.runner === undefined) {
      throw new ForumError('forum/not-auto-postable', 'the auto-post runner is not ready yet; retry after startup finishes.')
    }
    return this.runner
  }

  /**
   * The narrow surface the model-facing tools read and write. Public by
   * design: the application layer (`@veren/forum-app`) rides the same port, so
   * the page tools and the global tools act on one record set (G2 package
   * split — the app face is a separate plugin over this service).
   * 面向模型的工具读写的窄接口。刻意公开：应用层（`@veren/forum-app`）走同一端口，
   * 页面工具与全局工具因此操作同一份记录集合（G2 拆包——应用面是本服务之上的独立插件）。
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

  /** The narrow surface the auto-post runner reads. */
  private runnerPort(): ForumRunnerPort {
    return {
      boards: () => this.read(domain => listBoards(this.tables(domain))),
      tags: () => this.read(domain => this.tagsOf(domain)),
      posts: (boardId, limit) => this.read(domain => listPosts(
        this.tables(domain), boardId, this.countersOf(domain), { nowMs: Date.now(), sort: 'new' },
      ).slice(0, limit)),
      publish: request => this.publish(request),
      people: () => this.people(),
      deliver: (recipient, text) => this.deliverText(recipient, text),
    }
  }

  /**
   * Hand one plain text notice to a preset's live Session.
   * @param recipient - the preset to reach.
   * @param text - the notice body.
   * @returns the delivery outcome.
   */
  private async deliverText(recipient: string, text: string): Promise<DeliveryOutcome> {
    const sessionId = this.link.sessionFor(recipient)
    const agent = sessionId === undefined ? undefined : this.host.agents.get(sessionId)
    if (agent === undefined || sessionId === undefined) {
      return { id: '', recipient, status: 'inboxed', detail: 'no live session for this preset' }
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: FORUM_MESSAGE_SOURCE, notificationId: '', postId: '' },
    }))
    const flushed = await this.host.sessions.flush(agent.session)
    return flushed
      ? { id: '', recipient, status: 'woken', sessionId }
      : { id: '', recipient, status: 'inboxed', sessionId, detail: 'session did not acknowledge the message' }
  }
}

export { ForumError } from './types.ts'
export { FORUM_DOMAIN_NAME, forumDomain } from './storage.ts'
export { listBoards, listPosts, listTags } from './posts.ts'
export { notificationText, FORUM_MESSAGE_SOURCE } from './session-link.ts'
// Shared tool plumbing re-exported for the application layer (`@veren/forum-app`):
// the app tools are the page-scoped twin of the global tools and must reuse the
// very same helpers, schemas, and error types — never a second copy (G2 split).
// 供应用层（`@veren/forum-app`）复用的共享工具管线再导出：应用工具是全局工具的页面侧
// 孪生，必须复用同一批助手、模式与错误类型——绝不做第二份副本（G2 拆包）。
export {
  ForumToolError, INBOX_SCHEMA, LIST_VIEW_SCHEMA, POST_SCHEMA, VOTE_SCHEMA, WRITE_SCHEMA,
  callerOf, noCaller, operationError, present, renderValue,
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

export default ForumService
