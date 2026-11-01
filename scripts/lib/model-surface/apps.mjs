/**
 * 应用与页面声明提取：ApplicationDefinition（应用 id/entry/toolPrefix/应用级
 * 说明）、pages.register(Component, Meta) 注册点（appId 归属）、页面组件与
 * meta 的解析（含工厂产物 `export const X = factory({...}).Page` 形态）、宿主
 * 追加文本（taskBlock）。这是模型面"声明处"的穷举层。
 * App and page declaration extraction: ApplicationDefinition (id / entry /
 * toolPrefix / app-level note), the pages.register(Component, Meta) sites
 * (with appId attribution), page component and meta resolution (including the
 * factory-product `export const X = factory({...}).Page` shape), and the
 * host-appended text (taskBlock). This is the exhaustive declaration layer of
 * the model surface.
 * @module scripts/lib/model-surface/apps
 */
import ts from 'typescript'
import { unwrapAs } from './helpers.mjs'
import { stringValue } from './strings.mjs'
import { declarationOf } from './world.mjs'

/**
 * 页面组件/meta 的解析结果 / a page component's resolved face
 * @typedef {object} PageComponent
 * @property {ts.ObjectLiteralExpression|undefined} meta meta 声明节点（含工厂内）/ the meta node (possibly inside a factory)
 * @property {Map<string, ts.Node>} env meta 属性的环境绑定（工厂参数 → 实参对象）/ env for meta properties
 * @property {ts.Node|undefined} body 组件体函数节点 / the body function node
 */

/**
 * 应用定义面 / one app's definition face
 * @typedef {object} AppDef
 * @property {string} id 应用 id / the app id
 * @property {string|undefined} entry 入口页键 / the entry page key
 * @property {string} toolPrefix 工具前缀 / the tool prefix
 * @property {string|undefined} instructions 应用级说明 / the app-level note
 * @property {string} file 声明文件 / the declaring file
 */

/**
 * 收集应用定义：类型标注 ApplicationDefinition 的顶层常量。
 * Collect app definitions: top-level constants annotated ApplicationDefinition.
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @returns {Map<string, AppDef>} appId → definition / 应用 id → 定义
 */
export function collectAppDefinitions(world) {
  const apps = new Map()
  for (const [path, unit] of world.units) {
    for (const declaration of unit.declarations.values()) {
      if (!isTyped(declaration, 'ApplicationDefinition')) continue
      recordApp(apps, world, path, declaration)
    }
  }
  return apps
}

/** 记录一个应用定义 / record one app definition */
function recordApp(apps, world, path, declaration) {
  const object = declaration.initializer
  if (object === undefined || !ts.isObjectLiteralExpression(object)) return
  const id = objectValue(world, path, object, 'id')
  if (id === undefined) return
  const prefix = objectValue(world, path, object, 'toolPrefix') ?? id.replace(/-/g, '_')
  apps.set(id, {
    id,
    entry: objectValue(world, path, object, 'entry'),
    toolPrefix: prefix,
    instructions: objectValue(world, path, object, 'instructions'),
    file: path,
  })
}

/** 读应用定义对象的一个静态属性 / read one static property of an app-definition object */
function objectValue(world, path, object, prop) {
  for (const item of object.properties) {
    if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === prop) {
      return stringValue(item.initializer, world, path)
    }
  }
  return undefined
}

/** 类型标注是否为某名（剥 as 表达式与泛型实参）/ whether a type annotation names X (as-expressions and generics stripped) */
export function isTyped(declaration, typeName) {
  const type = declaration.type
  return type !== undefined && ts.isTypeReferenceNode(type)
    && (type.typeName.kind === ts.SyntaxKind.Identifier) && type.typeName.text === typeName
}

/**
 * 收集页面注册：`const pages = X.apps.pages(<id>, ctx)` 之后的
 * `pages.register(<Component>, <Meta>)`。
 * Collect page registrations: `pages.register(<Component>, <Meta>)` calls on a
 * variable initialized from `X.apps.pages(<id>, ctx)`.
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @returns {Array<{ appId: string, path: string, component: string, meta: string }>} registrations / 注册行
 */
export function collectRegistrations(world) {
  const registrations = []
  for (const [path, unit] of world.units) {
    const pageVars = pageRegistryVars(unit)
    if (pageVars.size === 0) continue
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'register' && ts.isIdentifier(node.expression.expression)
        && pageVars.has(node.expression.expression.text)) {
        recordRegistration(world, registrations, path, node)
      }
      node.forEachChild(visit)
    }
    visit(unit.sourceFile)
  }
  return registrations
}

/** 初始化自 `*.apps.pages(...)` 的变量名 / variable names initialized from `*.apps.pages(...)` */
function pageRegistryVars(unit) {
  const names = new Set()
  for (const declaration of unit.allVars.values()) {
    const init = unwrapAs(declaration.initializer)
    if (init === undefined || !ts.isCallExpression(init)) continue
    const callee = init.expression
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'pages'
      && /apps$/.test(callee.expression.getText(unit.sourceFile))) {
      names.add(declaration.name.text)
    }
  }
  return names
}

/** 记录一行注册（appId + 组件/meta 名）/ record one registration row */
function recordRegistration(world, registrations, path, call) {
  const appId = readAppId(world, path, call)
  const component = argumentName(call.arguments[0])
  const meta = argumentName(call.arguments[1])
  if (appId === undefined || component === undefined || meta === undefined) return
  registrations.push({ appId, path, component, meta })
}

/** 注册调用的 appId 实参（从所属 pages(id, ctx) 调用取）/ the registration's appId argument */
function readAppId(world, path, call) {
  const owner = world.units.get(path)?.allVars.get(call.expression.expression.text)
  const init = unwrapAs(owner?.initializer)
  if (init === undefined || !ts.isCallExpression(init) || init.arguments.length === 0) return undefined
  return stringValue(init.arguments[0], world, path)
}

/** 实参的标识符名 / an argument's identifier name */
function argumentName(arg) {
  return arg !== undefined && ts.isIdentifier(arg) ? arg.text : undefined
}
