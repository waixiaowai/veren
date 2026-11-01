/**
 * 挂载面名字求值器：表达式 → 名字集（{name, external}——external 表示经
 * named/externalName/toolOf 包装、需加应用前缀）。const 跟随、数组、{name} 对象、
 * 包装调用、构建器映射、常量直挂的工具构造、装配槽位方法与技能加载器都按符号
 * 表走；解不动返回 ok:false——fail loud，绝不静默猜。
 * The mount-face name evaluator: expressions → name sets ({name, external} —
 * external means the name came through a named/externalName/toolOf wrapper and
 * needs the app prefix). Const following, arrays, {name} objects, wrapper
 * calls, the builder map, const-bound tool-factory products, assembly-slot
 * methods and skill loaders all go through a symbol table; unresolvable shapes
 * return ok:false — fail loud, never silently guessed.
 * @module scripts/lib/model-surface/names
 */
import ts from 'typescript'
import { functionOf, propertyInitializerOf, unwrapAs } from './helpers.mjs'
import { stringValue } from './strings.mjs'
import { declarationOf } from './world.mjs'
import { resolveNode, resolveSlotNames } from './resolve-node.mjs'

/** 解析深度上限 / recursion caps */
export const MAX_DEPTH = 10

/** 直接透传名字的包装调用 / wrapper calls that pass a name through */
export const NAME_WRAPPERS = new Set(['named', 'externalName', 'toolOf'])

/**
 * 名字求值结果 / a name-evaluation result
 * @typedef {object} NamesResult
 * @property {boolean} ok 是否可静态求解 / whether statically resolvable
 * @property {Array<{name: string, external: boolean}>} items 名字与包装标记 / names with their wrapper marks
 */

// ---- 名字求值 ---- // ---- name evaluation ----

/** 函数体能否产出一组工具名（收集数组字面量的调用/对象元素；裸字符串不算名）/ collect tool names from a function body's array literals (call/object elements only; bare strings are not names) */
export function functionNames(fn, depth, ctx) {
  const names = []
  const visit = (node) => {
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) continue
        const resolved = resolveNames(element, new Map(), depth + 1, ctx)
        if (resolved.ok) names.push(...resolved.items)
      }
    }
    node.forEachChild(visit)
  }
  if (fn.body !== undefined) visit(fn.body)
  return names
}

/** 递归保护键 / the recursion guard key */
export function seenHas(ctx, fn, name) {
  const key = `${fn.getSourceFile().fileName}#${name}`
  if (ctx.seen.has(key)) return true
  ctx.seen.add(key)
  return false
}


/**
 * 静态求值一组名字：字面量 / env / 声明跟随 / 数组 / {name} 对象 / 包装调用 /
 * 构建器映射 / 函数体收集。
 * Statically evaluate a set of names: literals / env / declaration following /
 * arrays / {name} objects / wrapper calls / the builder map / function bodies.
 */
export function resolveNames(expr, env, depth, ctx) {
  if (depth > MAX_DEPTH || expr === undefined) return { ok: false, items: [] }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { ok: true, items: [{ name: expr.text, external: false }] }
  }
  if (ts.isIdentifier(expr)) return resolveIdentifierName(expr.text, env, depth, ctx)
  if (ts.isArrayLiteralExpression(expr)) return resolveArrayNames(expr, env, depth, ctx)
  if (ts.isObjectLiteralExpression(expr)) return resolveObjectNames(expr, env, depth, ctx)
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) return resolveAccessNames(expr, env, depth, ctx)
  if (ts.isCallExpression(expr)) return resolveCallNames(expr, env, depth, ctx)
  const text = stringValue(expr, ctx.world, ctx.unitPath)
  return text === undefined ? { ok: false, items: [] } : { ok: true, items: [{ name: text, external: false }] }
}

/** 标识符：env → 声明初始化 / an identifier: env → declaration initializer */
function resolveIdentifierName(name, env, depth, ctx) {
  const bound = env.get(name)
  if (bound !== undefined) {
    if (bound.names !== undefined) return { ok: true, items: bound.names.map((item) => ({ name: item, external: false })) }
    const innerCtx = bound.file !== undefined ? { ...ctx, unitPath: bound.file } : ctx
    return resolveNames(bound.node, env, depth + 1, innerCtx)
  }
  const found = declarationOf(ctx.world, ctx.unitPath, name)
  const init = found === undefined ? undefined : (ts.isVariableDeclaration(found.node) ? found.node.initializer : undefined)
  if (init === undefined) return { ok: false, items: [] }
  return resolveNames(unwrapAs(init), env, depth + 1, ctx)
}

/** 数组：元素并集 / an array: the union of its elements */
function resolveArrayNames(array, env, depth, ctx) {
  const items = []
  for (const element of array.elements) {
    const resolved = ts.isSpreadElement(element)
      ? resolveNames(element.expression, env, depth + 1, ctx)
      : resolveNames(element, env, depth + 1, ctx)
    if (!resolved.ok) return { ok: false, items: [] }
    items.push(...resolved.items)
  }
  return { ok: true, items }
}

/** 对象：取 name 属性 / an object: its `name` property */
function resolveObjectNames(object, env, depth, ctx) {
  const name = propertyInitializerOf(object, 'name')
  if (name === undefined) return { ok: false, items: [] }
  return resolveNames(name, env, depth + 1, ctx)
}

/** 成员访问：解析到节点再取名 / a member access: resolve to a node, then take names */
function resolveAccessNames(expr, env, depth, ctx) {
  const node = resolveNode(expr, env, depth, ctx)
  if (node === undefined) return { ok: false, items: [] }
  return resolveNames(node, env, depth + 1, ctx)
}

/** 调用：包装 / 构建器 / 函数体收集（空收集不算成功——fail loud）/ a call: wrapper / builder / function-body collection (an empty collection is not success — fail loud) */
function resolveCallNames(call, env, depth, ctx) {
  if (!ts.isIdentifier(call.expression)) return resolveSlotNames(call, depth, ctx)
  const name = call.expression.text
  if (NAME_WRAPPERS.has(name)) {
    const resolved = resolveNames(call.arguments[0], env, depth + 1, ctx)
    return resolved.ok ? { ok: true, items: resolved.items.map((item) => ({ ...item, external: true })) } : resolved
  }
  if (ctx.builders.has(name)) return { ok: true, items: [{ name: ctx.builders.get(name), external: false }] }
  const found = declarationOf(ctx.world, ctx.unitPath, name)
  const fn = found === undefined ? undefined : functionOf(found.node)
  if (fn !== undefined && !seenHas(ctx, fn, name)) {
    const items = functionNames(fn, depth, ctx)
    if (items.length > 0) return { ok: true, items }
  }
  return { ok: false, items: [] }
}
