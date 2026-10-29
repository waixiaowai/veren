/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 页面共享基建（模块级槽位 + 双语文案 + 首屏生命周期）。三个页面组件在
 * page-list.tsx / page-detail.tsx / page-publish.tsx——各自一个职责域。
 * The pages' shared infrastructure (module slot + bilingual strings + the
 * first-screen lifecycle). The three page components live in page-list.tsx /
 * page-detail.tsx / page-publish.tsx — one responsibility domain each.
 *
 * 装配期绑定的槽位是组件体与工具定义的唯一取数正道（权威投影 + 全名工具 +
 * 注册表目录，`bindWorkbenchRuntime` 由装配调用一次）。store 是同步投影面，
 * 正文直读当前状态——首屏不经手宿主取数；队列真身由 effect 拉取后经 followup
 * 送达（forum-app 的同款生命周期）。
 * The assembly-bound slot is the only straight path for bodies and tool
 * definitions (the authoritative projection + full-named tools + the registry
 * catalog, bound once by `bindWorkbenchRuntime`). The store is a synchronous
 * projection: bodies read the current state directly — no host-mediated
 * first-screen fetching; the queue's real body is fetched by an effect and
 * delivered as a followup (forum-app's lifecycle).
 * @module @veren/task-workbench
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'
import { belongsToQueue, strategyView } from './strategy.ts'
import type { TaskChannel } from './channel.ts'
import type { TaskStore } from './store.ts'

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

/** 支持的语言 / supported languages */
export type Lang = 'zh' | 'en'

/** 当前包默认语言（页面树取词）/ the package default language for page trees */
const DEFAULT_LANG: Lang = 'zh'

/** 双语文案（lane 标签 + 提示；页面树是唯一取词方）/ bilingual strings (lane labels + hints; the page trees are the only consumer) */
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
  lanes: {
    zh: { takeable: '可接取', dispatched: '已派发', held: '被租约持有', completed: '已完成', returned: '已退回', stale: '已归档' },
    en: { takeable: 'takeable', dispatched: 'dispatched', held: 'held', completed: 'completed', returned: 'returned', stale: 'archived' },
  },
  snapshot: {
    zh: '正文是打开时刻的首屏快照；队列真身以 list_tasks 的返回与首屏消息为准。',
    en: 'The body is the open-time snapshot; the queue\'s real body is what list_tasks returns and what the first-screen message delivers.',
  },
} as const

/** 取词函数（一个文案一个具名函数，零泛型魔法）/ one named resolver per string — no generic indirection */
export const tProgress = (label: string, lang: Lang = DEFAULT_LANG) => STRINGS.progress[lang](label)
export const tExpandHint = (lang: Lang = DEFAULT_LANG) => STRINGS.expandHint[lang]
export const tLane = (lane: keyof typeof STRINGS.lanes.zh, lang: Lang = DEFAULT_LANG) => STRINGS.lanes[lang][lane]
export const tSnapshot = (lang: Lang = DEFAULT_LANG) => STRINGS.snapshot[lang]

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = `/apps/task-workbench`

/** 工具对外名：`<toolPrefix>__<本地名>`（§3.4.3）/ the external tool name */
export const externalName = (localName: string): string => `task_workbench__${localName}`

/** 装配期绑定的模块级槽位 / the module-level slot bound at assembly time */
export interface WorkbenchRuntime {
  readonly store: TaskStore
  readonly tools: readonly ToolDefinition[]
  /** 注册表目录快照（跨应用地图 + 发布校验的事实源）/ the registry catalog snapshot (the cross-app map + publish-validation fact source) */
  readonly catalog: () => readonly AppRecord[]
  readonly channel: TaskChannel
  /** 队列为空时懒播种的示例工作单数（0 = 不播）/ sample orders lazily seeded when the queue is empty (0 = never) */
  readonly seedSize: number
}

let runtime: WorkbenchRuntime | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindWorkbenchRuntime(bound: WorkbenchRuntime): void {
  runtime = bound
}

/** 取绑定的运行时；未绑定 = 装配错误 fail loud / read the bound runtime; unbound = assembly error, fail loud */
export function requireRuntime(): WorkbenchRuntime {
  if (runtime === undefined) {
    throw new Error('[task-workbench] the workbench runtime is not bound; the app wiring must run before pages open')
  }
  return runtime
}

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
export function toolOf(localName: string): ToolDefinition {
  const name = externalName(localName)
  const found = requireRuntime().tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`[task-workbench] tool ${name} is not defined`)
  return found
}

/** 页面自推消息（source = app/page；宿主装配的 PAGE 块同源）/ push one page message (source = app/page) */
export function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }] as ContentBlock[], source: { kind: 'app/page' } }))
}

/**
 * 首屏生命周期（列表页）：懒播种子（幂等键去重，重启不重播）→ 重建投影 →
 * 策略视图随消息送达。失败只降级——投影正文照常可读。
 * The list page's first-screen lifecycle: lazy sample seeding (idempotency-key
 * dedup, never re-sown after a restart) → projection rebuild → the strategy
 * view delivered as a message. Failures degrade — the projected body stays
 * readable.
 */
export async function refreshQueue(agent: Agent, channel: TaskChannel, store: TaskStore, seedSize: number): Promise<void> {
  let records = await channel.list()
  const roots = records.filter((record) => record.parentId === undefined && belongsToQueue(record))
  if (seedSize > 0 && roots.length === 0) {
    await seedSamples(channel, seedSize)
    records = await channel.list()
  }
  store.rebuildFrom(records)
  const view = strategyView(records)
  followupText(agent, strategyText(view))
}

/** 播种示例工作单（幂等键固定；已有记录时中心按键去重，二次播种是空操作） / seed the sample orders (fixed keys; the center dedups, so a re-seed is a no-op) */
async function seedSamples(channel: TaskChannel, size: number): Promise<void> {
  for (let index = 1; index <= size; index += 1) {
    const itemId = `t-${index}`
    await channel.send({
      kind: 'task-workbench/publish' as TaskRecord['kind'],
      title: `示例任务 ${index}`,
      target: { url: `/apps/task-workbench/task/${itemId}` as TaskRecord['target']['url'], appId: 'task-workbench', page: 'detail', params: { taskId: itemId } },
      idempotencyKey: `task-workbench/sample-${index}`,
    })
  }
}

/** 策略视图的模型可读文本（首屏消息体）/ the strategy view's model-readable text (the first-screen message body) */
export function strategyText(view: ReturnType<typeof strategyView>): string {
  const counts = (Object.entries(view.counts) as [keyof typeof view.counts, number][])
    .map(([lane, count]) => `${tLane(lane)} ${count}`)
    .join(' · ')
  const rows = view.rows.map((row) => {
    const flags = [
      tLane(row.lane),
      row.needsConfirmation ? '需确认/confirm' : null,
      row.dispatchedTo !== undefined ? `→ ${row.dispatchedTo}` : null,
      row.claimantSessionId !== undefined ? `held by ${row.claimantSessionId}` : null,
    ].filter((entry): entry is string => entry !== null)
    return `- ${row.id} ${row.title}（${flags.join(' · ')} · 等 ${row.waitMinutes} 分钟）目标 ${row.targetUrl}`
  })
  return ['[task-workbench] 队列策略视图（打开时刻的真身）/ the queue strategy view (the real body at open time)', counts, ...rows].join('\n')
}
