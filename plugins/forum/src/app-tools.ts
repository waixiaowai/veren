/**
 * The forum app's tool catalog: `defineTool` bodies registered under the app
 * id, so their external names carry the `forum__` prefix.
 *
 * These are the page-scoped twin of the legacy global `forum_*` tools: same
 * service port, same caller identity rule (the caller is its own preset, read
 * from the live Agent, never an argument), shorter local names for the app
 * catalog.
 *
 * 论坛应用的工具目录：`defineTool` 本体注册在应用 id 下，对外名因此带 `forum__` 前缀。
 *
 * 它们是既有全局 `forum_*` 工具的页面侧孪生：同一服务端口、同一身份规则（调用者就是它自己
 * 的预设，取自活着的 Agent 而非参数）、更短的本地名以进应用目录。
 *
 * @module @veren/forum/app-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ForumToolsPort } from './ports.ts'
import { jsonOf } from './views.ts'
import {
  ForumToolError, INBOX_SCHEMA, LIST_VIEW_SCHEMA, POST_SCHEMA, VOTE_SCHEMA, WRITE_SCHEMA,
  callerOf, noCaller, operationError, present, renderValue,
} from './tools.ts'

/** One forum tool set bound to one service port. */
type ForumTool = ToolDefinition

/**
 * Build the app tools. Every execute resolves its caller from the live Agent
 * and refuses without one, then acts through the port.
 * 构建应用工具。每个 execute 都从活着的 Agent 解析调用者，缺身份即拒绝，随后经端口行动。
 * @param ctx - Context carrying Session and workspace services for caller identity.
 * @param port - resolves the service surface the tools act through.
 * @returns the tool bodies, in catalog order.
 */
export function createForumAppTools(ctx: Context, port: () => ForumToolsPort): readonly ForumTool[] {
  return [
    listTool(port),
    readTool(ctx, port),
    postTool(ctx, port),
    commentTool(ctx, port),
    voteTool(ctx, port),
    inboxTool(ctx, port),
  ]
}

/** List boards and posts / 列出板块与主题 */
function listTool(port: () => ForumToolsPort): ForumTool {
  return defineTool({
    name: 'list',
    description: 'List the forum boards and one board\'s posts with vote/view/comment counters. '
      + 'Filter by keyword or tag; sort by heat (default), new, or views. '
      + '浏览论坛板块与主题列表。Parameters: boardId?, query?, tag?, sort?.',
    parameters: {
      boardId: { type: 'string', description: 'Board id from an earlier call; omit for the first board.' },
      query: { type: 'string', description: 'Keyword matched against title, body, tags, and author.' },
      tag: { type: 'string', description: 'Exact tag to filter by.' },
      sort: { type: 'string', enum: ['heat', 'new', 'views'], description: 'Ordering.' },
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

/** Read one post / 读一个主题 */
function readTool(ctx: Context, port: () => ForumToolsPort): ForumTool {
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

/** Publish one post / 发一个主题 */
function postTool(ctx: Context, port: () => ForumToolsPort): ForumTool {
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

/** Comment or reply / 评论或回复 */
function commentTool(ctx: Context, port: () => ForumToolsPort): ForumTool {
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

/** Vote / 投票 */
function voteTool(ctx: Context, port: () => ForumToolsPort): ForumTool {
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

/** Inbox / 收件箱 */
function inboxTool(ctx: Context, port: () => ForumToolsPort): ForumTool {
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
