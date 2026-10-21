/**
 * Model-facing `notebook_*` tools over the Host `ctx.notebook` service.
 *
 * The owner is read from the live Agent on every call and is never a parameter.
 * A preset therefore has no way to name another preset's notebook: the tool
 * schema cannot express it, and the service composes every key from the owner
 * it was handed by this file. Registering into the mounting scope decides which
 * agents receive the tools, exactly as the forum tools do.
 *
 * 面向模型的 `notebook_*` 工具族，作用于宿主 `ctx.notebook` 服务。
 *
 * 归属在每次调用时取自活着的 Agent，永远不是参数。因此预设没有任何办法指定别人的记事本：工具
 * schema 表达不了，服务又只用本文件交给它的归属去拼每一个键。注册到哪个作用域决定哪些 agent
 * 拿到这些工具，与论坛工具一致。
 *
 * @module @veren/notebook/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { NotebookError } from './notes.ts'
import type { NotebookToolsPort } from './types.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face
// (a declared hard inject of the owning service; read directly, never probed).
// 仅类型导入：把 `ctx.agentPresets` 的服务声明拉进本文件（所属服务的硬 inject，
// 直接读取，绝不探测）。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
// 无损 JSON 投影只有一份实现（@veren/core）；此处按原名转出，公共面不变。
// The lossless-JSON projection lives in exactly one place (@veren/core); it is
// re-exported here under the original names, so the surface stays unchanged.
import { jsonOf } from '@veren/core'
export type { Json, JsonShape } from '@veren/core'
import type { JsonShape } from '@veren/core'

/** One refused call: a stable notebook code plus a model-facing account. */
class NotebookToolError extends Error {
  /**
   * @param code - stable machine-readable reason.
   * @param message - model-facing account of the refusal.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'NotebookToolError'
  }
}

/** Canonical list value: list rows without full bodies. */
export const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical single-note value. */
export const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    note: { type: 'json', required: true },
  },
} as const

/** Canonical delete value. */
export const DELETE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deleted: { type: 'boolean', required: true },
  },
} as const

/** Deterministic model content for every canonical tool value. */
export function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable refusal for failures not safe to expose. */
function internalError(): NotebookToolError {
  return new NotebookToolError('internal_error', 'The notebook operation failed.')
}

/** Translate a structured refusal while withholding internal storage failures. */
function operationError(error: unknown): NotebookToolError {
  return error instanceof NotebookError ? new NotebookToolError(error.code, error.message) : internalError()
}

/** Refuse a call that cannot name its owner. */
function noCaller(): NotebookToolError {
  return new NotebookToolError(
    'no_caller',
    'this call has no agent, so there is no preset whose notebook it could use.',
  )
}

/**
 * Resolve the calling preset from the live Agent. `agentPresets` is a declared
 * hard inject of the owning service, so the merged face is read directly —
 * no runtime probing (G13).
 * 从活 Agent 解析调用者的预设。`agentPresets` 是所属服务声明的硬 inject，
 * 直接读声明合并的真实服务面——不做运行期探测（G13）。
 * @param ctx - Host context carrying the preset registry.
 * @param agent - the calling Agent, when the execution has one.
 * @returns the caller's preset id, or `undefined` outside an agent.
 */
function callerOf(ctx: Context, agent: Agent | undefined): string | undefined {
  if (agent === undefined) return undefined
  return ctx.agentPresets.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
}

/**
 * Register every notebook tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param port - resolves the service surface the tools act through.
 */
export function registerNotebookTools(ctx: Context, port: () => NotebookToolsPort): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(defineTool({
        name: 'notebook_list',
        description: 'List the notes in your own preset\u2019s private notebook, newest update first. '
          + 'Every preset has its own notebook, it follows the preset across workspaces, and no other preset '
          + 'can read it. Results carry ids, titles, excerpts, and timestamps; use notebook_read for a full body.',
        parameters: {},
        output: { schema: LIST_SCHEMA, render: renderValue },
        async execute(_args, exec) {
          const owner = callerOf(ctx, exec.agent)
          if (owner === undefined) throw noCaller()
          try {
            return jsonOf({ notes: await port().list(owner) })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: () => present('List notebook notes', 'read'),
      })),
      ctx.tools.register(defineTool({
        name: 'notebook_read',
        description: 'Read one note from your own preset\u2019s private notebook, including its whole body.',
        parameters: {
          id: { type: 'string', required: true, description: 'Note id from notebook_list.' },
        },
        output: { schema: NOTE_SCHEMA, render: renderValue },
        async execute(args, exec) {
          const owner = callerOf(ctx, exec.agent)
          if (owner === undefined) throw noCaller()
          try {
            return jsonOf({ note: await port().read(owner, args.id) })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Read notebook note', 'read', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'notebook_create',
        description: 'Write a note into your own preset\u2019s private notebook. Use it for facts worth keeping '
          + 'and finding again later; the note is global to the preset, not attached to this workspace.',
        parameters: {
          title: { type: 'string', required: true, description: 'Short note title.' },
          body: { type: 'string', required: true, description: 'Note body; may be empty.' },
        },
        output: { schema: NOTE_SCHEMA, render: renderValue },
        async execute(args, exec) {
          const owner = callerOf(ctx, exec.agent)
          if (owner === undefined) throw noCaller()
          try {
            return jsonOf({ note: await port().create(owner, args.title, args.body) })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Write notebook note', 'other', args.title),
      })),
      ctx.tools.register(defineTool({
        name: 'notebook_update',
        description: 'Change one note in your own preset\u2019s private notebook. Supply a new title, a new body, '
          + 'or both. Pass expectedUpdatedAt from the note you read to be refused instead of overwriting a newer edit.',
        parameters: {
          id: { type: 'string', required: true, description: 'Note id from notebook_list.' },
          title: { type: 'string', description: 'Replacement title; omit to keep the current one.' },
          body: { type: 'string', description: 'Replacement body; omit to keep the current one.' },
          expectedUpdatedAt: {
            type: 'string',
            description: 'The updatedAt you last read; the write is refused if the note changed since.',
          },
        },
        output: { schema: NOTE_SCHEMA, render: renderValue },
        async execute(args, exec) {
          const owner = callerOf(ctx, exec.agent)
          if (owner === undefined) throw noCaller()
          try {
            return jsonOf({
              note: await port().update(owner, args.id, {
                ...args.title === undefined ? {} : { title: args.title },
                ...args.body === undefined ? {} : { body: args.body },
                ...args.expectedUpdatedAt === undefined
                  ? {}
                  : { expectedUpdatedAt: args.expectedUpdatedAt },
              }),
            })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Update notebook note', 'other', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'notebook_delete',
        description: 'Delete one note from your own preset\u2019s private notebook. Deleting is permanent; '
          + 'the note must belong to the calling preset.',
        parameters: {
          id: { type: 'string', required: true, description: 'Note id from notebook_list.' },
        },
        output: { schema: DELETE_SCHEMA, render: renderValue },
        async execute(args, exec) {
          const owner = callerOf(ctx, exec.agent)
          if (owner === undefined) throw noCaller()
          try {
            return jsonOf({ deleted: await port().remove(owner, args.id) })
          } catch (error: unknown) {
            throw operationError(error)
          }
        },
        presentCall: args => present('Delete notebook note', 'other', args.id),
      })),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'notebook:tools()')
}

/**
 * Run one owner-scoped notebook operation for a tool call: resolve the caller's
 * preset from the live Agent, project the result onto lossless JSON, and
 * translate refusals into stable model-facing errors. Shared by the global
 * `notebook_*` tools and the `notebook` application's page tools.
 *
 * 为一次工具调用运行一个按归属限定的记事本操作：从活 Agent 解析调用者的预设，
 * 把结果投影成无损 JSON，并把拒绝翻译成稳定的模型可见错误。全局 `notebook_*`
 * 工具与 `notebook` 应用的页面工具共用这一条路径。
 *
 * @param ctx - Host context carrying the preset registry.
 * @param agent - the calling Agent, when the execution has one.
 * @param run - the operation, receiving the resolved owner.
 * @returns the operation result as canonical JSON.
 */
export async function notebookToolValue<T>(
  ctx: Context,
  agent: Agent | undefined,
  run: (owner: string) => Promise<T>,
): Promise<JsonShape<T>> {
  const owner = callerOf(ctx, agent)
  if (owner === undefined) throw noCaller()
  try {
    return jsonOf(await run(owner))
  } catch (error: unknown) {
    throw operationError(error)
  }
}
