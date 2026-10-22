/**
 * Shared tool plumbing for the forum's model-facing tools: stable refusals,
 * canonical output schemas, the generic pending card, and caller identity.
 *
 * One copy lives here and every consumer imports it: the builders in
 * `./tools.ts` and the application layer (`@veren/forum-app`). The person
 * making a call is the caller's own preset, read from the live Agent rather
 * than from an argument — a preset cannot post as another preset by passing a
 * different name.
 *
 * 论坛面向模型工具的共享管线：稳定拒绝、规范输出模式、通用待处理卡片，以及调用者身份。
 *
 * 这里只有一份实现，所有消费方都从它导入：`./tools.ts` 里的构建器与应用层
 * （`@veren/forum-app`）。发起调用的人就是调用者自己的预设，取自活着的 Agent 而不是
 * 参数——预设无法通过传另一个名字来以别人身份发帖。
 *
 * @module @veren/forum/tool-face
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: pull the declared service faces into this file. All three are hard
// injects of the owning service (G13) and are read directly, never probed.
// 仅类型导入：把声明的服务面拉进本文件。三者都是所属服务的硬 inject（G13），
// 直接读取，绝不探测。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-workspace'
import { ForumError } from './types.ts'

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
 * `agentPresets` / `workingDirectory` / `workspaceRegistry` are declared hard
 * injects of the owning service (G13): the merged faces are read directly —
 * the old `?.` "absent → degrade" branches never worked on a live host.
 * 解析调用者及其工作目录所属的板块。三个服务面都是所属服务声明的硬 inject（G13）：
 * 直接读合并后的真实服务面——过去"缺席即降级"的 `?.` 分支在真实宿主上从未生效。
 * @param ctx - Host context carrying the Session and workspace services.
 * @param agent - the calling Agent, when the execution has one.
 * @returns the caller's preset and board, each absent when it cannot be resolved.
 */
export function callerOf(ctx: Context, agent: Agent | undefined): Caller {
  if (agent === undefined) return { preset: undefined, boardId: undefined }
  const preset = ctx.agentPresets.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
  const cwd = ctx.workingDirectory.get(agent.session)
  if (cwd === undefined) return { preset, boardId: undefined }
  const workspace = ctx.workspaceRegistry.list()
    .find(candidate => candidate.path === cwd)
  return { preset, boardId: workspace?.id }
}
