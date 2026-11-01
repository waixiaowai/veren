/**
 * 三层判定（只读快照，产出结构化漂移）：
 * ① 注册表层：URL 模板形状/唯一性/entry 指向/手写 URL 可达 + 每个注册页面必须
 *   出现在某张 PAGE 块 map 或豁免清单；
 * ② 承诺层：手写文本点名的工具（全名/本地名）必须真实挂载——路由句（带可达
 *   URL 或页名）按路由真伪判定；宿主 TASK 块文本按"每页都须挂载"核对；技能
 *   声明不得死置；
 * ③ 预算层：页面描述/说明/契约字段/工具描述/PAGE 块骨架的字符上限。
 * The three-layer verdict (reads the snapshot only, emits structured drifts):
 * (1) registry: url shapes/uniqueness/entry targets/hand-written url reachability,
 *     and every registered page must appear in some PAGE-block map or the exempt
 *     list; (2) promise: tools named in hand-written text (full/local names) must
 *     be really mounted — routing sentences (a reachable url or a page name) are
 *     judged by routing truth; the host TASK-block text is checked against every
 *     page; skill declarations must not be dead; (3) budgets: character caps for
 *     page descriptions/instructions/contract fields/tool descriptions/the
 *     PAGE-block skeleton.
 * @module scripts/lib/model-surface/verdict
 */
import { FULL_NAME_TOKEN, SNAKE_TOKEN, sentencesOf } from './strings.mjs'

/** URL 字面模式（文本里的 /apps/ 模板）/ the url-literal pattern (an /apps/ template in text) */
const URL_PATTERN = /\/apps\/[a-z0-9-]+(?:\/[a-zA-Z0-9_:-]+)*/g

/** 层①：注册表判定 / layer 1: the registry verdict */
export function checkRegistry(surface, exempts) {
  const drifts = []
  for (const app of surface.apps.values()) {
    const pages = surface.pages.filter((page) => page.appId === app.id)
    for (const page of pages) checkPageUrl(app, page, surface, drifts)
    checkEntry(app, pages, drifts)
    if (pages.length >= 2) continue
    for (const page of pages) {
      if (!exempts.has(page.key)) {
        drifts.push({ key: `map-orphan@${page.key}`, message: `${page.key}: single-page app renders no sibling map; exempt it with a reason or add a sibling` })
      }
    }
  }
  return drifts
}

/** 层①·单页：URL 形状/唯一性/手写 URL 可达 / layer 1, one page: url shape, uniqueness, hand-written url reachability */
function checkPageUrl(app, page, surface, drifts) {
  if (!page.url.startsWith(`/apps/${app.id}/`)) {
    drifts.push({ key: `url-shape@${page.key}`, message: `${page.key}: url "${page.url}" must start with /apps/${app.id}/` })
  }
  const clash = surface.pages.find((other) => other.appId === app.id && other !== page && other.url === page.url)
  if (clash !== undefined) drifts.push({ key: `url-clash@${page.key}`, message: `${page.key}: url duplicates ${clash.key}` })
  for (const written of [...page.urlTexts, ...writtenUrls(page.instructions), ...writtenUrls(app.instructions ?? '')]) {
    const target = matchWrittenUrl(surface, written)
    if (target === null) drifts.push({ key: `url-unregistered@${page.key}`, message: `${page.key}: written url "${written}" matches no registered page` })
  }
}

/** 页面说明文本里的 /apps/ URL / /apps/ urls inside a page's instructions text */
function writtenUrls(text) {
  return [...text.matchAll(URL_PATTERN)].map((match) => match[0])
}

/** 手写 URL → 注册页面模板（:参数 通配）/ a written url → a registered page template (:params wildcarded) */
function matchWrittenUrl(surface, written) {
  const found = surface.pages.find((page) => urlMatches(written, page.url))
  return found === undefined ? null : found.key
}

/** URL 与模板逐段匹配（:x 段通配）/ segment-wise url-template matching (:x segments wildcard) */
export function urlMatches(candidate, template) {
  const parts = candidate.split('/')
  const pattern = template.split('/')
  return parts.length === pattern.length
    && pattern.every((segment, index) => segment.startsWith(':') || segment === parts[index])
}

/** 层①·应用：entry 必须指向已注册页面 / layer 1, app: entry must name a registered page */
function checkEntry(app, pages, drifts) {
  if (app.entry === undefined) return
  if (!pages.some((page) => page.name === app.entry)) {
    drifts.push({ key: `entry@${app.id}`, message: `${app.id}: entry "${app.entry}" is not a registered page` })
  }
}

/** 层②：承诺判定 / layer 2: the promise verdict */
export function checkPromises(surface) {
  const drifts = []
  for (const page of surface.pages) checkPagePromises(surface, page, drifts)
  checkAppPromises(surface, drifts)
  checkHostText(surface, drifts)
  checkDeadSkills(surface, drifts)
  return drifts
}

/** 层②·单页：全名与本地名的承诺核对 / layer 2, one page: full-name and local-name promise checks */
function checkPagePromises(surface, page, drifts) {
  const texts = [page.description, page.instructions, ...Object.values(page.unattended), ...page.bodyText]
  for (const text of texts) {
    for (const token of [...text.matchAll(FULL_NAME_TOKEN)].map((match) => match[0])) {
      if (!page.mountedFull.includes(token)) {
        drifts.push({ key: `promise-full@${page.key}:${token}`, message: `${page.key}: text names "${token}" which is not mounted on this page` })
      }
    }
    checkLocalPromises(surface, page, text, drifts)
  }
}

/** 层②·单页·本地名：句内路由逃逸（可达 URL 真伪 / 页名）后核对挂载 / layer 2, local names: per-sentence routing escapes (url truth / page name) before the mount check */
function checkLocalPromises(surface, page, text, drifts) {
  const locals = surface.localsByApp.get(page.appId) ?? new Set()
  for (const sentence of sentencesOf(text)) {
    for (const token of [...sentence.matchAll(SNAKE_TOKEN)].map((match) => match[0])) {
      if (!locals.has(token) || page.mountedLocals.includes(token)) continue
      const escape = routingEscape(surface, page, sentence, token)
      if (escape !== null) {
        if (escape !== true) {
          drifts.push({ key: `routing-lie@${page.key}:${token}`, message: `${page.key}: routing sentence names "${token}" but its target page does not mount it` })
        }
        continue
      }
      drifts.push({ key: `promise@${page.key}:${token}`, message: `${page.key}: text names "${token}" without mounting it (no routing escape in the sentence)` })
    }
  }
}

/** 路由逃逸：true=放行；字符串=路由撒谎（URL 指向的页面没挂该工具）；null=无逃逸 */
function routingEscape(surface, page, sentence, token) {
  for (const written of writtenUrls(sentence)) {
    const target = matchWrittenUrl(surface, written)
    if (target === null) continue
    if (target === page.key) continue
    const targetPage = surface.pages.find((candidate) => candidate.key === target)
    return targetPage !== undefined && targetPage.mountedLocals.includes(token)
  }
  const app = surface.apps.get(page.appId)
  const names = [...(surface.pages.filter((candidate) => candidate.appId === page.appId)).map((candidate) => candidate.name)]
  if (app?.entry !== undefined) names.push(app.entry)
  return names.some((name) => new RegExp(`\\b${name}\\b`).test(sentence)) ? true : null
}

/** 层②·应用说明：点名必须落在应用挂载并集 / layer 2, app note: named tools must fall in the app's mounted union */
function checkAppPromises(surface, drifts) {
  for (const app of surface.apps.values()) {
    const pages = surface.pages.filter((page) => page.appId === app.id)
    const unionFull = new Set(pages.flatMap((page) => page.mountedFull))
    const unionLocals = new Set(pages.flatMap((page) => page.mountedLocals))
    const locals = surface.localsByApp.get(app.id) ?? new Set()
    for (const token of [...(app.instructions ?? '').matchAll(FULL_NAME_TOKEN)].map((match) => match[0])) {
      if (!unionFull.has(token)) drifts.push({ key: `promise-full@${app.id}`, message: `${app.id}: app note names "${token}" which no page mounts` })
    }
    for (const token of [...(app.instructions ?? '').matchAll(SNAKE_TOKEN)].map((match) => match[0])) {
      if (locals.has(token) && !unionLocals.has(token)) {
        drifts.push({ key: `promise@${app.id}:${token}`, message: `${app.id}: app note names "${token}" which no page mounts` })
      }
    }
  }
}

/** 层②·宿主文本：TASK 块点名的工具按"每页都须挂载"核对 / layer 2, host text: the TASK block's tools must be mounted on every page */
function checkHostText(surface, drifts) {
  const allLocals = new Set(surface.catalog.keys())
  for (const text of surface.hostTexts) {
    for (const token of [...text.matchAll(SNAKE_TOKEN)].map((match) => match[0])) {
      if (!allLocals.has(token)) continue
      for (const page of surface.pages) {
        if (!page.mountedLocals.includes(token)) {
          drifts.push({ key: `host-text:${token}@${page.key}`, message: `${page.key}: host task-block text names "${token}" which this page does not mount` })
        }
      }
    }
  }
}

/** 层②·技能：页面作用域的声明不得死置（宿主/预置挂载的技能不归本门禁）/ layer 2, skills: page-scoped declarations must not be dead (host/preset-mounted skills are out of scope) */
function checkDeadSkills(surface, drifts) {
  const mounted = new Set(surface.pages.flatMap((page) => page.mounts.skills))
  const pagePkgs = new Set(surface.pages.map((page) => surface.appOfPath.get(page.appId)).filter(Boolean))
  for (const [dir, info] of surface.skillDecls) {
    if (!pagePkgs.has(info.pkg)) continue
    if (!mounted.has(info.name)) {
      drifts.push({ key: `dead-skill:${dir}`, message: `skill "${info.name}" (${info.pkg}) is declared but mounted on no page` })
    }
  }
}

/** 层③：预算判定；返回逐页度量供报告 / layer 3: budgets; returns per-page measures for the report */
export function checkBudgets(surface, budgets) {
  const drifts = []
  const measures = new Map()
  for (const page of surface.pages) {
    const skeleton = blockSkeleton(surface, page)
    measures.set(page.key, skeleton)
    pushBudget(drifts, `budget:description@${page.key}`, page.description.length, budgets.pageDescription, 'page description')
    pushBudget(drifts, `budget:instructions@${page.key}`, page.instructions.length, budgets.pageInstructions, 'page instructions')
    for (const [field, value] of Object.entries(page.unattended)) {
      pushBudget(drifts, `budget:unattended.${field}@${page.key}`, value.length, budgets.unattendedField, `unattended.${field}`)
    }
    pushBudget(drifts, `budget:block@${page.key}`, skeleton.total, budgets.pageBlockSkeleton, 'PAGE-block skeleton')
  }
  for (const app of surface.apps.values()) {
    pushBudget(drifts, `budget:app-instructions@${app.id}`, (app.instructions ?? '').length, budgets.appInstructions, 'app instructions')
  }
  for (const [name, entry] of surface.catalog) {
    if (entry.description !== undefined) pushBudget(drifts, `budget:tool-desc:${name}`, entry.description.length, budgets.toolDescription, `tool ${name} description`)
  }
  return { drifts, measures }
}

/** 记一条预算超标 / record one budget breach */
function pushBudget(drifts, key, actual, cap, label) {
  if (actual > cap) drifts.push({ key, message: `${key}: ${label} spans ${actual} chars (> ${cap})` })
}

/** PAGE 块骨架的静态上界（定位行 + map 行 + tools 行 + 说明行 + 正文静态文本）/ the PAGE block's static upper bound (locator + map rows + tools line + notes + body static text) */
function blockSkeleton(surface, page) {
  const app = surface.apps.get(page.appId)
  const siblings = surface.pages.filter((candidate) => candidate.appId === page.appId && candidate !== page)
  const locator = `PAGE ${page.key} ${page.url}`
  const mapRows = siblings.map((sibling) => `- ${sibling.url} → ${sibling.description}`)
  const toolsLine = `tools: ${page.mountedFull.map((name) => `${name}（${usagePhrase(surface, name)}）`).join('、')}`
  const notes = [`应用说明：${app?.instructions ?? ''}`, `说明：${page.instructions}`]
  const parts = [locator, ...mapRows, toolsLine, ...notes, ...page.bodyText]
  return {
    locator: locator.length,
    map: mapRows.reduce((sum, row) => sum + row.length, 0),
    tools: toolsLine.length,
    notes: notes.reduce((sum, row) => sum + row.length, 0),
    body: page.bodyText.reduce((sum, row) => sum + row.length, 0),
    total: parts.reduce((sum, row) => sum + row.length, 0),
  }
}

/** 工具用途短语（镜像 page-block 的 toolUsagePhrase：description 首句 ≤60 字）/ a tool's usage phrase (mirrors page-block's toolUsagePhrase) */
function usagePhrase(surface, fullName) {
  const local = fullName.split('__').pop() ?? fullName
  const description = surface.catalog.get(local)?.description ?? surface.catalog.get(fullName)?.description ?? ''
  const sentence = description.split('。')[0] ?? description
  const fallback = sentence.length >= 4 ? sentence : (description.split('. ')[0] ?? description)
  return fallback.length > 60 ? `${fallback.slice(0, 59)}…` : fallback
}
