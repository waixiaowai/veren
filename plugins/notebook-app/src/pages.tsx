/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 记事本的两个页面（一次性渲染形态，模块级组件）：`export const XxxPage: PageFC`
 * 直接导出，不做工厂封装。组件体在页面会话的真实 Agent 上执行恰好一次，产物
 * 成型为 PAGE 块正文；工具由组件体直接 `agent.ctx.tools.register` 登记（全名
 * `notebook__<本地名>`，随 agent fiber 生灭）。
 * 首屏读取是组件体自己的生命周期：归属解析自会话头 `agentPreset`（与工具取
 * 调用者同源——身份走会话头，不进 URL）；异步读经 `agent.ctx.effect` 发起，
 * 读到的首屏（含失败态）经 `agent.followup` 以新消息进上下文。正文是打开时刻
 * 的静态框，绝不留白。
 * The notebook's two pages in the one-shot form as MODULE-LEVEL components — no
 * factory wrapper. The body runs exactly once on the page session's real Agent
 * and its output becomes the PAGE block body; tools register via
 * `agent.ctx.tools.register` (full names `notebook__<local>`, living and dying
 * with the agent fiber).
 * The first-screen read is the body's own lifecycle: the owner resolves from
 * the session header's `agentPreset` (the same face the tools read their caller
 * from — identity rides the session header, never the url); the async read
 * starts via `agent.ctx.effect` and its result (failure states included) rides
 * `agent.followup` as a new message. The body itself is the static frame at
 * open time, never a blank.
 * @module @veren/notebook-app/pages
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { NotebookToolsPort } from '@veren/notebook'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/notebook'

/**
 * 装配期绑定的模块级槽位：组件体的工具登记与首屏读从这里取工具定义与服务面。
 * 注册一定先于任何页面打开；未绑定即取 = 装配错误 fail loud。
 * The module-level slot bound at assembly time: the bodies' tool registrations
 * and first-screen reads take the tool definitions and the service face from
 * here. Registration always precedes any page open; reading unbound is an
 * assembly error and fails loud.
 */
let services: { readonly port: () => NotebookToolsPort; readonly tools: readonly ToolDefinition[] } | undefined

/** 装配时绑定（app.ts 的单入口注册调用一次）/ bind at assembly time (called once by app.ts's registration) */
export function bindNotebookServices(port: () => NotebookToolsPort, tools: readonly ToolDefinition[]): void {
  services = { port, tools }
}

/** 取绑定的服务面；未绑定 = 装配错误 fail loud / read the bound face; unbound = assembly error, fail loud */
function requireServices(): { readonly port: () => NotebookToolsPort; readonly tools: readonly ToolDefinition[] } {
  if (services === undefined) {
    throw new Error('[notebook-app] notebook services are not bound; registerNotebookApp must run before pages open')
  }
  return services
}

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
function toolOf(localName: string): ToolDefinition {
  const found = requireServices().tools.find((tool) => tool.name === `notebook__${localName}`)
  if (found === undefined) throw new Error(`[notebook-app] tool notebook__${localName} is not defined`)
  return found
}

/** 首屏列表条数上限 / the first-screen list cap */
const FIRST_SCREEN_LIMIT = 50

/** 页面自推消息的 source kind（宿主装配的 PAGE 块同源；wire 值协议常量）
 * / the source kind of a page-pushed message (same source as the host assembly's PAGE block; a wire-value protocol constant) */
const PAGE_SOURCE = 'app/page' as const

// 类型合并扩充：复用宿主的 app/page 消息源。形状必须与 app-host 的声明逐字
// 一致——TS 接口合并规则下两处同键成员类型不同会直接报错，漂移无处藏身。
// Type-merge extension: reuse the host's app/page message source. The shape
// must match app-host's declaration verbatim — under TS interface merging,
// same-key members with different types are a hard error, so the two cannot
// drift apart.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page session's PAGE block (app-host) and the page body's own followups. @persistenceSource user */
    'app/page': { kind: 'app/page' }
  }
}

/** 归属解析：会话头 agentPreset——与页面工具取调用者的口径同源；身份不进 URL
 * / owner resolution: the session header's agentPreset — the same face the page tools read their caller from; identity never enters the url */
function ownerOf(agent: Agent): string | null {
  return (agent.session as { header?: { agentPreset?: string } } | undefined)?.header?.agentPreset ?? null
}

/** 把一条首屏文本作为新消息推进上下文（页面自己的送达路径）/ push one first-screen text into the context as a new message (the page's own delivery path) */
function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: PAGE_SOURCE } }))
}

/** 列表页首屏快照形状（归属未知时 available=false，不编造数据）
 * / the list page's first-screen shape (owner unknown reads available=false, never faked) */
interface NotebookListFirstScreen {
  available: boolean
  owner: string | null
  notes: readonly { id: string; title: string; excerpt: string; updatedAt: string }[]
}

/** 详情页首屏快照形状（归属未知或笔记不存在时 note 为 null）
 * / the note page's first-screen shape (note=null on unknown owner or a missing note) */
interface NotebookNoteFirstScreen {
  owner: string | null
  note: null | { id: string; title: string; body: string; createdAt: string; updatedAt: string }
}

/** 列表首屏渲染成 Markdown 文本（每种状态都如实表达，不静默空白）
 * / render the list first screen as Markdown text (every state stated honestly, never a silent blank) */
function renderListFirstScreen(snap: NotebookListFirstScreen): string {
  if (!snap.available) {
    return '归属未知：本页拿不到当前会话的预设。如实告知用户；可用 list_notes 自行取列表，但不要编造笔记。'
  }
  if (snap.notes.length === 0) {
    return `预设 ${snap.owner ?? '未知'} 的记事本还是空的——用 write_note 新建第一条笔记。`
  }
  const rows = snap.notes.map((note) => `- **${note.id}** ${note.title}（更新于 ${note.updatedAt}）\n  ${note.excerpt}`)
  return [`笔记列表（预设 ${snap.owner ?? '未知'}）：`, ...rows, '列表此后变化以你调用工具返回的结果为准。'].join('\n')
}

/** 列表页首屏读取（组件体 lifecycle 的读半边；失败态也是信息）
 * / the list page's first-screen read (the read half of the body's lifecycle; failures are information too) */
async function listFirstScreenText(agent: Agent): Promise<string> {
  const owner = ownerOf(agent)
  if (owner === null) return renderListFirstScreen({ available: false, owner: null, notes: [] })
  try {
    const notes = await requireServices().port().list(owner)
    return renderListFirstScreen({
      available: true,
      owner,
      notes: notes.slice(0, FIRST_SCREEN_LIMIT).map((note) => ({
        id: note.id, title: note.title, excerpt: note.excerpt, updatedAt: note.updatedAt,
      })),
    })
  } catch (error: unknown) {
    return `首屏读取失败：${error instanceof Error ? error.message : String(error)}。重开本页 URL 即可重取；也可用 list_notes 自行取列表。`
  }
}

/** 详情首屏渲染成 Markdown 文本 / render the note first screen as Markdown text */
function renderNoteFirstScreen(snap: NotebookNoteFirstScreen, noteId: string): string {
  if (snap.note === null) {
    return `笔记 ${noteId} 不存在或归属未知——不要凭空操作。`
  }
  // 时间两行都给：createdAt 是事实，updatedAt 是 rewrite_note 守卫要用的值。
  // / both timestamps: createdAt is a fact, updatedAt feeds the rewrite_note guard.
  return [`# ${snap.note.id} ${snap.note.title}`, `创建于 ${snap.note.createdAt} · 更新于 ${snap.note.updatedAt}`, '', snap.note.body].join('\n')
}

/** 详情页首屏读取 / the note page's first-screen read */
async function noteFirstScreenText(agent: Agent, noteId: string): Promise<string> {
  const owner = ownerOf(agent)
  if (owner === null) return renderNoteFirstScreen({ owner: null, note: null }, noteId)
  try {
    const note = await requireServices().port().read(owner, noteId)
    return renderNoteFirstScreen({
      owner,
      note: { id: note.id, title: note.title, body: note.body, createdAt: note.createdAt, updatedAt: note.updatedAt },
    }, noteId)
  } catch (error: unknown) {
    // 读取失败（笔记不存在/归属未知/存储异常）统一归入"找不到"语义——
    // 绝不凭空操作；原因如实带上。
    // / a read failure (missing note, unknown owner, storage trouble) folds into
    // the not-found semantics — never act on a ghost; the reason rides along.
    return `笔记 ${noteId} 不存在或归属未知——不要凭空操作。（读取失败：${error instanceof Error ? error.message : String(error)}）`
  }
}

// ---- 列表页（首页 home / entry，笔记列表）---- List page (the home page / entry, the note list) ----

export const ListPage: PageFC = (_props, agent) => {
  agent.ctx.tools.register(toolOf('list_notes'))
  agent.ctx.tools.register(toolOf('write_note'))
  // 首屏读取：组件体自己的 lifecycle（effect 发起、followup 送达——宿主不经手取数）
  // / the first-screen read: the body's own lifecycle (an effect starts it, a followup delivers it — the host touches no data)
  agent.ctx.effect(async () => {
    followupText(agent, await listFirstScreenText(agent))
    return async () => undefined
  }, 'notebook:list-first-screen')
  // 正文是打开时刻的静态框：数据随后以消息送达，不留白。
  // / the body is the static frame at open time: data arrives as a message, never a blank.
  return (
    <blockquote>笔记列表首屏随后以消息送达；也可直接用 list_notes 取列表。</blockquote>
  )
}

export const ListMeta: ComponentPageMeta = {
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '记事本列表页：浏览当前预设的全部笔记，并可新建笔记',
  // 本页登记了写工具（write_note），如实声明写意图
  // / this page registers a write tool (write_note); declare the intent honestly
  writes: true,
  instructions: '这是记事本的首页（笔记列表）。首屏列表在打开后以一条消息送达：owner（归属预设）与 notes（该预设的笔记，id/title/excerpt/updatedAt）；'
    + '归属未知或读取失败会在消息里如实说明——不要编造笔记。'
    + '此后变化以你调用工具返回的结果为准。'
    + '用 list_notes 刷新列表，用 write_note 新建笔记；新建后报出笔记标题即可。'
    + '要读/改/删某一条笔记时，打开 map 里的笔记详情页 URL。',
  instanceTitle: () => '笔记列表',
}

// ---- 笔记详情页（详情页 detail）---- Note detail page (the detail archetype) ----

export const NotePage: PageFC<{ noteId: string }> = (props, agent) => {
  agent.ctx.tools.register(toolOf('read_note'))
  agent.ctx.tools.register(toolOf('rewrite_note'))
  agent.ctx.tools.register(toolOf('delete_note'))
  const noteId = String(props.noteId ?? '')
  // 首屏读取：本页那一条笔记（effect 发起、followup 送达）
  // / the first-screen read: this page's one note (an effect starts it, a followup delivers it)
  agent.ctx.effect(async () => {
    followupText(agent, await noteFirstScreenText(agent, noteId))
    return async () => undefined
  }, 'notebook:note-first-screen')
  return (
    <blockquote>{`笔记 ${noteId} 的正文随后以消息送达；也可直接用 read_note 读取。`}</blockquote>
  )
}

export const NoteMeta: ComponentPageMeta<{ noteId: string }> = {
  name: 'note',
  url: `${URL_PREFIX}/note/:noteId`,
  description: '笔记详情页：查看并改写单条笔记的标题与正文，或删除它',
  writes: true,
  instructions: '这是笔记详情页，只处理 params.noteId 指定的这一条笔记——这一页只干这一件事。'
    + '该笔记的首屏（字段与全文）在打开后以一条消息送达；消息说"不存在或归属未知"时不要凭空操作。'
    + '此后变化以你调用工具返回的结果为准。'
    + '用 read_note 读取全文；用 rewrite_note 改写，携带读到的 updatedAt 作 expectedUpdatedAt 防覆盖；'
    + 'delete_note 永久删除，删除前先向用户确认。',
  instanceTitle: (params) => `笔记 #${params.noteId ?? ''}`,
}
