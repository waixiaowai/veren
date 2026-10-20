/**
 * 应用的三个页面：列表 / 详情 / 发布（defineAppPage，URL 统一 /apps/task-workbench/...）。
 * The app's three pages: list / detail / publish via defineAppPage.
 *
 * §4.7.8：列表页按整棵子树口径显示进度（`2/5`）；详情页新增子任务树区（活跃分支
 * 默认展开、终态分支折叠成进度徽标），instanceTitle 始终用根任务标题；子任务没有
 * 独立 URL 和会话（§4.7.4），树是数据不是身份。
 * §4.7.8: the list page shows whole-subtree progress (`2/5`); the detail page
 * grows a subtask tree (active branches expanded by default, terminal branches
 * collapsed into progress badges); instanceTitle stays the root title; subtasks
 * have no url or session of their own (§4.7.4) — the tree is data, not identity.
 * @module @veren/task-workbench
 */
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import { rootsOf, subtreeProgress, subtaskTree } from './store.ts'
import type { SubtaskRow, TaskItem, TaskListItem } from './types.ts'
import { tExpandHint, tProgress } from './texts.ts'

/** 应用 id（页面 URL 前缀的权威来源）/ the app id (authority of the url prefix) */
export const APP_ID = 'task-workbench'
/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

// ---- 列表页（入口）/ List page (the entry) ----

export const listPage: PageDefinition<TaskItem[]> = defineAppPage<TaskItem[]>({
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '任务工作台列表页：浏览全部任务，接取/完成任务',
  tools: ['take_task', 'complete_task'],
  instructions: '这是任务工作台的列表页。页面状态经 SNAPSHOT/PATCH 同步，'
    + '{"kind":"keyed","path":"tasks","items":[...]} 按条目 id 对位；'
    + '列表只显示根任务，每条带整棵子树的进度徽标（2/5 = 全树终态/全树节点）。'
    + '用 take_task 接取 open 任务，complete_task 完成 taken 任务；完成后用一句话确认。',
  instanceTitle: () => '任务列表',
  // v2：条目改为根任务 + 整树进度 / v2: items are roots with whole-tree progress
  pageRevision: 2,
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

// ---- 详情页 / Detail page ----

export const detailPage: PageDefinition<TaskItem[]> = defineAppPage<TaskItem[]>({
  name: 'detail',
  url: `${URL_PREFIX}/task/:taskId`,
  description: '任务详情页：查看单个任务的标题/状态/负责人与子任务树',
  tools: ['complete_task', 'abandon_task', 'split_task'],
  instructions: '这是任务详情页：字段经 data 节点（task.title/task.status/task.ownerId）同步，'
    + '子任务树经 subtasks 列表同步（depth/expanded/progress 为投影值）。'
    + '用 split_task 把已接取任务拆成子任务（仅当前接取者可用，深度 8 / 单节点 32 子 / 单树 200 节点，'
    + '超限返回 task/subtree-limit）；用 complete_task 完成 taken 任务——子树还有非终态后代时'
    + '会返回 task/children-active，先处理子任务；abandon_task 放弃 taken 任务（回到 open）。',
  // 实例化后显示「任务 #1」，始终是根任务标题（§4.7.4）/ instance title stays the
  // root title (§4.7.4)
  instanceTitle: (params) => `任务 #${params.taskId}`,
  // v2：新增子任务树区 / v2: adds the subtask tree region
  pageRevision: 2,
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

// ---- 发布页 / Publish page ----

export const publishPage: PageDefinition<TaskItem[]> = defineAppPage<TaskItem[]>({
  name: 'publish',
  url: `${URL_PREFIX}/publish`,
  description: '发布任务页：填写草稿并确认发布（投递到宿主任务中心）',
  tools: ['publish_task'],
  instructions: '这是任务发布页：草稿标题经 data 节点 draft.title 同步。'
    + '用 publish_task 确认发布；标题为空时不要调用。'
    + '发布不支持带子任务的模板（§4.7.6），子任务由接取者用 split_task 现拆。',
  instanceTitle: () => '发布任务',
  pageRevision: 2,
  tree: (params) => (
    <>
      <Static content="任务工作台 · 发布任务" />
      <Data path="draft.title" value={params.draftTitle ?? ''} />
    </>
  ),
})
