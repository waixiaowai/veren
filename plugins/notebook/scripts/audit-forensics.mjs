/**
 * Deterministic readout for the notebook forensic audit
 * (docs/notebook-audit-forensic.cn.md §2 — the frozen criteria live there).
 *
 * Eats the storage raw rows and the extracted event table, emits one JSON
 * readout: card classification, flywheel funnel, survivorship, refusal
 * histogram, and the pre-registered predictions as PASS/FAIL. Reruns with the
 * same inputs reproduce identical numbers ("now" is derived from the data).
 *
 * notebook 取证审计的确定性读数器（冻结判据见
 * docs/notebook-audit-forensic.cn.md §2）。
 *
 * 吃存储原始行与提取出的事件表，产出一份 JSON 读数：卡片分类、飞轮漏斗、
 * 幸存率、拒绝直方图，以及预注册预测的 PASS/FAIL。相同输入重跑得到相同数字
 * （"现在"由数据本身推导）。
 *
 * Usage: node audit-forensics.mjs <notebookJson> <eventsJson> <outJson>
 *
 * @module scripts/audit-forensics
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** Frozen residue rule (§2.1): title ∪ body match → R. 冻结的残渣规则（§2.1）。 */
const RESIDUE = /(验收|回归|验证|探针|rc\d|probe|verify|smoke)/i
/** Frozen title-metadata rule (§2.2). 冻结的标题夹带元数据规则（§2.2）。 */
const TITLE_META = /[0-9]{2,}|%|[0-9]{4}[-年]|[0-9]+\.[0-9]/
/** Refusal message classes (logs predate structured codes). 拒绝消息分类（日志早于结构化 code）。 */
const REFUSALS = [
  ['note-not-found', /no note with id/],
  ['link-unresolved', /link targets have no card/],
  ['unknown-tool', /unknown tool/],
  ['other', /./],
]

/**
 * Classify one card by the frozen rules.
 * @param {object} record - a stored NoteRecord row.
 * @returns {object} classification fields for the readout.
 */
function classifyCard(record) {
  const haystack = `${record.title}\n${record.body}`
  const kindClass = RESIDUE.test(haystack) ? 'R' : 'T'
  return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, kindClass, titleMeta: TITLE_META.test(record.title) }
}

/**
 * Build per-card link degrees and the orphan list from the cached link rows.
 * @param {object[]} records - stored note rows.
 * @param {object[]} links - cached link rows.
 * @returns {object} out/in degree maps, orphan titles, unresolved count.
 */
function linkGraph(records, links) {
  const titles = new Set(records.map(record => record.title))
  const out = new Map(), inDeg = new Map()
  let unresolved = 0
  for (const link of links) {
    if (!titles.has(link.targetTitle)) unresolved += 1
    out.set(link.sourceId, (out.get(link.sourceId) ?? 0) + 1)
    inDeg.set(link.targetTitle, (inDeg.get(link.targetTitle) ?? 0) + 1)
  }
  const orphans = records.filter(record => !(out.get(record.id) ?? 0) && !(inDeg.get(record.title) ?? 0)).map(record => record.title)
  return { out, inDeg, orphans, unresolved }
}

/**
 * Collect ids minted by successful write/capture calls (F1 and survivorship).
 * @param {object[]} rows - reduced session rows.
 * @returns {{createdIds: Map<string, string>, createdEvents: number}} id → session id.
 */
function createdCards(rows) {
  const createdIds = new Map()
  let createdEvents = 0
  for (const row of rows) for (const call of row.calls) {
    if (!/write_note|capture_note/.test(call.tool)) continue
    const result = row.results.find(candidate => candidate.callId === call.callId)
    if (!result || result.isError) continue
    createdEvents += 1
    const minted = result.text.match(/"note":\{"id":"([0-9a-f-]{36})"/)
    if (minted) createdIds.set(minted[1], row.session?.id ?? row.file)
  }
  return { createdIds, createdEvents }
}

/**
 * Count per-card touches (call args or result text mentions the card id).
 * @param {object[]} rows - reduced session rows.
 * @param {Iterable<string>} ids - card ids to watch (live + deleted).
 * @returns {Map<string, number[]>} id → touch times.
 */
function touchesOf(rows, ids) {
  const touches = new Map([...ids].map(id => [id, []]))
  for (const row of rows) for (const call of row.calls) {
    const result = row.results.find(candidate => candidate.callId === call.callId)
    const blob = `${JSON.stringify(call.args ?? '')}\n${result?.text ?? ''}`
    if (!/write_note|capture_note/.test(call.tool)) {
      for (const id of ids) if (blob.includes(id)) touches.get(id)?.push(call.time)
    }
  }
  return touches
}

/**
 * Compute the pre-registered funnel F1-F5 on the joined evidence.
 * @param {object} ctx - cards, records, links, out/in degrees, createdIds, touches.
 * @returns {object} funnel stage populations and members.
 */
function funnel(ctx) {
  const { cards, records, links, out, inDeg, createdIds, touches } = ctx
  const createdAtOf = new Map(records.map(record => [record.id, record.createdAt]))
  const titleToId = new Map(records.map(record => [record.title, record.id]))
  const linked = cards
    .filter(card => (out.get(card.id) ?? 0) > 0 || (inDeg.get(card.title) ?? 0) > 0)
    .map(card => card.id)
  const f2 = [], f4 = []
  for (const card of cards) {
    const times = touches.get(card.id) ?? []
    if (times.length > 0) f2.push(card.id)
    if (times.some(time => time - Date.parse(card.createdAt) >= 7 * 86_400_000)) f4.push(card.id)
  }
  // F5: a card is compounded when a YOUNGER card links to it. F5：被更晚创建的卡链到即复利。
  const f5 = new Set()
  for (const link of links) {
    const sourceAt = createdAtOf.get(link.sourceId)
    const targetId = titleToId.get(link.targetTitle)
    const targetAt = targetId === undefined ? undefined : createdAtOf.get(targetId)
    if (sourceAt && targetAt && Date.parse(sourceAt) > Date.parse(targetAt)) f5.add(targetId)
  }
  return { F1: createdIds.size, F2: f2, F3: linked, F4: f4, F5: [...f5] }
}

/**
 * Recompute the stale view (H-B): no inbound links and older than 7 days.
 * @param {object[]} records - stored rows, newest-last unsorted.
 * @param {Map<string, number>} inDeg - inbound degree by title.
 * @param {number} now - deterministic epoch derived from the data.
 * @returns {string[]} stale card titles.
 */
function recomputeStale(records, inDeg, now) {
  return records
    .filter(record => !(inDeg.get(record.title) ?? 0) && now - Date.parse(record.updatedAt) > 7 * 86_400_000)
    .map(record => record.title)
}

/**
 * Assemble the full readout: classification, funnel, survivorship, refusals,
 * and the frozen predictions as PASS/FAIL.
 * @param {object} storage - parsed notebook.json.
 * @param {object} events - parsed events.json.
 * @returns {object} the audit readout.
 */
function readout(storage, events) {
  const records = Object.values(storage.tables.notes)
  const links = Object.values(storage.tables.links)
  const cards = records.map(classifyCard)
  const graph = linkGraph(records, links)
  const { createdIds, createdEvents } = createdCards(events.rows)
  const touches = touchesOf(events.rows, [...new Set([...createdIds.keys(), ...records.map(record => record.id)])])
  const trueCards = cards.filter(card => card.kindClass === 'T')
  const refusals = {}
  let refusalCount = 0
  for (const row of events.rows) for (const result of row.results) {
    if (!result.isError) continue
    refusalCount += 1
    const hit = REFUSALS.find(([, pattern]) => pattern.test(result.text))
    refusals[hit[0]] = (refusals[hit[0]] ?? 0) + 1
  }
  const now = Math.max(...records.map(record => Date.parse(record.updatedAt)))
  // The frozen P3 text did not pin the counting rule; report all three readings.
  // 冻结的 P3 未钉死计数口径；三种读法都报。
  const trueIds = new Set(trueCards.map(card => card.id))
  const trueTitles = new Set(trueCards.map(card => card.title))
  const touchingT = links.filter(link => trueIds.has(link.sourceId) || trueTitles.has(link.targetTitle)).length
  const outT = links.filter(link => trueIds.has(link.sourceId)).length
  const densityVariants = {
    allLinksPerTrue: +(links.length / Math.max(1, trueCards.length)).toFixed(2),
    touchingPerTrue: +(touchingT / Math.max(1, trueCards.length)).toFixed(2),
    outPerTrue: +(outT / Math.max(1, trueCards.length)).toFixed(2),
  }
  // Title-anchored variant of the residue rule — a recommendation only, the
  // frozen title∪body rule stands in the verdict table.
  // 标题锚定变体——仅作建议；裁决表仍用冻结的 title∪body 规则。
  const titleOnlyResidue = records.filter(record => RESIDUE.test(record.title)).length
  const funnelData = funnel({ cards, records, links, out: graph.out, inDeg: graph.inDeg, createdIds, touches })
  const survivors = records.filter(record => createdIds.has(record.id)).length
  return {
    now: new Date(now).toISOString(),
    cards, cardCount: records.length, linkRows: links.length,
    density: { overall: +(links.length / Math.max(1, records.length)).toFixed(2), trueCards: densityVariants.allLinksPerTrue },
    densityVariants, titleOnlyResidue,
    orphans: graph.orphans, unresolvedLinks: graph.unresolved,
    funnel: funnelData,
    survivorship: { createdEvents, mintedIds: createdIds.size, finalRows: records.length, missing: [...createdIds.keys()].filter(id => !records.some(record => record.id === id)) },
    refusals: { total: refusalCount, classes: refusals },
    staleRecompute: recomputeStale(records, graph.inDeg, now),
    predictions: {
      P1: { claim: 'true-card title-metadata share < 1/3', share: +(trueCards.filter(card => card.titleMeta).length / Math.max(1, trueCards.length)).toFixed(2), pass: trueCards.filter(card => card.titleMeta).length / Math.max(1, trueCards.length) < 1 / 3 },
      P2: { claim: 'F5/F1 >= 1/3', ratio: +(funnelData.F5.length / Math.max(1, funnelData.F1)).toFixed(2), pass: funnelData.F5.length / Math.max(1, funnelData.F1) >= 1 / 3 },
      P3: { claim: 'true-card density >= 1.0 (baseline-matched = out-links; all readings reported)', density: densityVariants, pass: densityVariants.outPerTrue >= 1.0 },
      P4: { claim: '>=1 notebook refusal in logs', refusals: refusalCount, pass: refusalCount > 0 },
      P5: { claim: 'survivorship < 100%', minted: createdIds.size, final: records.length, pass: createdIds.size > records.length },
    },
  }
}

const [, , notebookJson, eventsJson, outJson] = process.argv
if (!notebookJson || !eventsJson || !outJson) {
  console.error('usage: node audit-forensics.mjs <notebookJson> <eventsJson> <outJson>')
  process.exit(2)
}
const read = JSON.parse(readFileSync(notebookJson, 'utf8'))
const events = JSON.parse(readFileSync(eventsJson, 'utf8'))
const result = readout(read, events)
writeFileSync(outJson, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result.predictions, null, 2))
console.log(`density: ${JSON.stringify(result.density)} | funnel F1=${result.funnel.F1} F2=${result.funnel.F2.length} F3=${result.funnel.F3.length} F4=${result.funnel.F4.length} F5=${result.funnel.F5.length} | orphans=${result.orphans.length}`)
