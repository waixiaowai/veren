/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的三个页面（一次性渲染形态，模块级组件）：`export const XxxPage: PageFC`
 * 直接导出，不做工厂封装。组件体在页面会话的真实 Agent 上执行恰好一次，产物
 * 成型为 PAGE 块正文；工具由组件体直接 `agent.ctx.tools.register` 登记（全名，
 * 随 agent fiber 生灭）。此后页面不再渲染：任务列表的变化不推给上下文——模型
 * 经工具调用的结果获知变化（工具结果即事实）。
 * 依赖只有一条正道：组件体与工具定义读装配期绑定的模块级槽位（权威 store +
 * 全名工具，`bindWorkbenchRuntime` 由装配调用一次）。store 是同步内存面，正文
 * 直接读当前状态——首屏不经手任何宿主取数。
 * The app's three pages in the one-shot form as MODULE-LEVEL components — no
 * factory wrapper. The body runs exactly once on the page session's real Agent
 * and its output becomes the PAGE block body; tools are registered by the body
 * via `agent.ctx.tools.register` directly (full names, living and dying with
 * the agent fiber). The page never renders again: task list changes are not
 * pushed to the context — the model learns them from tool results.
 * Dependencies take one straight path: the bodies and the tool definitions
 * read the assembly-bound module slot (the authoritative store + full-named
 * tools, bound once by `bindWorkbenchRuntime`). The store is a synchronous
 * in-memory face: bodies read the current state directly — no host-mediated
 * first-screen fetching.
 *
 * §3.10.1 三档标注：
 * - `list` = **首页（home）**：entry；能力地图由注册表推导——不再手写 map；
 * - `detail` = **详情页（detail）**：URL 带 :taskId，正文直读 store 当前状态；
 *   工具矩阵沿 §3.10.1：take_page_task（页面作用域接取）+
 *   complete/abandon/split；
 * - `publish` = **工具页（action）**：无参、非入口、writes: true + publish_task。
 *
 * §4.7.8：列表页按整棵子树口径显示进度（`2/5`）；详情页子任务树按深度缩进、
 * 带进度徽标；子任务没有独立 URL 和会话（§4.7.4），树是数据不是身份。
 * §4.7.8: the list page shows whole-subtree progress (`2/5`); the detail page's
 * subtask tree indents by depth with progress badges; subtasks have no url or
 * session of their own (§4.7.4) — the tree is data, not identity.
 * @module @veren/task-workbench
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { rootsOf, subtreeProgress, subtaskTree } from './store.ts'
import type { TaskStore } from './store.ts'
import type { TaskItem } from './types.ts'

/**
 * 装配期绑定的模块级槽位：组件体的工具登记与 store 直读都从这里取权威事实。
 * 注册一定先于任何页面打开；未绑定即取 = 装配错误 fail loud。
 * The module-level slot bound at assembly time: the bodies' tool registrations
 * and store reads take their authoritative facts from here. Registration always
 * precedes any page open; reading unbound is an assembly error and fails loud.
 */
let runtime: { readonly store: TaskStore; readonly tools: readonly ToolDefinition[] } | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindWorkbenchRuntime(store: TaskStore, tools: readonly ToolDefinition[]): void {
  runtime = { store, tools }
}

/** 取绑定的运行时；未绑定 = 装配错误 fail loud / read the bound runtime; unbound = assembly error, fail loud */
function requireRuntime(): { readonly store: TaskStore; readonly tools: readonly ToolDefinition[] } {
  if (runtime === undefined) {
    throw new Error('[task-workbench] the workbench runtime is not bound; the app wiring must run before pages open')
  }
  return runtime
}

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
function toolOf(localName: string): ToolDefinition {
  const found = requireRuntime().tools.find((tool) => tool.name === externalName(localName))
  if (found === undefined) throw new Error(`[task-workbench] tool ${externalName(localName)} is not defined`)
  return found
}

// ---- 双语文案（§4.7.8 第 6 条；页面树是唯一取词方）----
// ---- Bilingual strings (§4.7.8 item 6; the page trees are the only consumer) ----

/** 支持的语言 / supported languages */
export type Lang = 'zh' | 'en'

/** 当前包默认语言（页面树取词）/ the package default language for page trees */
const DEFAULT_LANG: Lang = 'zh'

/** 两份字典都导出，客户端后续接 locale 服务时直接复用 / both dictionaries exported for a future locale client */
export const STRINGS = {
  progress: {
    zh: (label: string) => `子树进度 ${label}`,
    en: (label: string) => `Subtree progress ${label}`,
  },
  expandHint: {
    zh: '活跃分支默认展开渲染；终态分支折叠为进度徽标',
    en: 'Active branches render expanded by default; terminal branches collapse into a progress badge',
  },
  splitHint: {
    zh: '用 split_task 把 open 节点拆成子任务；仅当前接取者可用',
    en: 'Use split_task to break an open node into subtasks; the current claimant only',
  },
} as const

/** 取词函数（一个文案一个具名函数，零泛型魔法）/ one named resolver per string — no generic indirection */
export const tProgress = (label: string, lang: Lang = DEFAULT_LANG) => STRINGS.progress[lang](label)
export const tExpandHint = (lang: Lang = DEFAULT_LANG) => STRINGS.expandHint[lang]

/** 应用 id（页面 URL 前缀的权威来源）/ the app id (authority of the url prefix) */
export const APP_ID = 'task-workbench'
/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

/** 工具对外名：`<toolPrefix>__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
export const externalName = (localName: string): string => `task_workbench__${localName}`

// ---- 列表页（首页 home / entry）---- List page (the home page / entry) ----

export const ListPage: PageFC = (_props, agent) => {
  // 本页工具（跑一次，安全）：只读盘点 + 接任意 id（浏览入口的合法职责）+ 完成
  // 任务。写工具只在明确要求时使用——正文文案据此条件化（真机反例：祈使句措辞
  // 曾让首屏自主回合顺手接取并完成任务）。
  // / this page's tools (run once, safe): the read-only inventory + take an
  // arbitrary id (the browsing entry's legitimate duty) + complete. The write
  // tools fire only on explicit request — the body text is conditional for that
  // reason (live counter-example: imperative phrasing once drove the first
  // autonomous turn into taking and completing tasks unasked).
  agent.ctx.tools.register(toolOf('list_tasks'))
  agent.ctx.tools.register(toolOf('take_task'))
  agent.ctx.tools.register(toolOf('complete_task'))
  const items = requireRuntime().store.getState()
  const byStatus = (status: TaskItem['status']): number => items.filter((item) => item.status === status).length
  const roots = rootsOf(items).map((item) => ({
    ...item,
    progress: subtreeProgress(items, item.id),
  }))
  return (
    <>
      <h1>任务工作台 · 任务列表</h1>
      <p>open {byStatus('open')} · taken {byStatus('taken')} · done {byStatus('done')}。只读盘点/询问用 list_tasks 直接回答，不要改动任务状态；仅在用户或投递指令明确要求时才接取（take_task）或完成（complete_task），完成后用一句话确认。</p>
      <ul>
        {roots.map((root) => (
          <li key={root.id}>
            <strong>{root.id}</strong> {root.title}（{root.status} · {tProgress(root.progress.label)}）
          </li>
        ))}
      </ul>
      <blockquote>正文是打开时刻的首屏快照；此后任务的变化以工具调用的结果为准。</blockquote>
    </>
  )
}

export const ListMeta: ComponentPageMeta = {
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '任务工作台列表页：浏览/盘点全部任务，接取/完成任务',
  instructions: '这是任务工作台的首页（列表页）。列表只显示根任务，每条带整棵子树的进度徽标（2/5 = 全树终态/全树节点）。'
    + '正文是打开时刻的首屏快照——此后的任务变化不经页面刷新，以你调用工具返回的结果为准。'
    + '只读盘点、询问类请求用 list_tasks 直接回答，不要改动任何任务状态；'
    + '仅在用户或投递指令明确要求接取或完成时，才用 take_task 接取 open 任务、complete_task 完成 taken 任务，完成后用一句话确认。'
    + '用户或投递方的显式要求与上述流程冲突时，以显式要求为准。',
}

// ---- 详情页（详情页 detail）---- Detail page (the detail archetype) ----

export const DetailPage: PageFC<{ taskId: string }> = (props, agent) => {
  // 本页工具（跑一次，安全）：只读读取（get_page_task）+ 页面作用域接取（无参数，
  // 接 params.taskId 这条）+ 完成/放弃/拆分。写工具只在明确要求时使用。
  // / this page's tools (run once, safe): the page-scoped read (get_page_task)
  // + the page-scoped take (parameterless, this page's task) + complete/abandon/
  // split. The write tools fire only on explicit request.
  agent.ctx.tools.register(toolOf('get_page_task'))
  agent.ctx.tools.register(toolOf('take_page_task'))
  agent.ctx.tools.register(toolOf('complete_task'))
  agent.ctx.tools.register(toolOf('abandon_task'))
  agent.ctx.tools.register(toolOf('split_task'))
  const items = requireRuntime().store.getState()
  const taskId = String(props.taskId ?? '')
  const task = items.find((item) => item.id === taskId)
  if (task === undefined) {
    // found=false 的失败态如实渲染，绝不凭空处理 / the found=false state renders honestly — never act on a ghost
    return (
      <>
        <h1>任务 {taskId} 不存在</h1>
        <blockquote>该任务不在当前任务列表中——如实告知用户，不要凭空处理。</blockquote>
      </>
    )
  }
  const progress = subtreeProgress(items, task.id)
  const rows = subtaskTree(items, taskId)
  return (
    <>
      <h1>{task.id} {task.title}</h1>
      <p>状态 <strong>{task.status}</strong> · 负责人 {task.ownerId ?? '未认领'} · {tProgress(progress.label)}</p>
      <p>{tExpandHint()}</p>
      <h2>子任务树</h2>
      <ul>
        {rows.map((node) => (
          <li key={node.item.id}>
            {'　'.repeat(node.depth - 1)}{node.item.title}（{node.item.status}
            {node.progress.label !== '' ? ` · ${tProgress(node.progress.label)}` : ''}）
          </li>
        ))}
      </ul>
      <p>{tSplitHint()}</p>
      <hr />
      <p><a href={`${URL_PREFIX}/list`}>← 返回任务列表</a></p>
    </>
  )
}

export const DetailMeta: ComponentPageMeta<{ taskId: string }> = {
  name: 'detail',
  url: `${URL_PREFIX}/task/:taskId`,
  description: '任务详情页：读取本页任务当前状态（get_page_task，无参数），接取本页任务（take_page_task，无参数），处理该任务的标题/状态/负责人与子任务树',
  writes: true,
  // 实例化后显示「任务 #1」——会话列表标题始终是根任务标识（§4.7.4；不进文档正文）
  // / the instance shows 「任务 #1」 — the session-list title stays the root task's
  // identifier (§4.7.4; never document body content)
  instanceTitle: (params) => `任务 #${params.taskId}`,
  instructions: '这是任务详情页，只处理 params.taskId 指定的这一条任务——这一页只干这一件事。'
    + '有人把任务交给你**执行**时：先用 take_page_task 接取（无需参数，接的就是本页这条；'
    + '被别的会话持有时会返回 task/already-taken），再动手；'
    + '盘点、询问、查看类请求不接取、不改动任务，直接用 get_page_task 读取后回答。'
    + '用户或投递方的显式要求与上述流程冲突时（如明确要求不调用工具），以显式要求为准。'
    + '正文即该任务的字段与子任务树首屏（"不存在"表示任务不在列表，不要凭空处理）；'
    + '此后任务变化不经页面刷新，以你调用工具返回的结果为准。'
    + '用 split_task 把已接取任务拆成子任务（仅当前接取者可用，深度 8 / 单节点 32 子 / 单树 200 节点，'
    + '超限返回 task/subtree-limit）；用 complete_task 完成 taken 任务、abandon_task 放弃（回到 open）'
    + '——两者只作用于本地列表；投递来的任务不在本地列表（正文如实显示"不存在"），'
    + '完成/失败走宿主全局的 task_complete/task_fail（任务中心侧子树还有非终态后代时由它拒绝）。',
}

// ---- 发布页（工具页 action：无参 + 写工具 publish_task，不需要 map）----
// ---- Publish page (the action archetype: parameterless + the publish_task write tool, no map) ----

export const PublishPage: PageFC<{ draftTitle?: string }> = (props, agent) => {
  agent.ctx.tools.register(toolOf('publish_task'))
  return (
    <>
      <h1>任务工作台 · 发布任务</h1>
      <p>草稿标题：{props.draftTitle ?? ''}。用 publish_task 确认发布；标题为空时不要调用。</p>
      <blockquote>发布不支持带子任务的模板——子任务由接取者在其任务详情页现场拆分。</blockquote>
    </>
  )
}

export const PublishMeta: ComponentPageMeta<{ draftTitle?: string }> = {
  name: 'publish',
  url: `${URL_PREFIX}/publish`,
  description: '发布任务页：填写草稿并确认发布（投递到宿主任务中心）',
  writes: true,
  instructions: '这是任务发布页：草稿标题见正文。用 publish_task 确认发布；标题为空时不要调用。'
    + '发布不支持带子任务的模板（§4.7.6），子任务由接取者在其任务详情页现场拆分。',
}

function tSplitHint(lang: Lang = DEFAULT_LANG): string {
  return STRINGS.splitHint[lang]
}
