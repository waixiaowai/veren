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
import type { PageJsonValue, PageDefinition } from '@veren/prompt-page'
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

// ---- 页面（defineAppPage，URL 统一 /apps/notebook/...）----
// ---- the pages (defineAppPage, urls under /apps/notebook) ----

/** 首屏列表条数上限（与 PAGE-DATA 的 50 条上限同口径）/ the first-screen list cap (aligned with the PAGE-DATA cap) */
const FIRST_SCREEN_LIMIT = 50

/**
 * 列表页首屏快照：归属未知时 available=false（不编造数据）。
 * The list page's first-screen snapshot: owner unknown reads available=false (never faked).
 */
export type NotebookListFirstScreen = {
  available: boolean
  owner: string | null
  notes: { id: string; title: string; excerpt: string; updatedAt: string }[]
}

/**
 * 详情页首屏快照：归属未知时 note 为 null 且 owner 为 null。
 * The note page's first-screen snapshot: owner unknown reads note=null, owner=null.
 */
export type NotebookNoteFirstScreen = {
  owner: string | null
  note: null | { id: string; title: string; body: string; createdAt: string; updatedAt: string }
}

/**
 * 归属解析（§3.10.3 PageLoadEnv）：页面会话按预设隔离——首屏 load 用 env.preset
 * 解析归属，与页面工具取调用者的口径同源（会话头 agentPreset）。未知即显式
 * 表达"归属未知"，绝不跨预设读数据。
 * Owner resolution (§3.10.3's PageLoadEnv): page sessions are preset-scoped —
 * the first-screen load resolves the owner from env.preset, the same face the
 * page tools read their caller from (the session header's agentPreset). An
 * unknown owner is stated explicitly; notes of another preset are never read.
 */
function firstScreenOwner(env: { readonly preset?: string }): string | null {
  return env.preset ?? null
}

/** 入口页（笔记列表）工厂 / the entry page (the note list) factory */
export function createListPage(port: () => NotebookToolsPort): PageDefinition<readonly NoteSummary[]> {
  return defineAppPage<readonly NoteSummary[]>({
    name: 'list',
    url: `${URL_PREFIX}/list`,
    description: '记事本列表页：浏览当前预设的全部笔记，并可新建笔记',
    tools: ['list_notes', 'write_note'],
    instructions: '这是记事本的首页（笔记列表）。data 行是首屏快照：owner（归属预设）与 notes（该预设的笔记，id/title/excerpt/updatedAt）；'
      + 'available=false 表示宿主未暴露归属，此时如实告知用户，用 list_notes 让模型自行取列表。'
      + '页面状态经 SNAPSHOT/PATCH 同步，{"kind":"keyed","path":"notes","items":[...]} 按条目 id 对位。'
      + '用 list_notes 刷新列表，用 write_note 新建笔记；新建后报出笔记标题即可。'
      + '要读/改/删某一条笔记时，打开 map 里的笔记详情页 URL。',
    instanceTitle: () => '笔记列表',
    // §3.10.1：一级页 = 基础信息（load 取当前预设的真实笔记列表）+ 能力地图
    // / §3.10.1: the home page = basic information (the current preset's real
    // note list via load) + the capability map
    load: async (_params, env) => {
      const owner = firstScreenOwner(env)
      if (owner === null) return { available: false, owner: null, notes: [] } satisfies PageJsonValue
      const notes = await port().list(owner)
      return {
        available: true,
        owner,
        notes: notes.slice(0, FIRST_SCREEN_LIMIT).map((note) => ({
          id: note.id, title: note.title, excerpt: note.excerpt, updatedAt: note.updatedAt,
        })),
      } satisfies PageJsonValue
    },
    map: [
      {
        url: `${URL_PREFIX}/note/:noteId`,
        use: '读取/改写/删除某一条笔记时打开',
        params: { noteId: '笔记 id，来自列表 data 的 notes[].id' },
      },
    ],
    tree: (_params, notes) => [
      ...Static({ content: '记事本 · 笔记列表' }),
      ...Keyed({ path: 'notes', items: notes }),
    ],
  })
}

/** 笔记详情页工厂 / the note detail page factory */
export function createNotePage(port: () => NotebookToolsPort): PageDefinition<NoteView | undefined> {
  return defineAppPage<NoteView | undefined>({
    name: 'note',
    url: `${URL_PREFIX}/note/:noteId`,
    description: '笔记详情页：查看并改写单条笔记的标题与正文，或删除它',
    tools: ['read_note', 'rewrite_note', 'delete_note'],
    writes: true,
    instructions: '这是笔记详情页，只处理 params.noteId 指定的这一条笔记——这一页只干这一件事。'
      + 'data 行自带该笔记的首屏（owner/note 字段）；note 为 null 表示归属未知或笔记不存在，不要凭空操作。'
      + '用 read_note 读取全文；用 rewrite_note 改写，携带读到的 updatedAt 作 expectedUpdatedAt 防覆盖；'
      + 'delete_note 永久删除，删除前先向用户确认。',
    instanceTitle: (params) => `笔记 #${params.noteId ?? ''}`,
    // §3.10.3：二级页 load 按参数取该条记录的首屏；笔记不存在时 load 抛
    // notebook/note-not-found，data 行如实给出失败态。
    // §3.10.3: the detail load fetches that one record's first screen; a missing
    // note throws notebook/note-not-found and the data line carries the error state.
    load: async (params, env) => {
      const owner = firstScreenOwner(env)
      if (owner === null) return { owner: null, note: null } satisfies PageJsonValue
      const note = await port().read(owner, String(params.noteId ?? ''))
      return {
        owner,
        note: { id: note.id, title: note.title, body: note.body, createdAt: note.createdAt, updatedAt: note.updatedAt },
      } satisfies PageJsonValue
    },
    tree: (_params, note) => [
      ...Static({ content: '记事本 · 笔记详情' }),
      ...Data({ path: 'note.title', value: note?.title ?? null }),
      ...Data({ path: 'note.body', value: note?.body ?? null }),
      ...Data({ path: 'note.updatedAt', value: note?.updatedAt ?? null }),
    ],
  })
}

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
      // 两页的 load 载荷类型不同（列表 vs 单条），注册面只关心 PageDefinition
      // 的公共面：显式抹平为 never，避免数组被推成两个不相交页类型的联合。
      // The two pages carry different load payloads (a list vs one record); the
      // registration face only cares about PageDefinition's common shape, so
      // widen explicitly instead of letting the array infer a union.
      const registered: Array<PageDefinition<never>> = [createListPage(port), createNotePage(port)]
      for (const page of registered) disposers.push(pages.register(page))
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'notebook:app()')
}
