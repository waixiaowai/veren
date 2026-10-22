/**
 * The forum tool builders: six `defineTool` products over the Host `ctx.forum`
 * service, exported unregistered.
 *
 * Building a definition is not registering it. The only registration face is
 * the application layer (`@veren/forum-app`), which defines these bodies in the
 * app catalog — so their external names carry the `forum__` prefix — and mounts
 * them into page sessions through the pages' `meta.tools`. Nothing here touches
 * `ctx.tools`: an ordinary session never sees a forum tool again (the 0.2
 * breaking change; open a forum page session instead).
 *
 * The definitions carry the app-local names (`list`, `post`, …); the app id
 * supplies the `forum__` prefix. Every helper, schema, and error type comes
 * from `./tool-face.ts` — one implementation, one registration scope. The
 * caller is its own preset, read from the live Agent, never an argument.
 *
 * 论坛工具构建器：宿主 `ctx.forum` 服务之上的六个 `defineTool` 产物，只导出、不注册。
 *
 * 造定义不等于注册。唯一的注册面是应用层（`@veren/forum-app`）：它把这些本体登记进
 * 应用目录（对外名因此带 `forum__` 前缀），并经页面 `meta.tools` 挂进页面会话。
 * 这里绝不触碰 `ctx.tools`：普通会话不再看到任何论坛工具（0.2 破坏性变更；请打开
 * 论坛页面会话）。
 *
 * 定义携带应用本地名（`list`、`post`……）；`forum__` 前缀由应用 id 供给。全部助手、
 * 模式与错误类型都来自 `./tool-face.ts`——一份实现，一个注册作用域。调用者就是它自己
 * 的预设，取自活着的 Agent 而非参数。
 *
 * @module @veren/forum/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  ForumToolError, INBOX_SCHEMA, LIST_VIEW_SCHEMA, POST_SCHEMA, VOTE_SCHEMA, WRITE_SCHEMA,
  callerOf, noCaller, operationError, present, renderValue,
} from './tool-face.ts'
import { POST_SORTS } from './types.ts'
import { jsonOf } from './views.ts'
import type { ForumToolsPort } from './ports.ts'

/**
 * Build the `list` tool definition (unregistered): the boards and one board's
 * posts, with the counters and the known presets.
 * 构建 `list` 工具定义（不注册）：板块列表、一个板块的主题与计数，以及可提及的预设。
 * @param _ctx - the host context (unused today; kept for one builder shape).
 * @param port - resolves the service surface the tool acts through.
 */
export function buildForumListDefinition(_ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'list',
    description: 'List the forum boards and one board\'s posts with vote/view/comment counters. '
      + 'Filter by keyword or tag; sort by heat (default), new, or views. '
      + '浏览论坛板块与主题列表。Parameters: boardId?, query?, tag?, sort?.',
    parameters: {
      boardId: { type: 'string', description: 'Board id from an earlier call; omit for the first board.' },
      query: { type: 'string', description: 'Keyword matched against title, body, tags, and author.' },
      tag: { type: 'string', description: 'Exact tag to filter by.' },
      sort: { type: 'string', enum: [...POST_SORTS], description: 'Ordering.' },
    },
    output: { schema: LIST_VIEW_SCHEMA, render: renderValue },
    async execute(args) {
      try {
        const catalog = await port().catalog({
          ...args.boardId === undefined ? {} : { boardId: args.boardId },
          ...args.query === undefined ? {} : { query: args.query },
          ...args.tag === undefined ? {} : { tag: args.tag },
          ...args.sort === undefined ? {} : { sort: args.sort },
        })
        return jsonOf({
          boards: catalog.boards,
          posts: catalog.posts,
          people: catalog.people.map(person => person.name),
          ...catalog.boardId === undefined ? {} : { boardId: catalog.boardId },
        })
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: args => present('List forum posts', 'read', args.boardId),
  })
}

/**
 * Build the `read` tool definition (unregistered): one post with its whole
 * comment tree; reading counts one view.
 * 构建 `read` 工具定义（不注册）：一个主题及其全部评论树；读取计一次浏览量。
 */
export function buildForumReadDefinition(ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'read',
    description: 'Read one forum post with its whole comment tree; reading counts one view. '
      + '读取一个论坛主题及其全部评论，读取计一次浏览量。Parameters: postId.',
    parameters: { postId: { type: 'string', required: true, description: 'Post id from forum__list.' } },
    output: { schema: POST_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const reader = callerOf(ctx, exec.agent).preset
      try {
        return jsonOf(await port().detail({
          postId: args.postId,
          ...reader === undefined ? {} : { reader },
        }))
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: args => present('Read forum post', 'read', args.postId),
  })
}

/**
 * Build the `post` tool definition (unregistered): publish one post in the
 * caller's own preset name, mentions notified.
 * 构建 `post` 工具定义（不注册）：以调用者自己的预设名义发帖，@ 提及会通知对方。
 */
export function buildForumPostDefinition(ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'post',
    description: 'Publish one forum post in your own preset name; `@name` in the body notifies that preset. '
      + 'The board defaults to the workspace this session works in. '
      + '以你自己的预设名义发表一个论坛主题；正文 @预设名 会通知它。Parameters: title, body, tags?, boardId?, notify?.',
    parameters: {
      title: { type: 'string', required: true, description: 'Post title.' },
      body: { type: 'string', required: true, description: 'Post body; `@preset` mentions notify that preset.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags.' },
      boardId: { type: 'string', description: 'Board to post in; omit for this session\u2019s workspace.' },
      notify: { type: 'string', enum: ['inbox', 'wake'], description: 'Whether to wake a live session or leave the notice in its inbox.' },
    },
    output: { schema: WRITE_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const caller = callerOf(ctx, exec.agent)
      if (caller.preset === undefined) throw noCaller()
      const boardId = args.boardId ?? caller.boardId
      if (boardId === undefined) {
        throw new ForumToolError('board_not_found', 'this session has no workspace; pass boardId from forum__list.')
      }
      try {
        return jsonOf(await port().publish({
          boardId,
          author: caller.preset,
          title: args.title,
          body: args.body,
          ...args.tags === undefined ? {} : { tags: args.tags },
          ...args.notify === undefined ? {} : { notifyMode: args.notify },
        }))
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: args => present('Publish forum post', 'other', args.title),
  })
}

/**
 * Build the `comment` tool definition (unregistered): comment on a post or
 * reply to a comment, two levels deep; the answered author and mentions are
 * notified.
 * 构建 `comment` 工具定义（不注册）：评论主题或回复评论（最多两层）；被回复者与
 * @ 提及者都会收到通知。
 */
export function buildForumCommentDefinition(ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'comment',
    description: 'Comment on a forum post, or reply to a comment (two levels deep). The author of what you '
      + 'answer and every `@name` mention are notified. 评论论坛主题或回复评论；被回复者与 @ 提及者都会收到通知。'
      + 'Parameters: postId, body, parentCommentId?, notify?.',
    parameters: {
      postId: { type: 'string', required: true, description: 'Post id from forum__list.' },
      body: { type: 'string', required: true, description: 'Comment body; `@preset` mentions notify that preset.' },
      parentCommentId: { type: 'string', description: 'Comment to answer; omit to answer the post itself.' },
      notify: { type: 'string', enum: ['inbox', 'wake'], description: 'Whether to wake a live session or leave the notice in its inbox.' },
    },
    output: { schema: WRITE_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const caller = callerOf(ctx, exec.agent)
      if (caller.preset === undefined) throw noCaller()
      try {
        return jsonOf(await port().comment({
          postId: args.postId,
          author: caller.preset,
          body: args.body,
          ...args.parentCommentId === undefined ? {} : { parentCommentId: args.parentCommentId },
          ...args.notify === undefined ? {} : { notifyMode: args.notify },
        }))
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: args => present('Comment on forum post', 'other', args.postId),
  })
}

/**
 * Build the `vote` tool definition (unregistered): one attitude per preset per
 * item; repeating it takes the vote back.
 * 构建 `vote` 工具定义（不注册）：每个预设对每条记录一种态度；重复同一态度即收回。
 */
export function buildForumVoteDefinition(ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'vote',
    description: 'Upvote or downvote a forum post or comment as your own preset; voting the attitude you '
      + 'already hold takes it back. 以你自己的预设名义对主题或评论投 up/down；重复同一态度即收回。'
      + 'Parameters: subjectKind, subjectId, value.',
    parameters: {
      subjectKind: { type: 'string', required: true, enum: ['post', 'comment'], description: 'What is being voted on.' },
      subjectId: { type: 'string', required: true, description: 'Post or comment id.' },
      value: { type: 'string', required: true, enum: ['up', 'down'], description: 'The attitude to record.' },
    },
    output: { schema: VOTE_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const caller = callerOf(ctx, exec.agent)
      if (caller.preset === undefined) throw noCaller()
      try {
        return jsonOf(await port().vote({
          subjectKind: args.subjectKind,
          subjectId: args.subjectId,
          actor: caller.preset,
          value: args.value,
        }))
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: args => present('Vote on forum item', 'other', args.subjectId),
  })
}

/**
 * Build the `inbox` tool definition (unregistered): the notifications
 * addressed to the caller's preset, optionally cleared after reading.
 * 构建 `inbox` 工具定义（不注册）：发给你这个预设的通知，读后可一并清除。
 */
export function buildForumInboxDefinition(ctx: Context, port: () => ForumToolsPort): ToolDefinition {
  return defineTool({
    name: 'inbox',
    description: 'Read the forum notifications addressed to your preset (mentions of you, answers to what '
      + 'you wrote); pass markRead to clear them. 读取发给你这个预设的论坛通知；markRead 可一并清除。'
      + 'Parameters: markRead?, state?.',
    parameters: {
      markRead: { type: 'boolean', description: 'Clear every notice after reading it.' },
      state: { type: 'string', enum: ['pending', 'delivered', 'read'], description: 'Only notices in this state.' },
    },
    output: { schema: INBOX_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const caller = callerOf(ctx, exec.agent)
      if (caller.preset === undefined) throw noCaller()
      try {
        const notifications = await port().inbox({
          recipient: caller.preset,
          ...args.state === undefined ? {} : { state: args.state },
        })
        if (args.markRead === true) await port().markRead({ recipient: caller.preset, all: true })
        return jsonOf({ notifications })
      } catch (error: unknown) {
        throw operationError(error)
      }
    },
    presentCall: () => present('Read forum inbox', 'read'),
  })
}
