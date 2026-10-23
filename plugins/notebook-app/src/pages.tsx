/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 记事本的两个页面（标准组件形态，RFC prompt-page-render §3.5）：PageFC + meta
 * 由一个页面工厂经装配端口产出（G13：数据面以纯参数进入，闭包单一事实源）；
 * 正文经 useSnapshot 渲染 Markdown（WYSIWYG），归属在 meta.load 里从 env.preset
 * 解析（§3.10.3——身份走 load，不进 URL），首屏每一种状态都如实渲染。
 * The notebook's two pages in the standard component form (RFC §3.5): PageFC +
 * meta produced by one factory over the assembly port (G13: the data face
 * arrives as a pure parameter, one closure one source of fact); bodies render
 * Markdown via useSnapshot (WYSIWYG), ownership resolves in meta.load from
 * env.preset (§3.10.3 — identity rides load, never the url), and every
 * first-screen state renders honestly.
 * @module @veren/notebook-app/pages
 */
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageJsonValue } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { NotebookToolsPort } from '@veren/notebook'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/notebook'

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

/** 页面工厂产物 / the factory product */
export interface NotebookPages {
  readonly ListPage: PageFC
  readonly ListMeta: ComponentPageMeta
  readonly NotePage: PageFC<{ noteId: string }>
  readonly NoteMeta: ComponentPageMeta<{ noteId: string }>
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

/**
 * 页面工厂：端口与全名工具以纯参数进入，产出两页的组件与契约面。组件体在
 * 唯一一次渲染里登记本页工具（跑一次，安全）。
 * The page factory: the port and the full-named tools arrive as pure
 * parameters; produces both pages' components and contract faces. Each body
 * registers its page's tools in the one render (run once, safe).
 */
export function createNotebookPages(port: () => NotebookToolsPort, tools: readonly ToolDefinition[]): NotebookPages {
  /** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
  const toolOf = (localName: string): ToolDefinition => {
    const found = tools.find((tool) => tool.name === `notebook__${localName}`)
    if (found === undefined) throw new Error(`[notebook-app] tool notebook__${localName} is not defined`)
    return found
  }

  // ---- 列表页（首页 home / entry，笔记列表）---- List page (the home page / entry, the note list) ----

  const ListPage: PageFC = (_props, agent) => {
    agent.ctx.tools.register(toolOf('list_notes'))
    agent.ctx.tools.register(toolOf('write_note'))
    const snap = useSnapshot<NotebookListFirstScreen>()
    // 信息面（页面 = 信息 + 工具，缺一不可）：正文如实渲染首屏的每一种状态——
    // 归属未知、空列表、有笔记都不留白，模型与用户拿正文即可当事实源。
    // The information face (a page = its information + its tools, neither
    // optional): the body renders every first-screen state honestly — unknown
    // owner, empty list, and rows alike; the body is the source of fact.
    if (snap === undefined || snap.available === false) {
      return (
        <blockquote>归属未知：本页拿不到当前会话的预设。如实告知用户；可用 list_notes 自行取列表，但不要编造笔记。</blockquote>
      )
    }
    if (snap.notes.length === 0) {
      return <p>预设 {snap.owner ?? '未知'} 的记事本还是空的——用 write_note 新建第一条笔记。</p>
    }
    return (
      <ul>
        {snap.notes.map((note) => (
          <li key={note.id}>
            <strong>{note.id}</strong> {note.title}（更新于 {note.updatedAt}）
            <br />
            {note.excerpt}
          </li>
        ))}
      </ul>
    )
  }

  const ListMeta: ComponentPageMeta = {
    name: 'list',
    url: `${URL_PREFIX}/list`,
    description: '记事本列表页：浏览当前预设的全部笔记，并可新建笔记',
    // 本页登记了写工具（write_note），如实声明写意图
    // / this page registers a write tool (write_note); declare the intent honestly
    writes: true,
    instructions: '这是记事本的首页（笔记列表）。正文即首屏快照：owner（归属预设）与 notes（该预设的笔记，id/title/excerpt/updatedAt）；'
      + 'available=false 表示宿主未暴露归属，此时如实告知用户，用 list_notes 让模型自行取列表。'
      + '正文是打开时刻的首屏——此后变化以你调用工具返回的结果为准。'
      + '用 list_notes 刷新列表，用 write_note 新建笔记；新建后报出笔记标题即可。'
      + '要读/改/删某一条笔记时，打开 map 里的笔记详情页 URL。',
    instanceTitle: () => '笔记列表',
    // §3.10.3（组件页语义）：首屏归属解析自 env.preset——身份走 load，不进 URL
    // / §3.10.3 (component-page semantics): the first screen resolves the owner from env.preset — identity rides load, never the url
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
  }

  // ---- 笔记详情页（详情页 detail）---- Note detail page (the detail archetype) ----

  const NotePage: PageFC<{ noteId: string }> = (props, agent) => {
    agent.ctx.tools.register(toolOf('read_note'))
    agent.ctx.tools.register(toolOf('rewrite_note'))
    agent.ctx.tools.register(toolOf('delete_note'))
    const snap = useSnapshot<NotebookNoteFirstScreen>()
    const note = snap?.note
    if (note === null || note === undefined) {
      return (
        <blockquote>该笔记不存在或归属未知——不要凭空操作。</blockquote>
      )
    }
    return (
      <>
        <h1>{note.id} {note.title}</h1>
        {/* 时间两行都给：createdAt 是事实，updatedAt 是 rewrite_note 守卫要用的值。
            / both timestamps: createdAt is a fact, updatedAt feeds the rewrite_note guard. */}
        <p>创建于 {note.createdAt} · 更新于 {note.updatedAt}</p>
        <pre>{note.body}</pre>
      </>
    )
  }

  const NoteMeta: ComponentPageMeta<{ noteId: string }> = {
    name: 'note',
    url: `${URL_PREFIX}/note/:noteId`,
    description: '笔记详情页：查看并改写单条笔记的标题与正文，或删除它',
    writes: true,
    instructions: '这是笔记详情页，只处理 params.noteId 指定的这一条笔记——这一页只干这一件事。'
      + '正文自带该笔记的首屏（owner/note 字段）；note 为 null 表示归属未知或笔记不存在，不要凭空操作。'
      + '正文是打开时刻的首屏——此后变化以你调用工具返回的结果为准。'
      + '用 read_note 读取全文；用 rewrite_note 改写，携带读到的 updatedAt 作 expectedUpdatedAt 防覆盖；'
      + 'delete_note 永久删除，删除前先向用户确认。',
    instanceTitle: (params) => `笔记 #${params.noteId ?? ''}`,
    // §3.10.3（组件页语义）：详情 load 按参数取该条记录的首屏；笔记不存在时
    // load 抛 notebook/note-not-found，失败态进组件如实渲染。
    // §3.10.3 (component-page semantics): the detail load fetches that one
    // record's first screen; a missing note throws notebook/note-not-found and
    // the component renders the error state.
    load: async (params, env) => {
      const owner = firstScreenOwner(env)
      if (owner === null) return { owner: null, note: null } satisfies PageJsonValue
      const note = await port().read(owner, String(params.noteId ?? ''))
      return {
        owner,
        note: { id: note.id, title: note.title, body: note.body, createdAt: note.createdAt, updatedAt: note.updatedAt },
      } satisfies PageJsonValue
    },
  }

  return { ListPage, ListMeta, NotePage, NoteMeta }
}
