/**
 * 节点与槽位求值器：静态解析到 AST 节点（env 跨文件绑定）、装配槽位方法
 * （`<requireFn>().<prop>()` 形态）与技能实参求值。都是名字求值器的支撑件。
 * The node/slot evaluator: static resolution to AST nodes (with cross-file env
 * bindings), assembly-slot methods (the `<requireFn>().<prop>()` shape) and
 * skill-argument evaluation — all support pieces of the name evaluator.
 * @module scripts/lib/model-surface/resolve-node
 */
import ts from 'typescript'
import { MAX_DEPTH, NAME_WRAPPERS, resolveNames } from './names.mjs'
import { elementKey, functionOf, propertyInitializerOf, unwrapAs } from './helpers.mjs'
import { declarationOf } from './world.mjs'

// ---- 装配槽位方法（requireServices().taskFace() 形态）---- // ---- assembly-slot methods ----

/**
 * 槽位方法调用求值：`<requireFn>().<prop>()` —— requireFn 返回模块槽位标识符，
 * 槽位由某个 bind 型函数整体赋值为对象字面量（简写属性），属性值即该函数的形参，
 * 形参在装配调用点绑到实参（如 () => buildPageTaskTools(...)）。
 * Evaluate a slot-method call `<requireFn>().<prop>()`: requireFn returns a
 * module-slot identifier, the slot is object-assigned whole by a bind-style
 * function whose (shorthand) properties are its parameters, and the parameter
 * binds at the assembly call site to the argument (e.g. () => buildPageTaskTools(...)).
 */
export function resolveSlotNames(call, depth, ctx) {
  if (!ts.isPropertyAccessExpression(call.expression)) return { ok: false, items: [] }
  const base = call.expression.expression
  if (!ts.isCallExpression(base) || !ts.isIdentifier(base.expression)) return { ok: false, items: [] }
  // 槽位赋值住在 requireFn 的**声明**文件里（如 first-screen.ts 的 `services = { … }`），
  // 不在调用方页面文件里——按声明 unit 找，跨文件槽位形态才解析得动。
  // / The slot assignment lives in the requireFn's DECLARING file (e.g. first-screen.ts's
  // `services = { … }`), not in the calling page file — look in the declaring unit, or
  // the cross-file slot shape never resolves.
  const declared = declarationOf(ctx.world, ctx.unitPath, base.expression.text)
  const requireFn = functionOf(declared?.node ?? undefined)
  const slotName = requireFn === undefined ? undefined : returnedIdentifier(requireFn)
  if (slotName === undefined) return { ok: false, items: [] }
  const assignment = slotAssignment(declared?.unit ?? ctx.world.units.get(ctx.unitPath), slotName)
  if (assignment === undefined) return { ok: false, items: [] }
  return slotPropNames(assignment, call.expression.name.text, depth, ctx, declared?.unit ?? ctx.world.units.get(ctx.unitPath))
}

/** 函数体里 `return <identifier>` 的标识符名 / the identifier of a `return <identifier>` in a body */
function returnedIdentifier(fn) {
  let name
  const visit = (node) => {
    if (name !== undefined) return
    if (ts.isReturnStatement(node) && node.expression !== undefined && ts.isIdentifier(node.expression)) {
      name = node.expression.text
      return
    }
    node.forEachChild(visit)
  }
  if (fn.body !== undefined) visit(fn.body)
  return name
}

/** 槽位整体赋值（`slot = { ... }`）与其所在函数名 / the slot's whole-object assignment and its enclosing function name */
function slotAssignment(unit, slotName) {
  if (unit === undefined) return undefined
  let found
  const visit = (node) => {
    if (found !== undefined) return
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && node.left.text === slotName
      && ts.isObjectLiteralExpression(node.right)) {
      found = { object: node.right, fnName: enclosingFunctionName(node) }
      return
    }
    node.forEachChild(visit)
  }
  visit(unit.sourceFile)
  return found
}

/** 节点所在函数的名字 / the name of the function enclosing a node */
function enclosingFunctionName(node) {
  let current = node.parent
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text
    if ((ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

/** 槽位属性 → 装配实参 → 工具名 / slot property → assembly argument → tool names */
function slotPropNames(assignment, prop, depth, ctx, homeUnit) {
  if (assignment.fnName === undefined) return { ok: false, items: [] }
  // bind 函数同样住在声明文件里（bindNotebookServices 是 first-screen.ts 的本地函数，
  // 调用方页面没有它的导入）——按声明 unit 解析，跨文件才接得上。
  // / The bind function lives in the declaring file too (bindNotebookServices is a
  // local of first-screen.ts; the calling page imports nothing of it) — resolve in
  // the declaring unit, or the cross-file chain never closes.
  const setter = declarationOf(ctx.world, homeUnit.path, assignment.fnName)
  const fn = setter === undefined ? undefined : functionOf(setter.node)
  const index = fn === undefined ? -1 : fn.parameters.findIndex((param) => ts.isIdentifier(param.name) && param.name.text === prop)
  if (index < 0) return { ok: false, items: [] }
  for (const [sitePath, unit] of ctx.world.units) {
    for (const call of callSites(unit, assignment.fnName)) {
      const arg = call.arguments[index]
      if (arg === undefined) continue
      // 实参按它所在文件解析 / the argument resolves against its own file
      const resolved = resolveNames(unwrapArrowBody(arg), new Map(), depth + 1, { ...ctx, unitPath: sitePath })
      if (resolved.ok && resolved.items.length > 0) return resolved
    }
  }
  return { ok: false, items: [] }
}

/** 实参若为箭头函数则取其体 / an arrow argument's body */
function unwrapArrowBody(node) {
  return ts.isArrowFunction(node) ? node.body : node
}

/** 一个函数名在某文件里的调用点 / call sites of a function name within one file */
function callSites(unit, fnName) {
  const calls = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fnName) calls.push(node)
    node.forEachChild(visit)
  }
  if (unit !== undefined) visit(unit.sourceFile)
  return calls
}

// ---- 技能与节点求值 ---- // ---- skill and node evaluation ----

/** 技能实参求值：{name} 字面量 / spread 的加载器调用 / 直接加载器调用 */
export function resolveSkillNames(expr, env, depth, ctx) {
  if (depth > MAX_DEPTH || expr === undefined) return []
  if (ts.isObjectLiteralExpression(expr)) {
    const name = propertyInitializerOf(expr, 'name')
    if (name !== undefined) return resolveSkillNames(name, env, depth + 1, ctx)
    for (const item of expr.properties) {
      if (ts.isSpreadAssignment(item) || ts.isSpreadElement(item)) {
        const names = resolveSkillNames(item.expression, env, depth + 1, ctx)
        if (names.length > 0) return names
      }
    }
    return []
  }
  if (ts.isStringLiteral(expr)) return [expr.text]
  if (ts.isIdentifier(expr)) return skillOfLoader(expr.text, ctx) ?? resolveSkillNames(envNode(expr.text, env), env, depth + 1, ctx)
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return skillOfLoader(expr.expression.text, ctx) ?? []
  return []
}

/** 加载器函数名 → 技能声明名 / a loader function name → the declared skill name */
function skillOfLoader(name, ctx) {
  const loader = ctx.loaders.get(name)
  if (loader === undefined) return undefined
  const declared = ctx.skillDecls.get(loader.dir)
  return declared === undefined ? undefined : [declared.name]
}

/** env 里的节点绑定 / a node binding from env */
function envNode(name, env) {
  return env.get(name)?.node
}

/** for-of 迭代源的元素节点（解不出返回 null）/ element nodes of a for-of source (null when unresolved) */
export function iterableNodes(expr, env, depth, ctx) {
  const node = resolveNode(expr, env, depth, ctx)
  return node !== undefined && ts.isArrayLiteralExpression(node) ? node.elements : null
}

/** 静态解析到节点（不评估调用）/ statically resolve to a node (calls are not evaluated) */
export function resolveNode(expr, env, depth, ctx) {
  if (depth > MAX_DEPTH || expr === undefined) return undefined
  if (ts.isAsExpression(expr)) return resolveNode(expr.expression, env, depth + 1, ctx)
  if (ts.isIdentifier(expr)) {
    const bound = env.get(expr.text)
    if (bound !== undefined) {
      if (bound.node === undefined) return undefined
      const innerCtx = bound.file !== undefined ? { ...ctx, unitPath: bound.file } : ctx
      return resolveNode(bound.node, env, depth + 1, innerCtx)
    }
    const found = declarationOf(ctx.world, ctx.unitPath, expr.text)
    return found === undefined || !ts.isVariableDeclaration(found.node)
      ? undefined
      : resolveNode(unwrapAs(found.node.initializer), env, depth + 1, ctx)
  }
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    const base = resolveNode(expr.expression, env, depth + 1, ctx)
    const prop = ts.isPropertyAccessExpression(expr) ? expr.name.text : elementKey(expr)
    if (base === undefined || prop === undefined || !ts.isObjectLiteralExpression(base)) return undefined
    return propertyInitializerOf(base, prop)
  }
  return ts.isArrayLiteralExpression(expr) || ts.isObjectLiteralExpression(expr)
    || ts.isStringLiteral(expr) ? expr : undefined
}
