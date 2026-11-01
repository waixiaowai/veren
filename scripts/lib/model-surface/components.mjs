/**
 * 页面组件与 meta 的解析：直接 PageFC 箭头、工厂产物（`export const X =
 * factory({...}).Page` 形态，工厂形参 → 实参对象的环境绑定）与 meta 属性的
 * env 感知读取。挂载解析与声明提取共用的寻址层。
 * Page component and meta resolution: direct PageFC arrows, factory products
 * (the `export const X = factory({...}).Page` shape, with the factory
 * parameter → argument object env binding) and env-aware meta property reads.
 * The addressing layer shared by mount resolution and declaration extraction.
 * @module scripts/lib/model-surface/components
 */
import ts from 'typescript'
import { functionOf, unwrapAs } from './helpers.mjs'
import { stringValue } from './strings.mjs'
import { declarationOf } from './world.mjs'
import { isTyped } from './apps.mjs'

/**
 * 解析一个页面导出：直接 `PageFC` 箭头或工厂产物 `X = factory({...}).Page`。
 * Resolve one page export: either a direct PageFC arrow or the factory product
 * `X = factory({...}).Page`.
 * @returns {PageComponent|undefined} the resolved face / 解析结果
 */
export function resolveComponent(world, unitPath, name) {
  const found = declarationOf(world, unitPath, name)
  if (found === undefined || !ts.isVariableDeclaration(found.node)) return undefined
  const home = found.unit.path
  const init = unwrapAs(found.node.initializer)
  if (init === undefined) return undefined
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return { meta: undefined, env: new Map(), body: init, file: home }
  return resolveFactoryProduct(world, home, init)
}

/**
 * 解析一个页面 meta 导出：直接 ComponentPageMeta 对象或工厂产物 `.Meta`。
 * Resolve one page meta export: a direct ComponentPageMeta object or the
 * factory product `.Meta`.
 * @returns {{ meta: ts.ObjectLiteralExpression|undefined, env: Map<string, ts.Node>, file: string }|undefined}
 */
export function resolveMeta(world, unitPath, name) {
  const found = declarationOf(world, unitPath, name)
  if (found === undefined || !ts.isVariableDeclaration(found.node)) return undefined
  const home = found.unit.path
  const init = unwrapAs(found.node.initializer)
  if (init === undefined) return undefined
  if (ts.isObjectLiteralExpression(init)) return { meta: init, env: new Map(), file: home }
  return resolveFactoryProduct(world, home, init)
}

/** 工厂产物：`factory({...}).Page` → 工厂体内的 PageFC 箭头与 Meta 对象 / factory product: the PageFC arrow and Meta object inside the factory body */
function resolveFactoryProduct(world, home, init) {
  if (!ts.isPropertyAccessExpression(init) || !ts.isIdentifier(init.expression)) return undefined
  const source = declarationOf(world, home, init.expression.text)
  const call = source === undefined ? undefined : unwrapAs(source.node.initializer)
  if (call === undefined || !ts.isCallExpression(call)) return undefined
  const factory = resolveFactoryFunction(world, home, call)
  if (factory === undefined) return undefined
  const env = new Map()
  if (factory.parameters.length > 0 && call.arguments.length > 0) {
    env.set(factory.parameters[0].name.text, call.arguments[0])
  }
  return { meta: findTypedObject(factory.body, 'ComponentPageMeta'), env, body: findTypedArrow(factory.body, 'PageFC'), file: home }
}

/** 解析工厂函数（同文件或导入源）/ resolve the factory function (same file or import source) */
function resolveFactoryFunction(world, unitPath, call) {
  if (!ts.isIdentifier(call.expression)) return undefined
  const found = declarationOf(world, unitPath, call.expression.text)
  const node = found?.node
  if (node === undefined) return undefined
  return ts.isFunctionDeclaration(node) ? node : unwrapAs(node.initializer)
}

/** 剥 `as` 表达式 / strip as-expressions */
/** 子树里第一个带某类型标注的对象字面量 / the first object literal annotated with a type in a subtree */
function findTypedObject(node, typeName) {
  let found
  const visit = (current) => {
    if (found !== undefined) return
    if (ts.isVariableDeclaration(current) && isTyped(current, typeName)) {
      const object = unwrapAs(current.initializer)
      if (object !== undefined && ts.isObjectLiteralExpression(object)) { found = object; return }
    }
    current.forEachChild(visit)
  }
  if (node !== undefined) visit(node)
  return found
}

/** 子树里第一个带某类型标注的箭头函数 / the first arrow function annotated with a type in a subtree */
function findTypedArrow(node, typeName) {
  let found
  const visit = (current) => {
    if (found !== undefined) return
    if (ts.isVariableDeclaration(current) && isTyped(current, typeName)) {
      const fn = unwrapAs(current.initializer)
      if (fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) { found = fn; return }
    }
    current.forEachChild(visit)
  }
  if (node !== undefined) visit(node)
  return found
}

/**
 * 读 meta 对象的一个属性（env 优先：工厂形参 → 实参对象）。返回静态字符串，
 * 缺席返回 undefined。
 * Read one property of a meta object (env first: a factory parameter → its
 * argument object). Returns the static string, or undefined when absent.
 */
export function metaValue(world, unitPath, meta, env, prop) {
  if (meta === undefined) return undefined
  const direct = propertyInitializer(meta, prop)
  if (direct !== undefined) {
    const value = stringValue(direct, world, unitPath)
    if (value !== undefined) return value
  }
  for (const argNode of env.values()) {
    const object = unwrapAs(argNode)
    if (object !== undefined && ts.isObjectLiteralExpression(object)) {
      const value = propertyInitializer(object, prop)
      if (value !== undefined) {
        const text = stringValue(value, world, unitPath)
        if (text !== undefined) return text
      }
    }
  }
  return undefined
}

/** 属性初始化节点 / a property's initializer node */
function propertyInitializer(object, prop) {
  for (const item of object.properties) {
    if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === prop) {
      return item.initializer
    }
  }
  return undefined
}

/**
 * 宿主追加文本：page-registry 的 taskBlock 模板串（每条投递到页面会话的 TASK
 * 块原文）。hostTexts 为空 = 未找到宿主文本（门禁跳过宿主层）。
 * Host-appended text: page-registry's taskBlock template strings (the verbatim
 * TASK block appended to page sessions). An empty list = no host text found.
 * @returns {string[]} host text fragments / 宿主文本片段
 */
export function collectHostTexts(world) {
  const texts = []
  for (const [, unit] of world.units) {
    if (!unit.path.replaceAll('\\', '/').includes('/page-registry/src/page-block.ts')) continue
    const fn = unit.functionOf('taskBlock')
    if (fn === undefined) continue
    const visit = (node) => {
      if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const statics = ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : [node.text]
        texts.push(...statics.filter((part) => part.trim() !== ''))
      }
      node.forEachChild(visit)
    }
    if (fn.body !== undefined) visit(fn.body)
  }
  return texts
}

// JSDoc 引用保持 import 可读：stringValue / declarationOf 的形状见各自模块
// keep the references readable: see stringValue / declarationOf in their modules
