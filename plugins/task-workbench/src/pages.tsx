/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的三个页面（defineAppPage，URL 统一 /apps/task-workbench/...）。
 * The app's three pages via defineAppPage.
 *
 * §3.10.1 三档标注 / §3.10.1 archetype annotations:
 * - `list`  = **首页（home）**：entry，基础信息（load 取的真实任务列表）+ 能力地图
 *   （本应用有详情页 → map 必须非空，列全详情/发布两页的 URL 模板）；
 *   / the home page: the entry; base information (the real task list via load)
 *   plus the capability map (this app has a detail page → the map must be
 *   non-empty and list both the detail and the publish templates);
 * - `detail` = **详情页（detail）**：URL 带 :param，params + load 取该条记录的
 *   快照 + writes: true + "只干这一件事"的说明；
 *   / the detail page: a :param url; params + a load of that one record +
 *   writes: true + a "this page does one thing" note;
 * - `publish` = **工具页（action）**：无参、非入口、writes: true——"发布一件事"
 *   的页面，写工具（publish_task）+ 说明在位，不需要 map。
 *   / the action page: parameterless, non-entry, writes: true — a "do one deed"
 *   page with its write tool and instructions in place; no map needed.
 *
 * 页面是工厂：load 闭包引用本次装配的权威 store，同一条数据同时供给 PAGE 块首屏
 * （load）与 PAGE-DATA 增量同步（tree/live 视图），不存在第二份数据源。
 * Pages are factories: load closes over the authoritative store of this
 * assembly — the same data feeds the PAGE block's first screen (load) and the
 * PAGE-DATA sync (the tree/live view); there is no second data source.
 *
 * §4.7.8：列表页按整棵子树口径显示进度（`2/5`）；详情页子任务树活跃分支默认
 * 展开、终态分支折叠成进度徽标，instanceTitle 始终用根任务标题；子任务没有
 * 独立 URL 和会话（§4.7.4），树是数据不是身份。
 * §4.7.8: the list page shows whole-subtree progress (`2/5`); the detail page's
 * subtask tree expands active branches by default and collapses terminal ones
 * into progress badges; instanceTitle stays the root title; subtasks have no
 * url or session of their own (§4.7.4) — the tree is data, not identity.
 * @module @veren/task-workbench
 */
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageJsonValue, PageDefinition } from '@veren/prompt-page'
import { rootsOf, subtreeProgress, subtaskTree } from './store.ts'
import type { TaskStore } from './store.ts'
import type { SubtaskRow, TaskItem, TaskListItem } from './types.ts'
import { tExpandHint, tProgress } from './texts.ts'

/** 应用 id（页面 URL 前缀的权威来源）/ the app id (authority of the url prefix) */
export const APP_ID = 'task-workbench'
/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

/** 首屏列表条数上限（与 PAGE-DATA 的 50 条上限同口径）/ the first-screen list cap (aligned with the PAGE-DATA cap) */
const FIRST_SCREEN_LIMIT = 50

/** 列表页首屏快照 / the list page's first-screen snapshot */
export type TaskListFirstScreen = {
  open: number
  taken: number
  done: number
  roots: { id: string; title: string; status: string; progress: string }[]
}

/** 详情页首屏快照 / the detail page's first-screen snapshot */
export type TaskDetailFirstScreen = {
  found: boolean
  task: null | { id: string; title: string; status: string; ownerId: string | null }
  subtree: string | null
  subtasks: { id: string; title: string; status: string; depth: number; progress: string }[]
}

/** 列表页首屏：计数 + 根任务行（真实 store 数据，绝不写死）/ the list first screen: counts + root rows, always from the store */
export function listFirstScreen(items: readonly TaskItem[]): TaskListFirstScreen {
  const byStatus = (status: TaskItem['status']): number => items.filter((item) => item.status === status).length
  return {
    open: byStatus('open'),
    taken: byStatus('taken'),
    done: byStatus('done'),
    roots: rootsOf(items).slice(0, FIRST_SCREEN_LIMIT).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      progress: subtreeProgress(items, item.id).label,
    })),
  }
}

/** 详情页首屏：该条任务的字段与子任务树；找不到如实给 found=false / the detail first screen: the record's fields and tree; a miss reads found=false */
export function detailFirstScreen(items: readonly TaskItem[], taskId: string): TaskDetailFirstScreen {
  const task = items.find((item) => item.id === taskId)
  if (task === undefined) return { found: false, task: null, subtree: null, subtasks: [] }
  return {
    found: true,
    task: { id: task.id, title: task.title, status: task.status, ownerId: task.ownerId ?? null },
    subtree: subtreeProgress(items, task.id).label,
    subtasks: subtaskTree(items, taskId).map((node) => ({
      id: node.item.id,
      title: node.item.title,
      status: node.item.status,
      depth: node.depth,
      progress: node.progress.label,
    })),
  }
}

// ---- 列表页（首页 home / entry）---- List page (the home page / entry) ----

export function createListPage(store: TaskStore): PageDefinition<TaskItem[]> {
  return defineAppPage<TaskItem[]>({
    name: 'list',
    url: `${URL_PREFIX}/list`,
    description: '任务工作台列表页：浏览全部任务，接取/完成任务',
    tools: ['take_task', 'complete_task'],
    instructions: '这是任务工作台的首页（列表页）。页面状态经 SNAPSHOT/PATCH 同步，'
      + '{"kind":"keyed","path":"tasks","items":[...]} 按条目 id 对位；'
      + '列表只显示根任务，每条带整棵子树的进度徽标（2/5 = 全树终态/全树节点）。'
      + 'data 行是首屏快照（open/taken/done 计数 + roots 列表），PAGE-DATA 块以最新一次为准。'
      + '用 take_task 接取 open 任务，complete_task 完成 taken 任务；完成后用一句话确认。',
    instanceTitle: () => '任务列表',
    // §3.10.1：首页 = 基础信息（load 取真实列表）+ 能力地图（可去的页面与时机；
    // 本应用有详情页 → map 必须非空，规则 1）
    // / §3.10.1: the home page = basic information (the real list via load) +
    // the capability map (reachable pages and when; this app has a detail page,
    // so the map must be non-empty — rule 1)
    load: async () => listFirstScreen(store.getState()) satisfies PageJsonValue,
    map: [
      {
        url: `${URL_PREFIX}/task/:taskId`,
        use: '处理某一条任务时打开（查看字段/子任务树，完成、放弃或拆分它）',
        params: { taskId: '任务 id，来自列表 data 的 roots[].id' },
      },
      { url: `${URL_PREFIX}/publish`, use: '要发布新任务时打开发布页（或直接调 publish_task）' },
    ],
    tree: (_params, items) => {
      const roots: TaskListItem[] = rootsOf(items).map((item) => ({
        ...item,
        progress: subtreeProgress(items, item.id),
      }))
      return (
        <>
          <Static content="任务工作台 · 列表页" />
          <Keyed path="tasks" items={roots} />
        </>
      )
    },
  })
}

// ---- 详情页（详情页 detail）---- Detail page (the detail archetype) ----

export function createDetailPage(store: TaskStore): PageDefinition<TaskItem[]> {
  return defineAppPage<TaskItem[]>({
    name: 'detail',
    url: `${URL_PREFIX}/task/:taskId`,
    description: '任务详情页：查看单个任务的标题/状态/负责人与子任务树',
    tools: ['complete_task', 'abandon_task', 'split_task'],
    writes: true,
    instructions: '这是任务详情页，只处理 params.taskId 指定的这一条任务——这一页只干这一件事。'
      + 'data 行自带该任务的字段与子任务树首屏（found=false 表示任务不存在，不要凭空处理）；'
      + '字段变化经 PAGE-DATA 以最新一次为准。'
      + '用 split_task 把已接取任务拆成子任务（仅当前接取者可用，深度 8 / 单节点 32 子 / 单树 200 节点，'
      + '超限返回 task/subtree-limit）；用 complete_task 完成 taken 任务——子树还有非终态后代时'
      + '会返回 task/children-active，先处理子任务；abandon_task 放弃 taken 任务（回到 open）。',
    // 实例化后显示「任务 #1」，始终是根任务标题（§4.7.4）/ instance title stays the
    // root title (§4.7.4)
    instanceTitle: (params) => `任务 #${params.taskId}`,
    // §3.10.3：详情页 load 按参数取该条记录的首屏快照
    // / §3.10.3: a detail page's load fetches that one record's first screen by params
    load: async (params) => detailFirstScreen(store.getState(), String(params.taskId ?? '')) satisfies PageJsonValue,
    tree: (params, items) => {
      const taskId = String(params.taskId ?? '')
      const task = items.find((item) => item.id === taskId)
      // 投影成带 id 的渲染行（Keyed 条目），活跃分支预置展开标记
      // / project into keyed rows (Keyed entities); active branches carry their
      // expanded-by-default flag
      const rows: SubtaskRow[] = subtaskTree(items, taskId).map((node) => ({
        id: node.item.id,
        title: node.item.title,
        status: node.item.status,
        depth: node.depth,
        expanded: node.expanded,
        progress: node.progress.label,
      }))
      return (
        <>
          <Static content={`任务工作台 · 详情页 ${taskId}`} />
          <Data path="task.title" value={task?.title ?? null} />
          <Data path="task.status" value={task?.status ?? null} />
          <Data path="task.ownerId" value={task?.ownerId ?? null} />
          <Static content={tExpandHint()} />
          <Data
            path="task.subtree"
            value={task === undefined ? null : tProgress(subtreeProgress(items, task.id).label)}
          />
          <Keyed path="subtasks" items={rows} />
        </>
      )
    },
  })
}

// ---- 发布页（工具页 action：无参 + 写工具 publish_task，不需要 map）----
// ---- Publish page (the action archetype: parameterless + the publish_task write tool, no map) ----

export function createPublishPage(): PageDefinition<TaskItem[]> {
  return defineAppPage<TaskItem[]>({
    name: 'publish',
    url: `${URL_PREFIX}/publish`,
    description: '发布任务页：填写草稿并确认发布（投递到宿主任务中心）',
    tools: ['publish_task'],
    writes: true,
    instructions: '这是任务发布页：草稿标题经 data 节点 draft.title 同步。'
      + '用 publish_task 确认发布；标题为空时不要调用。'
      + '发布不支持带子任务的模板（§4.7.6），子任务由接取者用 split_task 现拆。',
    instanceTitle: () => '发布任务',
    tree: (params) => (
      <>
        <Static content="任务工作台 · 发布任务" />
        <Data path="draft.title" value={params.draftTitle ?? ''} />
      </>
    ),
  })
}
