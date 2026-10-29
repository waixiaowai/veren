/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 详情页（detail 档）：URL 带 :taskId，只处理本页那一条。投递闭环的接取步
 * （take_page_task）在这里；写动作全部过同意门（投递回合按记录 id 收窄）。
 * The detail page (the detail archetype): the url carries :taskId and the page
 * handles exactly its one order. The delivery loop's take step (take_page_task)
 * lives here; every write passes the consent gate (a delivery turn is narrowed
 * by record id).
 * @module @veren/task-workbench
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { subtreeProgress, subtaskTree } from './store.ts'
import { followupText, requireRuntime, STRINGS, toolOf, tExpandHint, tLane, tProgress, URL_PREFIX } from './pages.tsx'
import { laneOfItem } from './page-list.tsx'

/** 本页工具（§3.10.1 矩阵的行）：本页读写 + 拆分 + 退回 + 导航 + drive 两件。 */
function registerPageTools(agent: Agent): void {
  for (const localName of ['get_page_task', 'take_page_task', 'complete_task', 'abandon_task', 'split_task', 'requeue_task', 'open_task_page', 'drive_begin', 'drive_end']) {
    agent.ctx.tools.register(toolOf(localName))
  }
}

/** 详情页组件体（一次性渲染）/ the detail page's body (the one-shot render) */
export const DetailPage: PageFC<{ taskId: string }> = (props, agent) => {
  registerPageTools(agent)
  const { store, channel } = requireRuntime()
  const taskId = String(props.taskId ?? '')
  const item = store.getState().find((entry) => entry.id === taskId)
  // 首屏生命周期：中心真身随消息送达（投影可能缺这条——投递来的单在别的会话发布）
  // / the first-screen lifecycle: the center's real body as a message (the projection may miss this order — a delivered order was published elsewhere)
  agent.ctx.effect(async () => {
    try {
      const records = await channel.list()
      store.rebuildFrom(records)
      const record = records.find((entry) => entry.parentId === undefined
        && (entry.target.params['taskId'] === taskId || `wb-${entry.id}` === taskId))
      followupText(agent, record === undefined
        ? `[task-workbench] 任务 ${taskId} 在任务中心无记录——如实告知用户，不要凭空处理。/ no task-center record for ${taskId}; tell the user honestly.`
        : `[task-workbench] ${taskId} 的中心真身：${record.id} · ${record.title} · ${record.status} · ${record.target.url}${record.result?.summary === undefined ? '' : ` · ${record.result.summary}`}`)
    } catch (error: unknown) {
      followupText(agent, '[task-workbench] 任务中心读取失败：' + (error instanceof Error ? error.message : String(error)))
    }
    return async () => undefined
  }, 'task-workbench:detail-first-screen')
  if (item === undefined) {
    // 投影缺这条（投递来的单还没进投影）：如实渲染，真身随消息送达
    // / the projection misses this order (a delivered one not yet projected): render honestly, the real body arrives as a message
    return (
      <>
        <h1>任务 {taskId}（中心记录加载中）</h1>
        <blockquote>本页正文还没有这条任务的投影；它的中心真身随后以消息送达，或用 get_page_task 读取。不要凭空处理。</blockquote>
      </>
    )
  }
  const rows = subtaskTree(store.getState(), taskId)
  return (
    <>
      <h1>{item.id} {item.title}</h1>
      <p>状态 <strong>{tLane(laneOfItem(item))}</strong>{item.dispatchedTo !== undefined ? ` → ${item.dispatchedTo}` : ''}
        {' · '}负责人 {item.ownerId ?? '未认领'}{' · '}{tProgress(subtreeProgress(store.getState(), taskId).label)}</p>
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
      <p>{STRINGS.splitHint.zh}</p>
      <hr />
      <p><a href={`${URL_PREFIX}/list`}>← 返回队列</a></p>
    </>
  )
}

export const DetailMeta: ComponentPageMeta<{ taskId: string }> = {
  name: 'detail',
  url: `${URL_PREFIX}/task/:taskId`,
  description: '任务详情页：读取本页任务当前状态（get_page_task，无参数），接取本页任务（take_page_task，无参数），处理该任务的状态/负责人与子任务树',
  writes: true,
  // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 17）：完成路径页面自足
  // ——complete_task 直接结算任务中心记录（取证结论：页面会话不可达宿主全局 task_*）。
  // / The unattended contract (docs/unattended-page-contract.md §5 row 17): the
  // completion face is page-sufficient — complete_task settles the task-center
  // record directly (the §6 verdict: host-global task_* are unreachable here).
  unattended: {
    serves: '投递到本页 URL 的单条任务的执行与结算（接取/完成/拆分/退回，投递回合按记录 id 收窄同意）',
    level: 'L1',
    evidence: 'complete_task 的 summary + 任务中心记录终态（result/failure 可机查）',
    escape: '做不下去用 abandon_task 回 open 队列、requeue_task 退回/改派——绝不挂起等用户；租约到期中心懒回收兜底',
  },
  // 实例化后显示「任务 #1」——会话列表标题始终是根任务标识（§4.7.4）
  // / the instance shows 「任务 #1」 — the session-list title stays the root order's identifier (§4.7.4)
  instanceTitle: (params) => `任务 #${params.taskId}`,
  instructions: '这是任务详情页，只处理 params.taskId 指定的这一条任务——这一页只干这一件事。'
    + '盘点/询问类请求用 get_page_task 读取后回答，不接取、不改动。'
    + '有人把任务交给你**执行**时（用户点名，或点名本任务的投递指令/TASK 块/收件箱通知）：先 drive_begin 声明范围，'
    + '再用 take_page_task 接取（无需参数，接的就是本页这条；被别的会话持有时返回 task/already-taken），动手，'
    + '完成后 complete_task 带 summary（中心子树还有非终态后代时返回 task/children-active），做不下去用 abandon_task 放弃'
    + '（回 open 队列）；收尾可用 drive_end 收回。两种同意都没有时写会被 consent/required 拒绝——如实告知，不要重试。'
    + '目标在别的应用时用 open_task_page 打开目标页（带回执）或 requeue_task 改派；'
    + '本应用处理不了的单子 requeue_task 回 open 队列，不许无声悬置。'
    + '用 split_task 拆子任务（仅当前接取者可用，深度 8 / 单节点 32 子 / 单树 200 节点，超限返回 task/subtree-limit）。'
    + '正文即首屏投影（"加载中"表示中心真身随后以消息送达）；此后任务变化以工具返回为准。'
    + '用户或投递方的显式要求与上述流程冲突时，以显式要求为准。',
}
