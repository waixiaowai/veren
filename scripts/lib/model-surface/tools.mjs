/**
 * 工具目录提取：全仓 defineTool/adminTool 定义点 → 本地名目录（含参数化构造器
 * 的调用点解析），以及"绑定表"本地名（{ name, build } 形态，如论坛的
 * PageToolBinding）。目录是挂载解析与承诺校验共用的唯一事实源。
 * Tool-catalog extraction: every defineTool/adminTool definition site in the
 * workspace → a local-name catalog (with call-site resolution for parametric
 * builders), plus binding-table local names (the { name, build } shape, e.g.
 * forum's PageToolBinding). The catalog is the single fact source shared by
 * mount resolution and promise checking.
 * @module scripts/lib/model-surface/tools
 */
import ts from 'typescript'
import { stringValue } from './strings.mjs'

/** 定义工具的构造器名 / builder callees that define tools */
const TOOL_FACTORIES = new Set(['defineTool', 'adminTool'])

/**
 * 收集全仓工具目录：本地名 → { file, description }。参数化构造器（name 来自
 * 形参，如 sub2api 的 tableTool、person-agent 的 buildSimple）从调用点实参解析；
 * 同时返回参数化构造器映射（fn 名 → name 形参位次）供构建器映射复用。
 * Collect the workspace tool catalog: local name → { file, description }.
 * Parametric builders (name from a parameter, like sub2api's tableTool or
 * person-agent's buildSimple) resolve from their call sites' arguments; the
 * parametric map (fn name → name-parameter index) comes back for builder
 * mapping.
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @returns {{ catalog: Map<string, { file: string, description?: string }>, parametric: Map<string, number> }}
 */
export function collectToolCatalog(world) {
  const catalog = new Map()
  const parametric = new Map()
  for (const [path, unit] of world.units) {
    visitUnit(unit, (call) => {
      recordDefinition(world, catalog, parametric, path, call)
    })
  }
  return { catalog, parametric }
}

/** 遍历一个 Unit 的全部工具构造调用 / visit every tool-factory call in one unit */
function visitUnit(unit, onCall) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && TOOL_FACTORIES.has(node.expression.text)) {
      onCall(node)
    }
    node.forEachChild(visit)
  }
  visit(unit.sourceFile)
}

/**
 * 记录一个定义点：name 字面量直接入目录；name 是形参引用时找构造器函数与实参
 * 位次，再从调用点解析。解不出就跳过（fail-loud 交给挂载与承诺两侧）。
 * Record one definition site: a literal name enters the catalog directly; a
 * name referencing a parameter resolves via the builder function and its
 * call sites. Unresolvable sites are skipped (fail-loud belongs to the mount
 * and promise sides).
 */
function recordDefinition(world, catalog, parametric, path, call) {
  const arg = call.arguments[0]
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return
  const nameProp = propertyOf(arg, 'name')
  const descProp = propertyOf(arg, 'description')
  if (nameProp === undefined) return
  // 简写属性（`name,`）的实参即形参引用本身 / a shorthand property (`name,`) references the parameter directly
  const nameExpr = ts.isShorthandPropertyAssignment(nameProp) ? nameProp.name : nameProp.initializer
  if (ts.isStringLiteral(nameExpr) || ts.isNoSubstitutionTemplateLiteral(nameExpr)) {
    catalog.set(nameExpr.text, { file: path, description: desc(descProp, world, path) })
    return
  }
  recordParametric(world, catalog, parametric, path, call, nameExpr, descProp)
}

/** 参数化构造器：name/description 取自形参 → 从调用点同位实参解析 / parametric builder: name/description from parameters → resolved at call sites */
function recordParametric(world, catalog, parametric, path, call, nameExpr, descProp) {
  if (!ts.isIdentifier(nameExpr)) return
  const unit = world.units.get(path)
  const fnName = enclosingFunctionName(call)
  if (fnName === undefined) return
  const fn = unit.functionOf(fnName)
  if (fn === undefined) return
  const index = fn.parameters.findIndex((param) => ts.isIdentifier(param.name) && param.name.text === nameExpr.text)
  const descIndex = descProp !== undefined && ts.isPropertyAssignment(descProp) && ts.isIdentifier(descProp.initializer)
    ? fn.parameters.findIndex((param) => ts.isIdentifier(param.name) && param.name.text === descProp.initializer.text)
    : -1
  parametric.set(fnName, index)
  for (const [sitePath, siteUnit] of world.units) {
    forCallSites(siteUnit, fnName, (site) => {
      const name = site.arguments[index] === undefined ? undefined : stringValue(site.arguments[index], world, sitePath)
      if (name === undefined || catalog.has(name)) return
      const descArg = descIndex >= 0 ? site.arguments[descIndex] : undefined
      catalog.set(name, { file: sitePath, description: descArg === undefined ? undefined : stringValue(descArg, world, sitePath) ?? desc(descProp, world, path) })
    })
  }
}

/** 找一个函数名在各文件里的调用点 / find call sites of a function name across units */
function forCallSites(unit, fnName, onSite) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fnName) onSite(node)
    node.forEachChild(visit)
  }
  visit(unit.sourceFile)
}

/** 调用点所在函数的名字（用于参数化构造器定位）/ the name of the function enclosing a call */
function enclosingFunctionName(call) {
  let current = call.parent
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text
    if ((ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

/** 对象字面量的顶层属性（含简写）/ a top-level property of an object literal (shorthand included) */
function propertyOf(object, name) {
  for (const prop of object.properties) {
    const isNamed = (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop))
      && ts.isIdentifier(prop.name) && prop.name.text === name
    if (isNamed) return prop
  }
  return undefined
}

/** description 属性的静态值 / the static value of a description property */
function desc(descProp, world, path) {
  return descProp === undefined ? undefined : stringValue(descProp.initializer, world, path)
}

/**
 * 收集绑定表本地名：同对象同时有 name 字面量与 build 属性（{ name, build }）。
 * Collect binding-table local names: one object literal carrying both a literal
 * `name` and a `build` property.
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @returns {Map<string, string>} local name → file / 本地名 → 文件
 */
export function collectBindingNames(world) {
  const bindings = new Map()
  for (const [path, unit] of world.units) {
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const name = propertyOf(node, 'name')
        const build = propertyOf(node, 'build')
        if (name !== undefined && build !== undefined && ts.isStringLiteral(name.initializer)) {
          bindings.set(name.initializer.text, path)
        }
      }
      node.forEachChild(visit)
    }
    visit(unit.sourceFile)
  }
  return bindings
}

/**
 * 构建器名 → 本地名映射：函数体内含工具构造调用且 name 是字面量，或调用某
 * 参数化构造器且 name 位次是字面量（如 person-agent 的 buildSimple 包装）。
 * Builder-name → local-name map: a function whose body carries a tool-factory
 * call with a literal name, or a call into a parametric builder with a literal
 * at the name index (e.g. person-agent's buildSimple wrappers).
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @param {Map<string, number>} parametric - parametric builder fn → name index
 * @returns {Map<string, string>} builder function name → tool local name
 */
export function collectBuilderNames(world, parametric) {
  const builders = new Map()
  for (const [, unit] of world.units) {
    for (const [name, node] of unit.declarations) {
      if (builders.has(name)) continue
      const body = ts.isFunctionDeclaration(node) ? node.body : node.initializer
      const found = firstToolName(body, parametric)
      if (found !== undefined) builders.set(name, found)
    }
  }
  return builders
}

/** 一个节点子树里第一个工具构造的字面量名 / the first literal tool name in a subtree */
function firstToolName(node, parametric) {
  if (node === undefined) return undefined
  let found
  const visit = (current) => {
    if (found !== undefined) return
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const factory = TOOL_FACTORIES.has(current.expression.text)
      const parametricIndex = parametric.get(current.expression.text)
      if (factory || parametricIndex !== undefined) {
        const arg = parametricIndex !== undefined ? current.arguments[parametricIndex] : current.arguments[0]
        const name = arg !== undefined && ts.isObjectLiteralExpression(arg) ? propertyOf(arg, 'name')?.initializer : arg
        if (name !== undefined && ts.isStringLiteral(name)) {
          found = name.text
          return
        }
      }
    }
    current.forEachChild(visit)
  }
  visit(node)
  return found
}
