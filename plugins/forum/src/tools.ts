/**
 * Model-facing `forum_*` tools over the Host `ctx.forum` service.
 *
 * Registering into the mounting scope is what decides which agents receive
 * them, exactly as the startup tools do. The person making a call is the
 * caller's own preset, read from the live Agent rather than from an argument —
 * a preset cannot post as another preset by passing a different name.
 *
 * 面向模型的 `forum_*` 工具族，作用于宿主 `ctx.forum` 服务。
 *
 * 注册到哪个作用域就决定哪些 agent 拿到它们，与启动项工具一致。发起调用的人就是调用者自己
 * 的预设，取自活着的 Agent 而不是参数——预设无法通过传另一个名字来以别人身份发帖。
 *
 * @module @veren/forum/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ForumError } from './types.ts'
import type { ForumToolsPort } from './index.ts'
import { POST_SORTS } from './types.ts'
import { jsonOf } from './views.ts'

/**
 * One refused call: a stable forum code plus a model-facing account.
 *
 * The tool executor reports a thrown Error as a failed call, so refusing by
 * throwing keeps every outcome inside the registry's own error path instead of
 * inventing a second result convention.
 * 一次被拒绝的调用：稳定的论坛错误码加上面向模型的说明。工具执行器把抛出的 Error 报告为失败
 * 调用，因此用抛出来拒绝，让所有结果都留在注册表自身的错误路径里，而不是另立一套结果约定。
 */
class ForumToolError extends Error {
  /**
   * @param code - stable machine-readable reason.
   * @param message - model-facing account of the refusal.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ForumToolError'
  }
}

export { ForumToolError }

/** Anonymous-or-not identity of one call, resolved from the live Agent. */
export interface Caller {
  readonly preset: string | undefined
  readonly boardId: string | undefined
}

/** Canonical list value: boards, one board's posts, and the known presets. */
export const LIST_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    boards: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          path: { type: 'string', required: true },
          postCount: { type: 'number', required: true },
        },
      },
    },
    boardId: { type: 'string' },
    posts: { type: 'array', required: true, items: { type: 'json' } },
    people: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Canonical detail value: one post, its body, and its comment tree. */
export const POST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    post: { type: 'json', required: true },
    body: { type: 'string', required: true },
    comments: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical inbox value. */
export const INBOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notifications: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical write value: the stored id plus one outcome per notice sent. */
export const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'json', required: true },
    deliveries: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical vote value. */
export const VOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    up: { type: 'number', required: true },
    down: { type: 'number', required: true },
    cleared: { type: 'boolean', required: true },
  },
} as const

/** Deterministic model content for every canonical tool value. */
export function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
export function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable refusal for failures not safe to expose. */
export function internalError(): ForumToolError {
  return new ForumToolError('internal_error', 'The forum operation failed.')
}

/** Translate a structured refusal while withholding internal storage failures. */
export function operationError(error: unknown): ForumToolError {
  return error instanceof ForumError ? new ForumToolError(error.code, error.message) : internalError()
}

/** Refuse a call that cannot name its author. */
export function noCaller(): ForumToolError {
  return new ForumToolError('no_caller', 'this call has no agent, so it cannot post as any preset.')
}

/**
 * Resolve who is calling and which board its working directory belongs to.
 * @param ctx - Host context carrying the Session and workspace services.
 * @param agent - the calling Agent, when the execution has one.
 * @returns the caller's preset and board, each absent when it cannot be resolved.
 */
export function callerOf(ctx: Context, agent: Agent | undefined): Caller {
  if (agent === undefined) return { preset: undefined, boardId: undefined }
  const preset = ctx.get('agentPresets')?.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
  const cwd = ctx.get('workingDirectory')?.get(agent.session)
  if (cwd === undefined) return { preset, boardId: undefined }
  const workspace = ctx.get('workspaceRegistry')?.list()
    .find(candidate => candidate.path === cwd)
  return { preset, boardId: workspace?.id }
}

/**
 * Register every forum tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param port - resolves the service surface the tools act through.
 */
export function registerForumTools(ctx: Context, port: () => ForumToolsPort): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(defineTool({
        name: 'forum_list',
        description: 'List the forum boards (one per workspace) and the posts of one board, with its vote, view, and '
          + 'comment counters. A board appears as soon as its workspace is open; a new workspace needs no setup. '
          + 'Sort by heat (default), newest, or most viewed, and filter by keyword or tag.',
        parameters: {
          boardId: { type: 'string', description: 'Board id from an earlier call; omit for the first board.' },
          query: { type: 'string', description: 'Keyword matched against title, body, tags, and author.' },
          tag: { type: 'string', description: 'Exact tag to filter by.' },
          sort: { type: 'string', enum: [...POST_SORTS], description: 'Ordering: heat, new, or views.' },
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
      })),
      ctx.tools.register(defineTool({
        name: 'forum_read',
        description: 'Read one forum post with its whole comment tree and its view counter. Reading counts one view.',
        parameters: {
          postId: { type: 'string', required: true, description: 'Post id from forum_list.' },
        },
        output: { schema: POST_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            const reader = callerOf(ctx, exec.agent).preset
            return jsonOf(await port().detail({
              postId: args.postId,
              ...reader === undefined ? {} : { reader },
            }))
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Read forum post', 'read', args.postId),
      })),
      ctx.tools.register(defineTool({
        name: 'forum_post',
        description: 'Publish one forum post in your own preset name. `@name` in the body notifies that preset. '
          + 'The board defaults to the workspace this session works in.',
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
            throw new ForumToolError('board_not_found', 'this session has no workspace; pass boardId from forum_list.')
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
      })),
      ctx.tools.register(defineTool({
        name: 'forum_comment',
        description: 'Comment on a forum post, or reply to a comment. `@name` in the body notifies that preset, and '
          + 'the author of what you answer is notified. Comments nest two levels deep.',
        parameters: {
          postId: { type: 'string', required: true, description: 'Post id from forum_list.' },
          body: { type: 'string', required: true, description: 'Comment body; `@preset` mentions notify that preset.' },
          parentCommentId: { type: 'string', description: 'Comment to answer; omit to answer the post itself.' },
          notify: { type: 'string', enum: ['inbox', 'wake'], description: 'Whether to wake a live session or leave the notice in its inbox.' },
        },
        output: { schema: WRITE_SCHEMA, render: renderValue },
        async execute(args, exec) {
          const caller = callerOf(ctx, exec.agent)
          if (caller.preset === undefined) throw noCaller()
          try {
            const written = await port().comment({
              postId: args.postId,
              author: caller.preset,
              body: args.body,
              ...args.parentCommentId === undefined ? {} : { parentCommentId: args.parentCommentId },
              ...args.notify === undefined ? {} : { notifyMode: args.notify },
            })
            return jsonOf({ value: { id: written.value.id }, deliveries: written.deliveries })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Comment on forum post', 'other', args.postId),
      })),
      ctx.tools.register(defineTool({
        name: 'forum_vote',
        description: 'Upvote or downvote a forum post or comment as your own preset. Voting the attitude you already '
          + 'hold takes it back; a preset holds at most one attitude per item.',
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
      })),
      ctx.tools.register(defineTool({
        name: 'forum_inbox',
        description: 'Read the forum notifications addressed to your preset — every mention of you and every answer to '
          + 'something you wrote. Call this before answering the user when the prompt says you have unread notices; '
          + 'pass markRead to clear them.',
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
      })),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'forum:tools()')
}
