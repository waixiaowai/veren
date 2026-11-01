/**
 * 模型面提取的字符串与文本底座：静态字符串求值（const 跟随 / 拼接 / 模板）、
 * 节点级文本收集、逐元拆词。全部是纯函数——AST 进、字符串集出，零误报地
 * 区分注释与实义文本（注释节点不进任何收集器）。
 * The string/text substrate for model-surface extraction: static string
 * evaluation (const-following / concatenation / templates), node-level text
 * collection, and token splitting. All pure functions — AST in, string sets
 * out; comments never reach any collector.
 * @module scripts/lib/model-surface/strings
 */
import ts from 'typescript'
import { declarationOf } from './world.mjs'

/** 求值深度上限（环引用保险）/ recursion cap (cycle guard) */
const MAX_DEPTH = 8

/**
 * 解析一个静态字符串：字面量、无副作用的模板、`+` 拼接、const 标识符跟随。
 * 解不开（运行期才有值）返回 undefined——调用方据此走 fail-loud 或跳过。
 * Resolve a static string: literals, side-effect-free templates, `+`
 * concatenation, const identifier following. Returns undefined when the value
 * only exists at runtime — callers then fail loud or skip.
 * @param {ts.Node} node - expression to evaluate / 待求值表达式
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @param {string} unitPath - owning file / 所属文件
 * @returns {string|undefined} the string, when static / 静态可求值时的字符串
 */
export function stringValue(node, world, unitPath, depth = 0) {
  if (depth > MAX_DEPTH || node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return templateText(node, world, unitPath, depth)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    // `+` 链先摊平再逐段求值：长说明串不会吃掉递归深度
    // flatten a `+` chain before evaluating: long instruction strings must not eat the recursion depth
    let text = ''
    for (const part of flattenPlus(node)) {
      const value = stringValue(part, world, unitPath, depth + 1)
      if (value === undefined) return undefined
      text += value
    }
    return text
  }
  if (ts.isIdentifier(node)) return identifierString(node.text, world, unitPath, depth)
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return stringValue(node.expression, world, unitPath, depth)
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'join') {
    // `[...].join(sep)`：字符串数组的静态拼接（如 person-agent 的人格说明）
    // `[...].join(sep)`: static join over an array of strings (e.g. the persona note)
    const array = node.expression.expression
    if (!ts.isArrayLiteralExpression(array)) return undefined
    const sep = node.arguments[0] === undefined ? ',' : stringValue(node.arguments[0], world, unitPath, depth + 1) ?? ','
    const parts = []
    for (const element of array.elements) {
      const value = stringValue(element, world, unitPath, depth + 1)
      if (value === undefined) return undefined
      parts.push(value)
    }
    return parts.join(sep)
  }
  return undefined
}

/** 摊平 `+` 链的操作数（左结合）/ flatten the operands of a left-associated `+` chain */
function flattenPlus(node) {
  const parts = []
  let current = node
  while (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    parts.unshift(current.right)
    current = current.left
  }
  parts.unshift(current)
  return parts
}

/** 模板串：头部 + 逐段静态插值；插值解不开则整体 undefined / template text: head plus per-slot resolved substitutions */
function templateText(node, world, unitPath, depth) {
  let text = node.head.text
  for (const span of node.templateSpans) {
    const value = stringValue(span.expression, world, unitPath, depth + 1)
    if (value === undefined) return undefined
    text += value + span.literal.text
  }
  return text
}

/** const 标识符跟随（同文件顶层声明，再走导入/再导出）/ const identifier following (top-level declarations, then imports/re-exports) */
function identifierString(name, world, unitPath, depth) {
  const unit = world.units.get(unitPath)
  const local = unit?.constOf(name)?.initializer
  if (local !== undefined) return stringValue(local, world, unitPath, depth + 1)
  const found = declarationOf(world, unitPath, name)
  const init = found === undefined || !ts.isVariableDeclaration(found.node) ? undefined : found.node.initializer
  if (init === undefined || found === undefined) return undefined
  return stringValue(init, world, found.unit.path, depth + 1)
}

/**
 * 收集一个节点子树里的全部手写模型可见文本：JSX 正文、字符串字面量、模板的
 * 静态段。注释被 AST 天然排除。返回去重后的字符串数组。
 * Collect every hand-written model-visible string in a subtree: JSX text,
 * string literals, the static segments of templates. Comments are excluded by
 * the AST itself. Returns a deduped string array.
 * @param {ts.Node} node - subtree root / 子树根
 * @returns {string[]} collected strings / 收集到的字符串
 */
export function collectText(node) {
  const out = []
  const visit = (current) => {
    if (ts.isJsxText(current)) {
      const text = current.getText().replace(/\s+/g, ' ').trim()
      if (text !== '') out.push(text)
      return
    }
    if (ts.isStringLiteral(current)) {
      out.push(current.text)
      return
    }
    if (ts.isTemplateExpression(current)) {
      out.push(current.head.text)
      for (const span of current.templateSpans) out.push(span.literal.text)
    }
    current.forEachChild(visit)
  }
  visit(node)
  return out
}

/** 蛇形词元（工具本地名形状）/ snake_case token (tool-local-name shape) */
export const SNAKE_TOKEN = /\b[a-z][a-z0-9_]{2,}\b/g

/** 带应用前缀的完整工具名词元 / a prefixed full tool-name token */
export const FULL_NAME_TOKEN = /\b[a-z][a-z0-9_]*__[a-z0-9_]+\b/g

/**
 * 按句切文本（。；; 与换行为界），供"路由逃逸"（同句出现页面 URL/页名）判定。
 * Split text into sentences (。；; and newlines) for the routing escape (a page
 * url or page name in the same sentence).
 * @param {string} text - text to split / 待切分文本
 * @returns {string[]} sentences / 句子数组
 */
export function sentencesOf(text) {
  return text.split(/[。；;\n]/).map((part) => part.trim()).filter((part) => part !== '')
}

/**
 * 把一句话里的蛇形词元按顿号/逗号/斜杠分组（相邻词元同组）——枚举组是"逐字
 * 承诺"的强信号，孤儿词元不是。每组是有序去重数组。
 * Group a sentence's snake tokens by 、,，/ separators (adjacent tokens share a
 * group) — an enumeration group is the strong "verbatim promise" signal, a lone
 * token is not. Each group is a deduped ordered array.
 * @param {string} sentence - one sentence / 一句话
 * @returns {string[][]} token groups / 词元分组
 */
export function snakeGroupsOf(sentence) {
  const groups = []
  let current = []
  let pendingSeparator = false
  for (const match of sentence.matchAll(/[a-z][a-z0-9_]{2,}|[、,，/]|[^\s、,，/a-zA-Z0-9_]+|\s+/g)) {
    const text = match[0]
    if (/^[a-z][a-z0-9_]{2,}$/.test(text)) {
      if (pendingSeparator && current.length > 0) current.push(text)
      else {
        if (current.length > 0) groups.push([...new Set(current)])
        current = [text]
      }
      pendingSeparator = false
    } else if (/^[、,，/]$/.test(text)) {
      pendingSeparator = true
    } else if (/\S/.test(text)) {
      if (current.length > 0) groups.push([...new Set(current)])
      current = []
      pendingSeparator = false
    }
  }
  if (current.length > 0) groups.push([...new Set(current)])
  return groups
}
