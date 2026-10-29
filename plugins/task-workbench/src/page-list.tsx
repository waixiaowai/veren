/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 列表页（首页 home / entry）：工单化首屏（§B）——策略视图五 lane + 跨应用
 * 目录行（§D，来源 = 注册表）。写工具全部过同意门：browse 只读，drive 先
 * drive_begin 逐轮声明范围（§A）。
 * The list page (the home archetype): the ticket-style first screen (§B) — the
 * five-lane strategy view plus cross-app catalog rows (§D, source = the
 * registry). Every write tool passes the consent gate: browse is read-only,
 * drive declares a per-turn scope via drive_begin first (§A).
 * @module @veren/task-workbench
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { subtreeProgress } from './store.ts'
import type { QueueLane } from './types.ts'
import { externalName, followupText, requireRuntime, refreshQueue, STRINGS, toolOf, tLane, tProgress, URL_PREFIX } from './pages.tsx'

/**
 * 本页工具（§3.10.1 矩阵的行）：盘点/接取/完成/退回/发布 + drive 两件 + 导航。
 * publish_task 挂列表页是真机验收的修正：用户在入口点名发布时，本会话必须有
 * 发布工具——page_send 把指令转投发布页过不了同意门（中继 ≠ 用户同意）。
 * This page's matrix rows: list/take/complete/requeue/publish + the two drive
 * tools + navigation. Mounting publish_task here is a live-verification fix: a
 * user naming a publish at the entry needs the tool in-session — page_send
 * forwarding to the publish page cannot pass the gate (a relay is not user
 * consent).
 */
function registerPageTools(agent: Agent): void {
  for (const localName of ['list_tasks', 'take_task', 'complete_task', 'publish_task', 'requeue_task', 'open_task_page', 'drive_begin', 'drive_end']) {
    agent.ctx.tools.register(toolOf(localName))
  }
}

/** 投影条目的 lane 判定（与策略视图同口径的正文侧投影）/ an item's lane (the body-side projection, same reading as the strategy view) */
export function laneOfItem(item: { readonly status: string; readonly dispatchedTo?: string }): QueueLane {
  if (item.status === 'open') return item.dispatchedTo !== undefined ? 'dispatched' : 'takeable'
  if (item.status === 'taken') return 'held'
  if (item.status === 'done') return 'completed'
  if (item.status === 'failed' || item.status === 'orphaned') return 'returned'
  return 'stale'
}

const LANES: readonly QueueLane[] = ['takeable', 'dispatched', 'held', 'completed', 'returned', 'stale']

/** 列表页组件体（一次性渲染）/ the list page's body (the one-shot render) */
export const ListPage: PageFC = (_props, agent) => {
  registerPageTools(agent)
  const runtime = requireRuntime()
  const { store, catalog, channel } = runtime
  // 首屏生命周期：懒播种子 + 队列真身随消息送达（宿主不经手取数）
  // / the first-screen lifecycle: lazy seeding + the queue's real body as a message (the host touches no fetching)
  agent.ctx.effect(async () => {
    try {
      await refreshQueue(agent, channel, store, runtime.seedSize)
    } catch (error: unknown) {
      followupText(agent, '[task-workbench] 任务中心读取失败：' + (error instanceof Error ? error.message : String(error))
        + '——投影正文仍可读；稍后用 list_tasks 再取。/ the task center read failed; the projected body still reads; retry with list_tasks.')
    }
    return async () => undefined
  }, 'task-workbench:list-first-screen')
  const items = store.getState().filter((item) => item.parentId === undefined)
  const counts = LANES
    .map((lane) => ({ lane, count: items.filter((item) => laneOfItem(item) === lane).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${tLane(entry.lane)} ${entry.count}`)
  return (
    <>
      <h1>任务工作台 · 队列</h1>
      <p>{counts.join(' · ') || '队列为空（首屏消息随后送达真身）'}</p>
      <ul>
        {items.map((item) => {
          const lane = laneOfItem(item)
          return (
            <li key={item.id}>
              <strong>{item.id}</strong> {item.title}
              （{tLane(lane)}{item.dispatchedTo !== undefined ? ` → ${item.dispatchedTo}` : ''}
              {' · '}{tProgress(subtreeProgress(store.getState(), item.id).label)}）
            </li>
          )
        })}
      </ul>
      <h2>跨应用目录</h2>
      <ul>
        {catalog().filter((record) => record.state === 'active').map((record) => (
          <li key={record.definition.id}>
            {record.definition.id}（{record.definition.name}）→ {record.definition.description}；
            入口 {record.pages?.get(record.definition.entry)?.url ?? '（未注册）'}
          </li>
        ))}
      </ul>
      <blockquote>
        {STRINGS.snapshot.zh}写动作（take/complete/requeue/publish/open）需要本回合同意：用户点名，或点名本任务的投递指令；
        browse 模式先 drive_begin 声明范围。队列真身随后以消息送达。
      </blockquote>
    </>
  )
}

export const ListMeta: ComponentPageMeta = {
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '任务工作台列表页：队列策略视图、跨应用目录，接取/完成/退回工作单，打开目标应用页面',
  // 本页挂载写工具（take/complete/requeue/open），如实声明写意图（§3.9/§3.10.1 规则 3）
  // / this page mounts write tools (take/complete/requeue/open); declare the intent honestly
  writes: true,
  // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 16）
  // / the unattended contract (docs/unattended-page-contract.md §5 row 16)
  unattended: {
    serves: '投递任务的队列视图与推进/派发（browse/drive 两模式；写工具过同意门，投递同意按任务 id 收窄）',
    level: 'L1',
    evidence: 'complete_task 的 summary + 任务中心记录终态（result/failure 可机查，task-center/completed 可订阅）',
    escape: '做不完用 abandon_task 回 open 队列或 requeue_task 退回/改派——绝不悬置；租约到期由中心懒回收兜底',
  },
  instructions: '这是任务工作台的首页（队列）。正文给出策略视图（每条工作单带 lane：可接取/已派发/被持有/已完成/已退回）'
    + '与跨应用目录（来源 = 注册表；要打开别的应用先查这里，再调用 open_task_page 或按目录 URL 走宿主正门）。'
    + '只读盘点、询问类请求用 list_tasks 直接回答。写工具（take_task/complete_task/requeue_task/publish_task/open_task_page）'
    + '的合法触发：本回合有用户消息（用户点名的事），或本回合收到点名该任务的投递指令（TASK 块/收件箱通知）；'
    + '满足其一后先 drive_begin 声明范围与理由，再逐条写，未声明范围的任务会被 consent/scope-exceeded 拒绝；'
    + '收尾可用 drive_end 收回。'
    + '没有这两种同意时写会被 consent/required 拒绝——如实告知用户需要点名，不要重试。'
    + '推进一条任务的完整序列：drive_begin → take_task → … → complete_task，并用一句话向用户确认。'
    + '首屏消息随后送达队列真身，以它和工具返回为准；用户或投递方的显式要求与上述流程冲突时，以显式要求为准。',
}

