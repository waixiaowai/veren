/**
 * 挂载面解析器：走进一个页面组件体，把每个 `*.ctx.tools.register(...)` /
 * `*.ctx.skills.register(...)` 解析成名字——字面量、toolOf/named/externalName
 * 包装、绑定表、工厂返回数组、本地 helper 内联（参数→实参绑定）与 for-of 展开
 * 都按符号表走；解不动的形状记 unresolved（fail loud，绝不静默猜）。
 * The mount-face resolver: walks a page body and resolves every
 * `*.ctx.tools.register(...)` / `*.ctx.skills.register(...)` into names —
 * literals, toolOf/named/externalName wrappers, binding tables, factory
 * products, local helper inlining (parameters bound to arguments) and for-of
 * expansion all go through a symbol table; unresolvable shapes are recorded as
 * unresolved (fail loud, never silently guessed).
 * @module scripts/lib/model-surface/mounts
 */
import ts from 'typescript'
import { boundEnv, exprPathOf, functionOf, loopVarName } from './helpers.mjs'
import { declarationOf } from './world.mjs'
import { MAX_DEPTH, functionNames, resolveNames, seenHas } from './names.mjs'
import { iterableNodes, resolveNode, resolveSkillNames } from './resolve-node.mjs'

/** for-of 元素上限 / the element cap for a for-of expansion */
const MAX_ELEMENTS = 64

/**
 * 收集结果 / the collected mount face
 * @typedef {object} MountFace
 * @property {Array<{name: string, external: boolean}>} tools 原始工具名（external=经 named/toolOf 包装，需加应用前缀）/ raw tool names (external = came through a naming wrapper, needs the app prefix)
 * @property {string[]} skills 挂载的技能名 / mounted skill names
 * @property {Array<{where: string, reason: string}>} unresolved 解不动的位置 / unresolvable sites
 */

/**
 * 解析一个页面组件体的挂载面。
 * Resolve one page body's mount face.
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @param {string} unitPath - the body's file / 组件体所在文件
 * @param {ts.Node} bodyFn - the body function node / 组件体函数节点
 * @param {Map<string, string>} builders - builder fn → tool local name / 构建器映射
 * @param {Map<string, {pkg: string, dir: string}>} loaders - skill loader fn → skill dir / 技能加载器映射
 * @param {Map<string, {name: string, pkg: string, file: string}>} skillDecls - skill dir → declaration / 技能目录 → 声明
 * @param {Map<string, ts.Node>} [initialEnv] - factory param → argument nodes / 工厂形参 → 实参节点
 * @returns {MountFace} the mount face / 挂载面
 */
export function collectMounts(world, unitPath, bodyFn, builders, loaders, skillDecls, initialEnv) {
  const face = { tools: [], skills: [], unresolved: [] }
  const seen = new Set()
  const env = new Map()
  for (const [name, node] of initialEnv ?? []) env.set(name, { node })
  walk(bodyFn, env, 0, { world, unitPath, builders, loaders, skillDecls, face, seen })
  face.tools = [...new Set(face.tools)]
  face.skills = [...new Set(face.skills)]
  return face
}

/** 环境上下文 / the walk context */
function walk(node, env, depth, ctx) {
  if (depth > MAX_DEPTH || node === undefined) return
  if (ts.isForOfStatement(node)) {
    walkForOf(node, env, depth, ctx)
    return
  }
  if (ts.isCallExpression(node)) walkCall(node, env, depth, ctx)
  node.forEachChild((child) => walk(child, env, depth + 1, ctx))
}

/** for-of：按元素绑定循环变量后逐个走体 / for-of: bind the loop variable per element, then walk the body */
function walkForOf(node, env, depth, ctx) {
  const name = loopVarName(node.initializer)
  if (name === undefined) return walk(node.statement, env, depth + 1, ctx)
  const elements = iterableNodes(node.expression, env, depth, ctx)
  if (elements !== null) {
    for (const element of elements.slice(0, MAX_ELEMENTS)) {
      walk(node.statement, boundEnv(env, name, { node: element, file: nodeFile(element) }), depth + 1, ctx)
    }
    return
  }
  const resolved = resolveNames(node.expression, env, 0, ctx)
  if (resolved.ok) walk(node.statement, boundEnv(env, name, { names: resolved.items.map((item) => item.name) }), depth + 1, ctx)
  else ctx.face.unresolved.push({ where: ctx.unitPath, reason: `for-of source unresolved: ${node.expression.getText()}` })
}

/** 调用：登记调用 / helper 内联 / 名字收集 / a call: registration, helper inlining, or name collection */
function walkCall(call, env, depth, ctx) {
  const path = exprPathOf(call.expression, ctx)
  if (path !== null && path.length >= 2) {
    const kind = path[path.length - 2] === 'tools' && path[path.length - 1] === 'register' ? 'tools'
      : path[path.length - 2] === 'skills' && path[path.length - 1] === 'register' ? 'skills' : undefined
    if (kind === 'tools') return recordTools(call, env, depth, ctx)
    if (kind === 'skills') return recordSkill(call, env, depth, ctx)
  }
  inlineOrCollect(call, env, depth, ctx)
}

/** 记录一次工具登记 / record one tool registration */
function recordTools(call, env, depth, ctx) {
  const arg = call.arguments[0]
  const resolved = arg === undefined ? { ok: false, items: [] } : resolveNames(arg, env, 0, ctx)
  if (resolved.ok) ctx.face.tools.push(...resolved.items)
  else ctx.face.unresolved.push({ where: ctx.unitPath, reason: `tool registration unresolved: ${arg?.getText() ?? ''}` })
}

/** 记录一次技能登记 / record one skill registration */
function recordSkill(call, env, depth, ctx) {
  const arg = call.arguments[0]
  const names = arg === undefined ? [] : resolveSkillNames(arg, env, 0, ctx)
  if (names.length === 0) {
    ctx.face.unresolved.push({ where: ctx.unitPath, reason: `skill registration unresolved: ${arg?.getText() ?? ''}` })
    return
  }
  ctx.face.skills.push(...names)
}

/** helper 内联（体内含登记）或函数名收集 / inline a helper (its body registers) or collect names from a function */
function inlineOrCollect(call, env, depth, ctx) {
  if (!ts.isIdentifier(call.expression) || depth > MAX_DEPTH) return
  const found = declarationOf(ctx.world, ctx.unitPath, call.expression.text)
  const fn = found === undefined ? undefined : functionOf(found.node)
  if (fn === undefined || fn.body === undefined || seenHas(ctx, fn, call.expression.text)) return
  // 内联换文件：helper 体内的名字按 helper 自己的 import 表解析
  // inlining switches files: names in the helper resolve against the helper's own imports
  const innerCtx = { ...ctx, unitPath: found.unit.path }
  if (registersSomething(fn.body)) {
    walk(fn.body, bindParams(fn, call.arguments, env), depth + 1, innerCtx)
    return
  }
  for (const name of functionNames(fn, depth, innerCtx)) ctx.face.tools.push(name)
}


/** 形参 → 实参绑定（叠加在环境之上；只绑定标识符形参）/ bind parameters over the ambient env (identifier parameters only) */
function bindParams(fn, args, env) {
  const bound = new Map(env)
  fn.parameters.forEach((param, index) => {
    if (ts.isIdentifier(param.name) && args[index] !== undefined) {
      bound.set(param.name.text, { node: args[index], file: nodeFile(args[index]) })
    }
  })
  return bound
}

/** 节点所属文件（env 绑定跨文件解析的依据）/ the file owning a node (the basis for cross-file env resolution) */
function nodeFile(node) {
  return node.getSourceFile().fileName
}


/** 体内是否有登记调用 / whether a body contains registration calls */
function registersSomething(node) {
  let found = false
  const visit = (current) => {
    if (found || !ts.isCallExpression(current)) {
      if (!found) current.forEachChild(visit)
      return
    }
    const path = exprPathOf(current.expression, null)
    if (path !== null && path.length >= 2 && path[path.length - 1] === 'register'
      && (path[path.length - 2] === 'tools' || path[path.length - 2] === 'skills')) {
      found = true
      return
    }
    current.forEachChild(visit)
  }
  visit(node)
  return found
}

