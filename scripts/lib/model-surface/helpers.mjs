/**
 * 模型面提取的共享小工具：属性链路径、for-of 循环变量、对象属性读取、函数形
 * 判定、as 剥壳与环境绑定。所有解析模块从这里取，避免影子副本。
 * Shared small helpers for the model-surface extraction: property-chain paths,
 * for-of loop variables, object property reads, function-shape checks, as-
 * stripping and env binding. Every resolver module takes them from here — no
 * shadow copies.
 * @module scripts/lib/model-surface/helpers
 */
import ts from 'typescript'

export function exprPathOf(node, ctx) {
  if (node === undefined) return null
  if (ts.isIdentifier(node)) return [node.text]
  if (ts.isPropertyAccessExpression(node)) {
    const base = exprPathOf(node.expression, ctx)
    return base === null ? null : [...base, node.name.text]
  }
  return null
}

export function loopVarName(initializer) {
  return initializer !== undefined && ts.isVariableDeclarationList(initializer)
    && initializer.declarations.length === 1 && ts.isIdentifier(initializer.declarations[0].name)
    ? initializer.declarations[0].name.text
    : undefined
}

export function propertyInitializerOf(object, prop) {
  for (const item of object.properties) {
    if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === prop) return item.initializer
  }
  return undefined
}

export function elementKey(expr) {
  return expr.argumentExpression !== undefined && ts.isStringLiteralLike(expr.argumentExpression)
    ? expr.argumentExpression.text
    : undefined
}

export function functionOf(node) {
  if (ts.isFunctionDeclaration(node)) return node
  if (ts.isVariableDeclaration(node)) {
    const init = unwrapAs(node.initializer)
    return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
  }
  return undefined
}

export function unwrapAs(node) {
  return node !== undefined && ts.isAsExpression(node) ? node.expression : node
}

export function boundEnv(env, name, binding) {
  return new Map([...env, [name, binding]])
}
