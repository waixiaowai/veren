/**
 * 模型面装配：把提取库拼成"一仓一照"的快照——应用、页面（meta 文本 + 组件体 +
 * 挂载工具/技能）、工具目录、本地说集合、全名宇宙、宿主追加文本。判定层
 * （verdict）只读这份快照；快照里的 unresolved 记录原样上浮。
 * The model-surface assembly: composes the extraction libraries into one
 * workspace snapshot — apps, pages (meta text + body + mounted tools/skills),
 * the tool catalog, per-app local sets, the full-name universe, and the
 * host-appended text. The verdict layer only reads this snapshot; unresolved
 * records surface verbatim.
 * @module scripts/lib/model-surface/surface
 */
import ts from 'typescript'
import { stringValue, collectText } from './strings.mjs'
import { collectBindingNames, collectBuilderNames, collectToolCatalog } from './tools.mjs'
import { collectAppDefinitions, collectRegistrations } from './apps.mjs'
import { collectHostTexts, metaValue, resolveComponent, resolveMeta } from './components.mjs'
import { collectSkillDeclarations, collectSkillLoaders } from './skills.mjs'
import { collectMounts } from './mounts.mjs'
import { loadWorld } from './world.mjs'

/**
 * 页面快照 / one page's snapshot
 * @typedef {object} PageFace
 * @property {string} appId 所属应用 / owning app id
 * @property {string} key 全局页键 <appId>/<name> / the global page key
 * @property {string} name 页面本地名 / the page's local name
 * @property {string} url URL 模板 / the url template
 * @property {string} description 页面描述 / the page description
 * @property {string} instructions 页面说明 / the page instructions
 * @property {Record<string, string>} unattended 无人值守契约字段 / the unattended contract fields
 * @property {string[]} bodyText 组件体手写文本 / the body's hand-written text
 * @property {string[]} urlTexts 组件体里可解析的 /apps/ URL 模板 / resolvable /apps/ urls in the body
 * @property {{tools: string[], skills: string[]}} mounts 原始挂载名 / raw mounted names
 * @property {Array<{where: string, reason: string}>} unresolved 挂载解析的未决项 / unresolved mount sites
 * @property {string[]} mountedFull 归一后的全名挂载集 / the normalized full-name mount set
 * @property {string[]} mountedLocals 挂载集的本地名 / the mount set's local names
 * @property {string} file 声明文件 / the declaring file
 */

/**
 * 装配整仓模型面快照。
 * Assemble the whole workspace's model-surface snapshot.
 * @param {string} root - workspace root / 工作区根
 * @returns {Promise<object>} the snapshot / 快照
 */
export async function buildModelSurface(root) {
  const world = await loadWorld(root)
  const { catalog, parametric } = collectToolCatalog(world)
  const bindings = collectBindingNames(world)
  const builders = collectBuilderNames(world, parametric)
  const apps = collectAppDefinitions(world)
  const skillDecls = await collectSkillDeclarations(root, world.packages)
  const loaders = collectSkillLoaders(world)
  const appOfPath = appPackageOf(apps)
  const pages = collectPages(world, apps, { catalog, bindings, builders, loaders, skillDecls })
  const localsByApp = localsOf(pages, apps, catalog, bindings, appOfPath)
  return {
    world, catalog, apps, pages, localsByApp, appOfPath,
    universeFull: universeOf(catalog, apps, localsByApp),
    hostTexts: collectHostTexts(world),
    bindings, skillDecls,
  }
}

/** 应用 id → 包目录名 / app id → its package directory name */
function appPackageOf(apps) {
  const map = new Map()
  for (const app of apps.values()) {
    const match = /plugins[/\\]([^/\\]+)[/\\]src/.exec(app.file.replaceAll('\\', '/'))
    if (match !== null) map.set(app.id, match[1])
  }
  return map
}

/** 提取全部页面（注册行 → 组件与 meta 解析 → 挂载）/ collect every page (registration → component/meta resolution → mounts) */
function collectPages(world, apps, faces) {
  const pages = []
  for (const registration of collectRegistrations(world)) {
    const app = apps.get(registration.appId)
    if (app === undefined) continue
    const component = resolveComponent(world, registration.path, registration.component)
    const metaResolved = resolveMeta(world, registration.path, registration.meta)
    if (component === undefined || metaResolved === undefined) continue
    pages.push(pageFaceOf(world, registration, app, component, metaResolved, faces))
  }
  return pages
}

/** 一个页面的快照 / one page's snapshot */
function pageFaceOf(world, registration, app, component, metaResolved, faces) {
  const unitPath = metaResolved.file
  const meta = metaResolved.meta
  const name = metaValue(world, unitPath, meta, metaResolved.env, 'name') ?? registration.component
  const mounts = component.body === undefined
    ? { tools: [], skills: [], unresolved: [] }
    : collectMounts(world, component.file, component.body, faces.builders, faces.loaders, faces.skillDecls, component.env)
  const body = component.body
  return {
    appId: app.id,
    key: `${app.id}/${name}`,
    name,
    url: metaValue(world, unitPath, meta, metaResolved.env, 'url') ?? '',
    description: metaValue(world, unitPath, meta, metaResolved.env, 'description') ?? '',
    instructions: metaValue(world, unitPath, meta, metaResolved.env, 'instructions') ?? '',
    unattended: unattendedFields(world, unitPath, meta, metaResolved.env),
    bodyText: body === undefined ? [] : collectText(body),
    urlTexts: body === undefined ? [] : bodyUrls(body, world, component.file),
    mounts: { tools: mounts.tools, skills: mounts.skills },
    unresolved: mounts.unresolved,
    mountedFull: [],
    mountedLocals: [],
    file: component.file,
  }
}

/** 无人值守契约的静态字段 / the unattended contract's static fields */
function unattendedFields(world, unitPath, meta, env) {
  const fields = {}
  for (const prop of ['serves', 'level', 'evidence', 'escape', 'budget']) {
    const value = metaNested(world, unitPath, meta, env, 'unattended', prop)
    if (value !== undefined) fields[prop] = value
  }
  return fields
}

/** 二层属性读取（meta.unattended.<prop>）/ a two-level meta property read */
function metaNested(world, unitPath, meta, env, outer, inner) {
  const object = nestedObject(meta, env, outer)
  return object === undefined ? undefined : metaValue(world, unitPath, object, env, inner)
}

/** 取 meta 的二层对象字面量 / take a meta's nested object literal */
function nestedObject(meta, env, outer) {
  for (const object of [meta, ...env.values()]) {
    if (object === undefined || !ts.isObjectLiteralExpression(object)) continue
    for (const item of object.properties) {
      if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === outer
        && ts.isObjectLiteralExpression(item.initializer)) return item.initializer
    }
  }
  return undefined
}

/** 组件体里可静态求值的 /apps/ URL 模板 / statically evaluable /apps/ urls inside the body */
function bodyUrls(body, world, unitPath) {
  const urls = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const value = stringValue(node, world, unitPath)
      if (value !== undefined && value.includes('/apps/')) urls.push(value)
    }
    node.forEachChild(visit)
  }
  visit(body)
  return [...new Set(urls)]
}

/**
 * 每应用的本地名集合：本包 defineTool 产物 ∪ 绑定表 ∪ 页面挂载的原始名。
 * Per-app local-name sets: the package's own defineTool products ∪ binding
 * tables ∪ the raw names the pages mount.
 */
function localsOf(pages, apps, catalog, bindings, appOfPath) {
  const locals = new Map()
  for (const app of apps.values()) {
    const pkg = appOfPath.get(app.id) ?? ''
    const set = new Set()
    for (const [name, entry] of catalog) {
      if (entry.file.replaceAll('\\', '/').includes(`/plugins/${pkg}/`)) set.add(name)
    }
    for (const [name, file] of bindings) {
      if (file.replaceAll('\\', '/').includes(`/plugins/${pkg}/`)) set.add(name)
    }
    locals.set(app.id, set)
  }
  for (const page of pages) {
    for (const entry of page.mounts.tools) locals.get(page.appId)?.add(entry.name)
  }
  return locals
}

/** 全名宇宙：目录名 ∪ 每应用前缀 × 其本地名 / the full-name universe: catalog names ∪ per-app prefix × locals */
function universeOf(catalog, apps, localsByApp) {
  const universe = new Set(catalog.keys())
  for (const app of apps.values()) {
    for (const local of localsByApp.get(app.id) ?? []) universe.add(`${app.toolPrefix}__${local}`)
  }
  return universe
}

/** 归一各页挂载：原始名 → 全名 + 本地名 / normalize each page's mounts: raw names → full + local names */
export function normalizeMounts(surface) {
  const drifts = []
  for (const page of surface.pages) {
    const app = surface.apps.get(page.appId)
    for (const entry of page.mounts.tools) {
      const full = normalizeEntry(entry, app, surface)
      if (full === null) {
        page.unresolved.push({ where: page.file, reason: `tool name "${entry.name}" matches no catalog entry under ${app?.toolPrefix ?? '?'}` })
        continue
      }
      page.mountedFull.push(full)
      page.mountedLocals.push(full.includes('__') ? full.split('__').slice(1).join('__') : full)
    }
  }
  for (const page of surface.pages) {
    for (const miss of page.unresolved) {
      drifts.push({ key: `mount@${page.key}`, message: `${page.key}: ${miss.reason} (${miss.where})` })
    }
  }
  return drifts
}

/** 挂载项 → 全名：经包装的加应用前缀；宿主裸面（task 三件）保持原样 / a mount entry → full name: wrapped names take the app prefix; unprefixed host faces (the task trio) stay verbatim */
function normalizeEntry(entry, app, surface) {
  const raw = entry.name
  if (raw.includes('__')) return surface.universeFull.has(raw) ? raw : null
  if (surface.catalog.has(raw) && !entry.external) return raw
  if (surface.catalog.has(raw)) return `${app.toolPrefix}__${raw}`
  return null
}
