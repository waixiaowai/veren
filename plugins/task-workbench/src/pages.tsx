/**
 * 应用的三个页面：列表 / 详情 / 发布（defineAppPage，URL 统一 /apps/task-workbench/...）。
 * The app's three pages: list / detail / publish via defineAppPage.
 *
 * 与 page-sync-bench 的差异：不再绑定预设（preset 字段删除），改为
 * tools（应用工具目录本地名）+ instructions（页面给模型的说明，非系统提示词）
 * + instanceTitle（实例化标题）+ pageRevision（页面契约版本）。
 * @module @veren/task-workbench
 */
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import type { TaskItem } from './types.ts'

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
    + '{"kind":"keyed","path":"tasks","items":[...]} 按条目 id 对位。'
    + '用 take_task 接取 open 任务，complete_task 完成 taken 任务；完成后用一句话确认。',
  instanceTitle: () => '任务列表',
  pageRevision: 1,
  tree: (_params, items) => (
    <>
      <Static content="任务工作台 · 列表页" />
      <Keyed path="tasks" items={items} />
    </>
  ),
})

// ---- 详情页 / Detail page ----

export const detailPage: PageDefinition<TaskItem[]> = defineAppPage<TaskItem[]>({
  name: 'detail',
  url: `${URL_PREFIX}/task/:taskId`,
  description: '任务详情页：查看单个任务的标题/状态/负责人',
  tools: ['complete_task', 'abandon_task'],
  instructions: '这是任务详情页：字段经 data 节点（task.title/task.status/task.ownerId）同步。'
    + '用 complete_task 完成 taken 任务；abandon_task 放弃 taken 任务（回到 open）。',
  // 实例化后显示「任务 #1」/ rendered instance title like 「任务 #1」
  instanceTitle: (params) => `任务 #${params.taskId}`,
  pageRevision: 1,
  tree: (params, items) => {
    const task = items.find((item) => item.id === params.taskId)
    return (
      <>
        <Static content={`任务工作台 · 详情页 ${params.taskId ?? ''}`} />
        <Data path="task.title" value={task?.title ?? null} />
        <Data path="task.status" value={task?.status ?? null} />
        <Data path="task.ownerId" value={task?.ownerId ?? null} />
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
    + '用 publish_task 确认发布；标题为空时不要调用。',
  instanceTitle: () => '发布任务',
  pageRevision: 1,
  tree: (params) => (
    <>
      <Static content="任务工作台 · 发布任务" />
      <Data path="draft.title" value={params.draftTitle ?? ''} />
    </>
  ),
})
