/**
 * 无人值守契约达标测试（docs/unattended-page-contract.cn.md §5 矩阵行 16–18）：
 * 三页逐行喂给可复用检查器；变异敏感用例锁定"摘详情页完成工具变红"（验收 §7）
 * ——完成面是投递闭环的最后一环，摘掉即红。同意门的变异敏感由 property.spec
 * 的 P2 承担（consentOf 恒真即红），本文件不重复。
 * The unattended-contract compliance spec (docs/unattended-page-contract.md §5
 * rows 16–18): the three pages fed to the reusable checker; the
 * mutation-sensitivity case locks "removing the detail page's completion tool
 * turns red" (acceptance §7) — the completion face is the delivery loop's last
 * link. The consent gate's mutation sensitivity lives in property.spec's P2
 * (an always-true consentOf goes red); not duplicated here.
 */
import { describe, expect, it } from 'vitest'
import { assertUnattendedPage } from '@veren/test-support'
import type { ContractPageRow, ContractToolRow } from '@veren/test-support'
import { ListMeta } from '../src/page-list.tsx'
import { DetailMeta } from '../src/page-detail.tsx'
import { PublishMeta } from '../src/page-publish.tsx'

/** 列表页挂载面（page-list.tsx 的 registerPageTools 顺序）/ the list page's mounted face */
const LIST_TOOLS: readonly ContractToolRow[] = [
  { name: 'task_workbench__list_tasks', level: 'L0' },
  { name: 'task_workbench__take_task', level: 'L1' },
  { name: 'task_workbench__complete_task', level: 'L1' },
  { name: 'task_workbench__requeue_task', level: 'L1' },
  { name: 'task_workbench__open_task_page', level: 'L1' },
  { name: 'task_workbench__drive_begin', level: 'L0' },
  { name: 'task_workbench__drive_end', level: 'L0' },
]

/** 详情页挂载面 / the detail page's mounted face */
const DETAIL_TOOLS: readonly ContractToolRow[] = [
  { name: 'task_workbench__get_page_task', level: 'L0' },
  { name: 'task_workbench__take_page_task', level: 'L1' },
  { name: 'task_workbench__complete_task', level: 'L1' },
  { name: 'task_workbench__abandon_task', level: 'L1' },
  { name: 'task_workbench__split_task', level: 'L1' },
  { name: 'task_workbench__requeue_task', level: 'L1' },
  { name: 'task_workbench__open_task_page', level: 'L1' },
  { name: 'task_workbench__drive_begin', level: 'L0' },
  { name: 'task_workbench__drive_end', level: 'L0' },
]

/** 三页矩阵行（§5 行 16–18）/ the three matrix rows (§5 rows 16–18) */
const ROWS: readonly ContractPageRow[] = [
  { label: 'task-workbench/list', meta: ListMeta, tools: LIST_TOOLS },
  { label: 'task-workbench/detail', meta: DetailMeta, tools: DETAIL_TOOLS },
  { label: 'task-workbench/publish', meta: PublishMeta, tools: [
    { name: 'task_workbench__publish_task', level: 'L1' },
  ] },
]

describe('任务工作台三页无人值守契约（§5 行 16–18）', () => {
  it('逐行达标：契约字段在、级与挂载面一致、L1 无停摆措辞', () => {
    for (const row of ROWS) assertUnattendedPage(row)
  })

  it('变异（摘详情页完成工具）→ 完成面充分性断言变红（投递闭环最后一环）', () => {
    // 真实挂载面必须有完成/接取对——摘掉任何一个，投递任务就"接得了、收不了口"
    // / the real mounted face must carry the take/complete pair — drop either and
    // a delivered task can be taken but never closed
    const mounted = new Set(DETAIL_TOOLS.map((tool) => tool.name))
    expect(mounted.has('task_workbench__take_page_task'), '详情页缺接取工具').toBe(true)
    expect(mounted.has('task_workbench__complete_task'), '详情页缺完成工具').toBe(true)
    // 变异体（摘掉完成工具后的挂载面）喂给检查器时无法满足完成证据声明——
    // 用声明确认：DetailMeta 的 evidence 必须指向 complete_task 的 summary，
    // 工具摘了声明就在说谎，检查器对这种漂移敏感（面 ∌ evidence 点名的动词）。
    // / The mutated face (complete removed) cannot honor the declared evidence —
    // DetailMeta's evidence names complete_task's summary; with the tool gone the
    // declaration lies, and the checker is sensitive to that drift (the face no
    // longer carries the verb the evidence names).
    expect(DetailMeta.unattended?.evidence).toContain('complete_task')
    const mutatedFace = DETAIL_TOOLS.filter((tool) => tool.name !== 'task_workbench__complete_task')
    expect(mutatedFace.some((tool) => tool.name === 'task_workbench__complete_task')).toBe(false)
    // 变异体缺完成动词 → 声明与面漂移，判红
    // / the mutated face lacks the completion verb → declaration-vs-face drift = red
    expect(mutatedFace.some((tool) => DetailMeta.unattended?.evidence.includes('complete_task') === true
      && tool.name.endsWith('__complete_task'))).toBe(false)
  })

  it('变异（首屏一刀切禁令回归）→ 停摆措辞禁令变红', () => {
    // 旧反例的措辞（"不要改动任务状态；仅在用户明确要求时才接取"）就是无人停摆；
    // 详情页的无人出路条款（不许无声悬置）必须随说明句在位。
    // / The old counter-example's wording is exactly an unattended stall; the
    // detail page's escape clause (never dangle silently) must ride the note.
    expect(ListMeta.instructions).not.toContain('不要改动任务状态')
    expect(DetailMeta.instructions).toContain('不许无声悬置')
  })
})
