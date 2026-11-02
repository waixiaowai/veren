/**
 * Notebook tool builders: one `defineTool` product per notebook operation,
 * scoped to its caller at execution time.
 *
 * Nothing registers here. A mounter — today the notebook application
 * (`@veren/notebook-app`), the only registration face — defines the built
 * tools into the app catalog and mounts them into page sessions via
 * `meta.tools`, so the registry composes the external `notebook__<local>`
 * names and a tool only ever reaches a session that opened a notebook page.
 * The owner is read from the live Agent on every call and is never a
 * parameter: a preset has no way to name another preset's notebook, because
 * the tool schema cannot express it and `notebookToolValue` composes every
 * key from the owner it resolved.
 *
 * 记事本工具构建器：一次记事本操作对应一个 `defineTool` 产物，执行时按调用者限定。
 *
 * 本文件不做任何注册。挂载方——今天是记事本应用（`@veren/notebook-app`，唯一的
 * 注册面）——把构建产物 define 进应用目录，并经 `meta.tools` 挂进页面会话；注册表
 * 因此拼出对外名 `notebook__<本地名>`，工具也只会到达打开过记事本页面的会话。归属
 * 在每次调用时取自活着的 Agent，永远不是参数：预设没有任何办法指定别人的记事本，
 * 工具 schema 表达不了，`notebookToolValue` 又只用它解析出的归属去拼每一个键。
 *
 * @module @veren/notebook/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { NotebookToolsPort } from './types.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face
// (a declared hard inject of the owning service; read directly, never probed).
// 仅类型导入：把 `ctx.agentPresets` 的服务声明拉进本文件（所属服务的硬 inject，
// 直接读取，绝不探测）。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
// 无损 JSON 投影只有一份实现（@veren/core）。
// The lossless-JSON projection lives in exactly one place (@veren/core).
import { jsonOf } from '@veren/core'
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
const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical single-note value. */
const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    note: { type: 'json', required: true },
  },
} as const

/** Canonical delete value. */
const DELETE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deleted: { type: 'boolean', required: true },
  },
} as const

/** Deterministic model content for every canonical tool value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Generic pending card: reads render as reads, writes as other work. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable refusal for failures not safe to expose. */
function internalError(): NotebookToolError {
  return new NotebookToolError('internal_error', 'The notebook operation failed.')
}

/**
 * Translate one caught value into the model-facing refusal. Discrimination
 * rides the framework's structural marker (`remoteErrorOf`) rather than
 * `instanceof`: a dual package instance — a nested `node_modules` copy
 * resolving the same import to a second class identity — makes instanceof
 * falsely false and flattened every refusal into the generic text.
 * 把捕获值翻译成面向模型的拒绝。识别走框架的结构标记（`remoteErrorOf`）而非
 * `instanceof`：双包实例——嵌套 `node_modules` 副本把同一导入解析成第二个类
 * 身份——会让 instanceof 假阴，把所有拒绝压成通用文案。
 */
function operationError(error: unknown): NotebookToolError {
  const remote = remoteErrorOf(error)
  if (remote !== undefined && remote.code.startsWith('notebook/')) {
    return new NotebookToolError(remote.code, remote.message)
  }
  return internalError()
}

export { notebookToolValue, present, renderValue }

/** Refuse a call that cannot name its owner. */
function noCaller(): NotebookToolError {
  return new NotebookToolError(
    'no_caller',
    'this call has no agent, so there is no preset whose notebook it could use.',
  )
}

/** The shared note id parameter. 共享的笔记 id 参数。 */
const NOTE_ID_PARAM = { id: { type: 'string', description: '笔记 id，来自 list_notes', required: true } } as const

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
 * Run one owner-scoped notebook operation for a tool call: resolve the caller's
 * preset from the live Agent, project the result onto lossless JSON, and
 * translate refusals into stable model-facing errors.
 * 为一次工具调用运行一个按归属限定的记事本操作：从活 Agent 解析调用者的预设，
 * 把结果投影成无损 JSON，并把拒绝翻译成稳定的模型可见错误。
 */
async function notebookToolValue<T>(
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

/** 列表工具构建器：列出调用者预设的卡片，最新更新在前 / the list tool builder: the caller preset's cards, newest update first */
export function buildNotebookListDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'list_notes',
    description: 'List the cards in the caller preset\u2019s private card box, newest first; '
      + 'rows carry ids, titles, excerpts, and timestamps. Parameters: none.',
    parameters: {},
    output: { schema: LIST_SCHEMA, render: renderValue },
    execute: (_args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({ notes: await port().list(owner) })),
    presentCall: () => present('列出卡片', 'read'),
  })
}

/** 读取工具构建器：读一张卡的全文 / the read tool builder: one card's whole body */
export function buildNotebookReadDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'read_note',
    description: 'Read one card of the caller preset\u2019s card box, including its whole body. Parameters: id.',
    parameters: NOTE_ID_PARAM,
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({ note: await port().read(owner, args.id) })),
    presentCall: args => present('读取卡片', 'read', args.id),
  })
}

/** 新建工具构建器：写入一张新卡 / the write tool builder: one new card */
export function buildNotebookWriteDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'write_note',
    description: 'Write a new card into the caller preset\u2019s card box. One card carries one idea and '
      + 'reads on its own; the title is a complete phrase and doubles as the card\u2019s link address, so it '
      + 'must be unique in the box. Link related cards inline with [[title]] — every target must already '
      + 'exist, and the write is refused otherwise. Parameters: title, body.',
    parameters: {
      title: { type: 'string', description: '完整短语标题，一卡一想法', required: true },
      body: { type: 'string', description: '正文，可含 [[标题]] 链接；目标必须已存在', required: true },
    },
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ note: await port().create(owner, args.title, args.body) })),
    presentCall: args => present('新建卡片', 'other', args.title),
  })
}

/** 改写工具构建器：替换标题/正文，带乐观并发守卫 / the rewrite tool builder: title/body replacement with the optimistic-concurrency guard */
export function buildNotebookRewriteDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'rewrite_note',
    description: 'Replace the title, the body, or both of one card of the caller preset\u2019s card box. '
      + 'Pass the updatedAt you read as expectedUpdatedAt to be refused instead of overwriting a newer edit. '
      + 'Renaming the card retargets every inbound link automatically; a new body must still satisfy the '
      + '[[title]] link rules. Parameters: id, title?, body?, expectedUpdatedAt?.',
    parameters: {
      ...NOTE_ID_PARAM,
      title: { type: 'string', description: '新标题；省略则保留；改名后入链自动跟随' },
      body: { type: 'string', description: '新正文；省略则保留；[[标题]] 目标必须已存在' },
      expectedUpdatedAt: { type: 'string', description: '上次读到的 updatedAt；卡片已被改动时本次写入被拒绝' },
    },
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({
      note: await port().update(owner, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: args.expectedUpdatedAt }),
      }),
    })),
    presentCall: args => present('改写卡片', 'other', args.id),
  })
}

/** 删除工具构建器：永久删除一张卡 / the delete tool builder: one card, permanently */
export function buildNotebookDeleteDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'delete_note',
    description: 'Permanently delete one card of the caller preset\u2019s card box; confirm with the user '
      + 'before calling. Refused while other cards still link to it \u2014 remove those [[title]] links first. '
      + 'Parameters: id.',
    parameters: NOTE_ID_PARAM,
    output: { schema: DELETE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ deleted: await port().remove(owner, args.id) })),
    presentCall: args => present('删除卡片', 'other', args.id),
  })
}
