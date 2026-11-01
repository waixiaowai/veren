#!/usr/bin/env node
/**
 * 模型面门禁（S2）：给"模型读到的一切"做穷举回归——应用页 PAGE 块（map 行 /
 * tools 行 / 说明行）、页面挂载的工具与单会话技能、宿主追加的 TASK 块文本。
 * 三层判定见 lib/model-surface/verdict.mjs：
 * ① 注册表层：每个 PAGE 块 map 的 URL 模板可达真实页面；每个注册页面要么出现
 *    在兄弟页 map、要么在豁免清单（豁免须注释理由）；
 * ② 承诺层：手写文本点名的工具/技能必须真实挂载（"承诺=挂载"，路由句按路由
 *    真伪判定），宿主 TASK 块文本对每页核对；
 * ③ 预算层：PAGE 块骨架与工具描述的字符上限（防膨胀棘轮，超限先改文案再提上限）。
 * 有效性基线：对照官方参照 deepseek/dsh-superagent/tests/model-surface.spec.ts
 * （MIT，学思路不 vendor）。
 * The model-surface gate (S2): exhaustive regression over everything the model
 * reads — app-page PAGE blocks (map / tools / note lines), the tools and
 * single-session skills each page mounts, and the host-appended TASK-block
 * text. Three layers (see lib/model-surface/verdict.mjs): (1) registry — every
 * map url template reaches a real page; every registered page appears in a
 * sibling map or the exempt list (exemptions carry reasons); (2) promise —
 * tools/skills named in hand-written text must be really mounted ("promise =
 * mount"; routing sentences are judged by routing truth), the host TASK-block
 * text is checked against every page; (3) budgets — character caps for the
 * PAGE-block skeleton and tool descriptions (an anti-inflation ratchet).
 * Validity baseline: the official reference
 * deepseek/dsh-superagent/tests/model-surface.spec.ts (MIT; ideas, not vendored).
 *
 * 用法 / usage:
 *   node scripts/check-model-surface.mjs            # 漂移即非零退出 / nonzero exit on drift
 *   node scripts/check-model-surface.mjs --report   # 逐页清单与判定 / per-page faces and verdicts
 *
 * @module scripts/check-model-surface
 */
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildModelSurface, normalizeMounts } from './lib/model-surface/surface.mjs'
import { checkRegistry, checkPromises, checkBudgets } from './lib/model-surface/verdict.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * 尺寸预算（字符）：按 2026-11-01 全仓基线 × ~1.05 拨定（基线实测：页面描述
 * 80 / 页面说明 978 / 应用说明 2090 / 工具描述 966 / 契约字段 112 / PAGE 块
 * 骨架 4096）——把文案写短之后应同步下调，上限只许有意上调并在提交信息说明。
 * Size budgets (characters): pinned at ~1.05× the 2026-11-01 measured baselines
 * (page description 80 / page instructions 978 / app instructions 2090 / tool
 * description 966 / contract fields 112 / PAGE-block skeleton 4096) — lower
 * them when copy shrinks; raise only intentionally, explained in the commit.
 */
export const BUDGETS = {
  pageDescription: 90,
  pageInstructions: 1030,
  appInstructions: 2200,
  toolDescription: 1020,
  unattendedField: 120,
  pageBlockSkeleton: 4300,
}

/**
 * 层①豁免清单：不出现在任何兄弟页 map 的注册页面（单页应用等），须注释理由。
 * Layer-1 exemptions: registered pages that no sibling map names (single-page
 * apps and the like); a reason comment is required.
 */
const PAGE_MAP_EXEMPT = new Map([
  // （空）当前五应用都 ≥2 页，每页都出现在兄弟页 map 里
  // (empty) all five apps currently have ≥2 pages, so every page maps somewhere
])

/**
 * 在案漂移台账（学官方 KNOWN_FAILURES：留空是理想态）。前缀匹配漂移 key；
 * 每条给 owner 与理由；漂移修掉后行必须删除，否则门禁报"已修复请删行"。
 * The known-drifts ledger (modeled on the official KNOWN_FAILURES: empty is the
 * ideal). Keys match by prefix; each entry carries an owner and a reason; once
 * a drift is fixed the row must be deleted or the gate reports "fixed: drop it".
 */
const KNOWN_DRIFTS = [
  {
    owner: 'page-registry/page-block.ts (taskBlock)',
    key: 'host-text:task_complete@',
    reason: 'TASK 块文本指名 task_complete/task_fail，但 task-workbench 与 sub2api/person-agent 的页面挂自己的 complete/abandon 面'
      + '（docs/unattended-page-contract.cn.md §5 行 17 在案）——等宿主 TASK 块文案与页面词汇统一后删行',
  },
  { owner: 'page-registry/page-block.ts (taskBlock)', key: 'host-text:task_fail@', reason: '同上 / same as task_complete' },
  {
    owner: 'sub2api-admin (page-home 指引段)',
    key: 'promise@sub2api-admin/home:redeem_codes',
    reason: '首页"常见操作"摘要句裸名 redeem_codes/promo_codes 未带页面 URL——上层 URL 表已给出路由；摘要句补页名后删行',
  },
  { owner: 'sub2api-admin (page-home 指引段)', key: 'promise@sub2api-admin/home:promo_codes', reason: '同上 / same as redeem_codes' },
  {
    owner: 'task-workbench (page-list 契约 escape)',
    key: 'promise@task-workbench/list:abandon_task',
    reason: '列表页契约 escape 点名 abandon_task（挂载在详情页）——首份门禁报告抓到的真漂移；修复方向：escape 改指详情页或由列表页挂载，修后删行',
  },
  {
    owner: 'task-workbench (page-publish 说明)',
    key: 'promise@task-workbench/publish:drive_begin',
    reason: '发布页说明"browse 先 drive_begin"但本页只挂 publish_task（drive 两件在列表/详情页）——首份门禁报告抓到的真漂移；修复方向：改写为"在队列/详情页先 drive_begin"，修后删行',
  },
]

/** 跑一次全仓判定 / run the whole workspace verdict once */
export async function auditSurface(root = ROOT) {
  const surface = await buildModelSurface(root)
  const drifts = normalizeMounts(surface)
  drifts.push(...checkRegistry(surface, PAGE_MAP_EXEMPT))
  drifts.push(...checkPromises(surface))
  const { drifts: budgetDrifts, measures } = checkBudgets(surface, BUDGETS)
  drifts.push(...budgetDrifts)
  return { surface, drifts, measures }
}

/** 漂移分诊：已知（在案）与新增 / triage drifts into known (ledgered) and new */
export function triage(drifts) {
  const known = []
  const fresh = []
  for (const drift of drifts) {
    const hit = KNOWN_DRIFTS.find((entry) => drift.key.startsWith(entry.key))
    ;(hit === undefined ? fresh : known).push({ ...drift, owner: hit?.owner })
  }
  const stale = KNOWN_DRIFTS.filter((entry) => !drifts.some((drift) => drift.key.startsWith(entry.key)))
  return { known, fresh, stale }
}

/** 逐页报告 / the per-page report */
function printReport(surface, measures) {
  for (const app of surface.apps.values()) {
    console.log(`\n== app ${app.id} (prefix ${app.toolPrefix}, entry ${app.entry ?? '—'}) ==`)
    for (const page of surface.pages.filter((candidate) => candidate.appId === app.id)) {
      printPage(surface, page, measures.get(page.key))
    }
  }
  console.log(`\n== host text (${surface.hostTexts.length} fragments) ==`)
  for (const text of surface.hostTexts) console.log(`  - ${text.replaceAll('\n', ' ⏎ ').slice(0, 120)}`)
}

/** 单页面清单 / one page's face list */
function printPage(surface, page, measure) {
  const siblings = surface.pages.filter((candidate) => candidate.appId === page.appId && candidate !== page)
  console.log(`\n  page ${page.key}  (${siblings.length} map rows)`)
  console.log(`    url: ${page.url}`)
  console.log(`    tools (${page.mountedFull.length}): ${page.mountedFull.join(', ') || '—'}`)
  console.log(`    skills (${page.mounts.skills.length}): ${page.mounts.skills.join(', ') || '—'}`)
  console.log(`    skeleton=${measure?.total} chars (map ${measure?.map} / tools ${measure?.tools} / notes ${measure?.notes} / body ${measure?.body}); desc ${page.description.length}; instructions ${page.instructions.length}`)
}

/** 主入口：报告或按漂移定退出码 / main entry: report or exit-code by drifts */
async function main() {
  const { surface, drifts, measures } = await auditSurface()
  const { known, fresh, stale } = triage(drifts)
  if (process.argv.includes('--report')) printReport(surface, measures)
  for (const drift of known) console.log(`KNOWN  ${drift.key}: ${drift.message}  [${drift.owner}]`)
  for (const drift of fresh) console.error(`DRIFT  ${drift.key}: ${drift.message}`)
  for (const entry of stale) console.error(`FIXED  ${entry.key} no longer fires — drop it from KNOWN_DRIFTS  [${entry.owner}]`)
  if (fresh.length > 0 || stale.length > 0) process.exitCode = 1
  else if (!process.argv.includes('--report')) {
    console.log(`check-model-surface: ${surface.pages.length} pages audited, ${known.length} known drift(s) ledgered, 0 new / 已审计 ${surface.pages.length} 页`)
  }
}

// 仅在直接执行时跑扫描（被自测 import 时不执行）
// Run only when executed directly (not when imported by the self-test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
