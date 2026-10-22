/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的三个页面（组件形态，RFC prompt-page-render §3.5）：PageFC + meta，
 * 经 `pages.register(component, meta)` 注册——正文渲染为 Markdown（WYSIWYG），
 * 数据面订阅权威 store（useSnapshot），变化经 PAGE-PATCH 增量进历史。
 * The app's three pages in component form (RFC prompt-page-render §3.5):
 * PageFC + meta, registered via `pages.register(component, meta)` — the body
 * renders as Markdown (WYSIWYG), the data plane subscribes to the authoritative
 * store (useSnapshot), and changes flow into history as PAGE-PATCHes.
 *
 * §3.10.1 三档标注（组件形态下的对应面）：
 * - `list` = **首页（home）**：entry；能力地图由注册表推导（本应用兄弟页：
 *   详情/发布两页自动列全，§3.5 定案）——不再手写 map；
 * - `detail` = **详情页（detail）**：URL 带 :taskId，useSnapshot 读 store 中该条
 *   记录 + 子任务树；工具矩阵沿 §3.10.1：take_page_task（页面作用域接取）+
 *   complete/abandon/split，meta.tools 声明目录本地名；
 * - `publish` = **工具页（action）**：无参、非入口、writes: true + publish_task。
 *
 * §4.7.8：列表页按整棵子树口径显示进度（`2/5`）；详情页子任务树按深度缩进、
 * 带进度徽标；子任务没有独立 URL 和会话（§4.7.4），树是数据不是身份。
 * §4.7.8: the list page shows whole-subtree progress (`2/5`); the detail page's
 * subtask tree indents by depth with progress badges; subtasks have no url or
 * session of their own (§4.7.4) — the tree is data, not identity.
 * @module @veren/task-workbench
 */
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { rootsOf, subtreeProgress, subtaskTree } from './store.ts'
import type { TaskStore } from './store.ts'
import type { TaskItem } from './types.ts'

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

/** 三个页面的组件与契约面（闭包引用本次装配的权威 store——单一事实源，无第二数据源）
 * / the three pages' components and contract faces (closures over this assembly's
 * authoritative store — a single source of fact, no second data source) */
export interface TaskPages {
  readonly ListPage: PageFC
  readonly ListMeta: ComponentPageMeta
  readonly DetailPage: PageFC<{ taskId: string }>
  readonly DetailMeta: ComponentPageMeta<{ taskId: string }>
  readonly PublishPage: PageFC<{ draftTitle?: string }>
  readonly PublishMeta: ComponentPageMeta<{ draftTitle?: string }>
}

/** 页面工厂：store 以纯参数进入（G13 规则 2），组件经 useSnapshot 读它
 * / the page factory: the store arrives as a pure parameter (G13 rule 2); components read it via useSnapshot */
export function createTaskPages(store: TaskStore): TaskPages {
  // ---- 列表页（首页 home / entry）---- List page (the home page / entry) ----

  const ListPage: PageFC = () => {
    const items = useSnapshot<TaskItem[]>() ?? []
    const byStatus = (status: TaskItem['status']): number => items.filter((item) => item.status === status).length
    const roots = rootsOf(items).map((item) => ({
      ...item,
      progress: subtreeProgress(items, item.id),
    }))
    return (
      <>
        <h1>任务工作台 · 任务列表</h1>
        <p>open {byStatus('open')} · taken {byStatus('taken')} · done {byStatus('done')}。接取用 take_task；完成用 complete_task；完成后用一句话确认。</p>
        <ul>
          {roots.map((root) => (
            <li key={root.id}>
              <strong>{root.id}</strong> {root.title}（{root.status} · {tProgress(root.progress.label)}）
            </li>
          ))}
        </ul>
        <blockquote>数据变化经 PAGE-PATCH 增量同步，按行首任务 id 对位。</blockquote>
      </>
    )
  }

  const ListMeta: ComponentPageMeta = {
    name: 'list',
    url: `${URL_PREFIX}/list`,
    description: '任务工作台列表页：浏览全部任务，接取/完成任务',
    tools: ['take_task', 'complete_task'],
    store,
    instructions: '这是任务工作台的首页（列表页）。列表只显示根任务，每条带整棵子树的进度徽标（2/5 = 全树终态/全树节点）。'
      + '数据变化经 PAGE-PATCH 增量同步（按行首任务 id 对位）。'
      + '用 take_task 接取 open 任务，complete_task 完成 taken 任务；完成后用一句话确认。',
  }

  // ---- 详情页（详情页 detail）---- Detail page (the detail archetype) ----

  const DetailPage: PageFC<{ taskId: string }> = (props) => {
    const items = useSnapshot<TaskItem[]>() ?? []
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

  const DetailMeta: ComponentPageMeta<{ taskId: string }> = {
    name: 'detail',
    url: `${URL_PREFIX}/task/:taskId`,
    description: '任务详情页：接取本页任务（take_page_task，无参数），处理该任务的标题/状态/负责人与子任务树',
    tools: ['take_page_task', 'complete_task', 'abandon_task', 'split_task'],
    store,
    writes: true,
    // 实例化后显示「任务 #1」——会话列表标题始终是根任务标识（§4.7.4；不进文档正文）
    // / the instance shows 「任务 #1」 — the session-list title stays the root task's
    // identifier (§4.7.4; never document body content)
    instanceTitle: (params) => `任务 #${params.taskId}`,
    instructions: '这是任务详情页，只处理 params.taskId 指定的这一条任务——这一页只干这一件事。'
      + '有人把任务投给本页时：先用 take_page_task 接取（无需参数，接的就是本页这条；'
      + '被别的会话持有时会返回 task/already-taken），再动手。'
      + '正文即该任务的字段与子任务树首屏（"不存在"表示任务不在列表，不要凭空处理）；'
      + '字段变化经 PAGE-PATCH 以最新一次为准。'
      + '用 split_task 把已接取任务拆成子任务（仅当前接取者可用，深度 8 / 单节点 32 子 / 单树 200 节点，'
      + '超限返回 task/subtree-limit）；用 complete_task 完成 taken 任务、abandon_task 放弃（回到 open）'
      + '——两者只作用于本地列表；投递来的任务不在本地列表（正文如实显示"不存在"），'
      + '完成/失败走宿主全局的 task_complete/task_fail（任务中心侧子树还有非终态后代时由它拒绝）。',
  }

  // ---- 发布页（工具页 action：无参 + 写工具 publish_task，不需要 map）----
  // ---- Publish page (the action archetype: parameterless + the publish_task write tool, no map) ----

  const PublishPage: PageFC<{ draftTitle?: string }> = (props) => (
    <>
      <h1>任务工作台 · 发布任务</h1>
      <p>草稿标题：{props.draftTitle ?? ''}。用 publish_task 确认发布；标题为空时不要调用。</p>
      <blockquote>发布不支持带子任务的模板——子任务由接取者在其任务详情页现场拆分。</blockquote>
    </>
  )

  const PublishMeta: ComponentPageMeta<{ draftTitle?: string }> = {
    name: 'publish',
    url: `${URL_PREFIX}/publish`,
    description: '发布任务页：填写草稿并确认发布（投递到宿主任务中心）',
    tools: ['publish_task'],
    writes: true,
    instructions: '这是任务发布页：草稿标题见正文。用 publish_task 确认发布；标题为空时不要调用。'
      + '发布不支持带子任务的模板（§4.7.6），子任务由接取者在其任务详情页现场拆分。',
  }

  return { ListPage, ListMeta, DetailPage, DetailMeta, PublishPage, PublishMeta }
}

function tSplitHint(lang: Lang = DEFAULT_LANG): string {
  return STRINGS.splitHint[lang]
}
