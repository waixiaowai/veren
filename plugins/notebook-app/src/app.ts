/**
 * The notebook application layer: the `notebook` app, its two pages, and its
 * app-scoped page tools, registered through the host application registry
 * (`ctx.apps`) exactly the way task-workbench does it.
 *
 * Single-entry registration: `ctx.apps.pages(id).register(page)` mirrors every
 * page into the page registry internally, so this file never calls
 * `ctx.pageRegistry.registerAppPage` itself.
 *
 * 记事本应用层：`notebook` 应用、它的两个页面与应用级页面工具，经宿主应用注册表
 * （`ctx.apps`）注册，写法与 task-workbench 一致。
 *
 * 单入口注册：`ctx.apps.pages(id).register(page)` 会在内部把页面镜像进页面注册表，
 * 因此本文件绝不直接调用 `ctx.pageRegistry.registerAppPage`。
 *
 * 本文件整体从 `@veren/notebook` 的应用面迁入（G2 拆包）：应用层独立成包，宿主包在
 * 框架缺席的部署里照常激活。
 * This file moved verbatim from the `@veren/notebook` app face (G2 split): the
 * application layer is its own package, so the host package activates even in
 * framework-absent deployments.
 *
 * @module @veren/notebook-app/app
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
// Type-only: pulls `ctx.apps` / `ctx.pageRegistry` declarations into this face.
// 仅类型导入：把 `ctx.apps` / `ctx.pageRegistry` 的声明拉进本文件。
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { DELETE_SCHEMA, LIST_SCHEMA, NOTE_SCHEMA, notebookToolValue, renderValue } from '@veren/notebook'
import type { NoteSummary, NoteView, NotebookToolsPort } from '@veren/notebook'

// ---- 应用定义 / the application definition ----

export const APP_ID = 'notebook' as AppId

/** 应用定义：entry 是应用内页面键，不是 URL / entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '记事本',
  description: '浏览、撰写、修订每个 agent 预设的私密持久笔记',
  entry: 'list' as PageKey,
  instructions: '记事本负责私密笔记的浏览与撰写：列表页浏览/新建，详情页读取/改写/删除单条笔记。'
    + '所有操作通过本页挂载的 notebook__* 工具完成；工具自动作用于调用者自己的预设，不需要也不能指定归属。',
  toolPrefix: 'notebook',
}

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

// ---- 页面 / the pages（defineAppPage，URL 统一 /apps/notebook/...）----

/** 入口页（笔记列表）/ the entry page (the note list) */
export const listPage: PageDefinition<readonly NoteSummary[]> = defineAppPage<readonly NoteSummary[]>({
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '记事本列表页：浏览当前预设的全部笔记，并可新建笔记',
  tools: ['list_notes', 'write_note'],
  instructions: '这是记事本的列表页。页面状态经 SNAPSHOT/PATCH 同步，'
    + '{"kind":"keyed","path":"notes","items":[...]} 按条目 id 对位。'
    + '用 list_notes 刷新列表，用 write_note 新建笔记；新建后报出笔记标题即可。',
  instanceTitle: () => '笔记列表',
  tree: (_params, notes) => [
    ...Static({ content: '记事本 · 笔记列表' }),
    ...Keyed({ path: 'notes', items: notes }),
  ],
})

/** 笔记详情页 / the note detail page */
export const notePage: PageDefinition<NoteView | undefined> = defineAppPage<NoteView | undefined>({
  name: 'note',
  url: `${URL_PREFIX}/note/:noteId`,
  description: '笔记详情页：查看并改写单条笔记的标题与正文，或删除它',
  tools: ['read_note', 'rewrite_note', 'delete_note'],
  instructions: '这是笔记详情页：字段经 data 节点（note.title/note.body/note.updatedAt）同步。'
    + '用 read_note 读取全文；用 rewrite_note 改写，携带读到的 updatedAt 作 expectedUpdatedAt 防覆盖；'
    + 'delete_note 永久删除，删除前先向用户确认。',
  instanceTitle: (params) => `笔记 #${params.noteId ?? ''}`,
  tree: (_params, note) => [
    ...Static({ content: '记事本 · 笔记详情' }),
    ...Data({ path: 'note.title', value: note?.title ?? null }),
    ...Data({ path: 'note.body', value: note?.body ?? null }),
    ...Data({ path: 'note.updatedAt', value: note?.updatedAt ?? null }),
  ],
})

// ---- 应用级工具 / app-scoped tools ----

/** 通用 pending 卡片 / the generic pending card */
function present(title: string, rawInput?: unknown): { card: 'generic'; title: string; kind: 'other'; rawInput?: unknown } {
  return { card: 'generic', title, kind: 'other', ...(rawInput === undefined ? {} : { rawInput }) }
}

/** 笔记 id 参数 / the shared note id parameter */
const NOTE_ID_PARAM = { id: { type: 'string', description: '笔记 id，来自 list_notes', required: true } } as const

/**
 * 定义应用全部页面工具：`defineTool` 产物（DSH `ToolDefinition` 本体），本地名
 * 应用内唯一；对外名由注册表拼 `notebook__<本地名>`。归属永远取自调用者，
 * 不接受归属参数。
 * Define every page tool: `defineTool` bodies with app-unique local names; the
 * registry composes the external `notebook__<local>` names. The owner always
 * comes from the caller and is never a parameter.
 */
export function createAppTools(ctx: Context, port: () => NotebookToolsPort): ToolDefinition[] {
  return [
    listNotesTool(ctx, port), readNoteTool(ctx, port), writeNoteTool(ctx, port),
    rewriteNoteTool(ctx, port), deleteNoteTool(ctx, port),
  ]
}

/** 列表工具 / the list tool */
function listNotesTool(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'list_notes',
    description: 'List the notes in the caller preset\u2019s private notebook, newest first; '
      + 'rows carry ids, titles, excerpts, and timestamps. Parameters: none.',
    parameters: {},
    output: { schema: LIST_SCHEMA, render: renderValue },
    execute: (_args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({ notes: await port().list(owner) })),
    presentCall: () => present('列出笔记'),
  })
}

/** 读取工具 / the read tool */
function readNoteTool(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'read_note',
    description: 'Read one note of the caller preset\u2019s notebook, including its whole body. Parameters: id.',
    parameters: NOTE_ID_PARAM,
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({ note: await port().read(owner, args.id) })),
    presentCall: args => present('读取笔记', args.id),
  })
}

/** 新建工具 / the create tool */
function writeNoteTool(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'write_note',
    description: 'Write a new note into the caller preset\u2019s notebook; the title must not be blank. '
      + 'Parameters: title, body.',
    parameters: {
      title: { type: 'string', description: '简短标题', required: true },
      body: { type: 'string', description: '正文，可为空', required: true },
    },
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ note: await port().create(owner, args.title, args.body) })),
    presentCall: args => present('新建笔记', args.title),
  })
}

/** 改写工具 / the update tool */
function rewriteNoteTool(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'rewrite_note',
    description: 'Replace the title, the body, or both of one note of the caller preset\u2019s notebook; '
      + 'pass the updatedAt you read as expectedUpdatedAt to be refused instead of overwriting a newer edit. '
      + 'Parameters: id, title?, body?, expectedUpdatedAt?.',
    parameters: {
      ...NOTE_ID_PARAM,
      title: { type: 'string', description: '新标题；省略则保留' },
      body: { type: 'string', description: '新正文；省略则保留' },
      expectedUpdatedAt: { type: 'string', description: '上次读到的 updatedAt；笔记已被改动时本次写入被拒绝' },
    },
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({
      note: await port().update(owner, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: args.expectedUpdatedAt }),
      }),
    })),
    presentCall: args => present('改写笔记', args.id),
  })
}

/** 删除工具 / the delete tool */
function deleteNoteTool(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'delete_note',
    description: 'Permanently delete one note of the caller preset\u2019s notebook; confirm with the user '
      + 'before calling. Parameters: id.',
    parameters: NOTE_ID_PARAM,
    output: { schema: DELETE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ deleted: await port().remove(owner, args.id) })),
    presentCall: args => present('删除笔记', args.id),
  })
}

// ---- 单入口注册 / the single-entry registration ----

/**
 * Register the whole application (definition → tools → pages) in one effect
 * whose body rolls back every finished step when a later one fails — no
 * half-wired "app present, pages missing" state. Disposing reverses
 * pages → tools → definition.
 *
 * 在一个 effect 里注册整个应用（定义 → 工具 → 页面）；体内任何一步失败都把已完成的
 * 步骤逆序回滚，不留"应用在、页面缺"的半接线状态。卸载按 页面 → 工具 → 定义 逆序清理。
 *
 * @param ctx - the context owning the registration (its fiber tears the app down).
 * @param port - resolves the notebook surface the page tools act through.
 */
export function registerNotebookApp(ctx: Context, port: () => NotebookToolsPort): void {
  const apps = ctx.apps
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(apps.register(APP_DEFINITION, ctx))
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of createAppTools(ctx, port)) disposers.push(tools.define(tool))
      const pages = apps.pages(APP_ID, ctx)
      for (const page of [listPage, notePage]) disposers.push(pages.register(page))
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'notebook:app()')
}
