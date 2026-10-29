/**
 * 无人值守页面契约检查器（docs/unattended-page-contract.cn.md）：18 页达标
 * 矩阵的可执行面。各应用 `tests/contract.spec.ts` 喂自己的矩阵行——
 * `assertUnattendedPage` 核对声明（契约字段、级与挂载工具一致、L2 有出路）、
 * `assertNoUnattendedStall` 是文本禁令（L0/L1 说明句不得出现"写前确认/等
 * 用户"类停摆措辞——forum 被加一刀切确认门时的变异探测器）。
 * The unattended page-contract checker (docs/unattended-page-contract.md):
 * the executable face of the 18-page matrix. Each app's tests/contract.spec.ts
 * feeds its own rows — `assertUnattendedPage` checks the declaration (the
 * contract field, level-vs-mounted-tools consistency, an L2 escape) and
 * `assertNoUnattendedStall` is the text ban (an L0/L1 page's instructions must
 * not carry "confirm before writing / wait for the user" stall wording — the
 * mutation detector for a blanket-confirm regression on forum).
 * @module @veren/test-support/page-contract
 */
import type { UnattendedContract } from '@veren/prompt-page'

/** 动作级（§1）/ the action levels (§1) */
export type ActionLevel = 'L0' | 'L1' | 'L2'

/** 级的全序：L0 < L1 < L2 / the level total order */
const LEVEL_RANK: Record<ActionLevel, number> = { L0: 0, L1: 1, L2: 2 }

/** 一行"页面 → 工具"清单里的一个工具 / one tool in a page's mounted-face row */
export interface ContractToolRow {
  /** 工具全名（`<prefix>__<local>`）/ the full tool name */
  readonly name: string
  /** 该工具的动作级 / the tool's action level */
  readonly level: ActionLevel
}

/**
 * 页面契约 meta 的协变投影（检查器只读这五项；不收 instanceTitle 是为了
 * 带参页面在 exactOptionalPropertyTypes 下的方差——参数型 meta 也能直接喂；
 * 可选项显式 `| undefined`，参数型 meta 的缺省可选属性才可赋值）。
 * / The covariate projection of the page contract meta (the checker reads
 * exactly these five; instanceTitle is dropped so parameterized metas feed
 * directly under exactOptionalPropertyTypes variance; optionals carry an
 * explicit `| undefined` so metas whose optional props default fit).
 */
export interface ContractMetaFace {
  readonly url: string
  readonly description: string
  readonly writes?: boolean | undefined
  readonly instructions?: string | undefined
  readonly unattended?: UnattendedContract | undefined
}

/** 一行 18 页矩阵：页面 meta + 挂载面（可缺省 = 只查声明）/ one row of the 18-page matrix: the meta plus the mounted face (optional = declaration-only check) */
export interface ContractPageRow {
  /** 页面显示名（失败信息用）/ the page display name (for failure messages) */
  readonly label: string
  /** 页面契约 meta（只读 {@link ContractMetaFace} 的五项）/ the page contract meta (read through ContractMetaFace) */
  readonly meta: ContractMetaFace
  /** 本页挂载的工具面（缺省 = 只查声明与文本）/ the mounted tool face (absent = declaration + text only) */
  readonly tools?: readonly ContractToolRow[]
}

/**
 * 无人值守停摆措辞禁令：这些短语出现在 L0/L1 页面的说明句里 = 该页面无人时
 * 写任务停摆，违反判据 (b)。L2 页面豁免（人在场确认门是 L2 的可选增强）。
 * The stall-wording ban: any of these in an L0/L1 page's instructions = the
 * page's write tasks stall unattended, violating criterion (b). L2 pages are
 * exempt (a human-present gate is an optional L2 enhancement).
 */
const STALL_PHRASES: readonly string[] = [
  '写前先向用户确认',
  '先向用户确认',
  '向用户确认后再',
  '所有写入前',
  '写前确认',
  '等用户确认',
  '等待用户确认',
  'confirm with the user before',
  'ask the user before writing',
  'wait for the user',
]

/** L2 出路必须点名的形态：稳定拒绝码或回滚路 / what an L2 escape must name: a stable refusal code or a rollback path */
const L2_ESCAPE_PATTERN = /unattended\//i

/** 逐条失败即抛（信息带页面名与修法指向）/ fail loud on the first violation (message carries the page name) */
function fail(row: ContractPageRow, why: string): never {
  throw new Error(`[unattended-contract] ${row.label}: ${why}`
    + '（见 docs/unattended-page-contract.cn.md §5 矩阵行 / see the §5 matrix row）')
}

/**
 * 核对一行矩阵（§2 校验规则）：契约字段在、级与挂载面一致、L2 有出路、
 * L0/L1 无停摆措辞、writes 声明与挂载写工具互证。
 * Check one matrix row (§2 rules): the contract field present, level consistent
 * with the mounted face, an L2 escape, no stall wording on L0/L1, and the
 * writes declaration cross-checked against mounted write tools.
 */
export function assertUnattendedPage(row: ContractPageRow): void {
  const contract = row.meta.unattended
  if (contract === undefined) fail(row, 'meta.unattended 缺失——本页在 18 页矩阵里，必须声明契约字段')
  if (contract.serves.trim().length === 0) fail(row, 'unattended.serves 为空：说明本页服务哪类投递任务')
  if (contract.evidence.trim().length === 0) fail(row, 'unattended.evidence 为空：说明完成证据形态')
  if (contract.escape.trim().length === 0) fail(row, 'unattended.escape 为空：说明失败出路')
  if (row.meta.instructions === undefined || row.meta.instructions.trim().length === 0) {
    fail(row, 'instructions 为空：无人值守条款必须随 PAGE 块送达')
  }
  if (contract.level === 'L2' && L2_ESCAPE_PATTERN.test(contract.escape) === false) {
    fail(row, `unattended.escape 必须点名稳定拒绝码（unattended/l2-refused）或回滚路；现为「${contract.escape}」`)
  }
  if (contract.level === 'L0' && row.meta.writes === true) {
    fail(row, 'L0 页面声明了 writes: true——只读页不得声明写意图')
  }
  for (const tool of row.tools ?? []) {
    if (LEVEL_RANK[tool.level] > LEVEL_RANK[contract.level]) {
      fail(row, `挂载工具 ${tool.name}（${tool.level}）超出页面级上限 ${contract.level}`)
    }
    if (tool.level !== 'L0' && row.meta.writes !== true) {
      fail(row, `挂载写工具 ${tool.name} 但 meta 漏 writes: true（§3.9 交叉核对失效）`)
    }
  }
  if (contract.level !== 'L2' && row.meta.instructions !== undefined) {
    assertNoUnattendedStall(row.label, row.meta.instructions)
  }
}

/**
 * 文本禁令：说明句不得出现停摆措辞（"写前先向用户确认"类）。这是变异探测器
 * 的一半——给 forum 这类 L1 达标页加一刀切确认门时必须变红。
 * The text ban: instructions must not carry stall wording. This is half of the
 * mutation detector — adding a blanket confirmation gate to a compliant L1 page
 * like forum must turn this red.
 */
export function assertNoUnattendedStall(label: string, instructions: string): void {
  for (const phrase of STALL_PHRASES) {
    if (instructions.includes(phrase)) {
      throw new Error(`[unattended-contract] ${label}: 说明句含停摆措辞「${phrase}」`
        + '——L0/L1 页面无人时必须自主执行或如实拒绝，不许挂起等确认')
    }
  }
}
