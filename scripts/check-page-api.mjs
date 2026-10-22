#!/usr/bin/env node
/**
 * 页面组件 API 门禁：页面回调（`: PageFC` 标注的函数、`defineComponentPage(`
 * 的组件实参、内联 `pages.register((props, ctx) => …)` 回调）里，禁止直接调用
 * `ctx.effect` / `ctx.on` / `ctx.tools.register`——它们是 Cordis Context 的固有
 * 成员，在页面里调用会得到创建者 fiber 的语义，而不是页面记账语义。页面必须走
 * `ctx.page.effect` / `ctx.page.on` / `ctx.page.tool`。
 * Page-component API gate: inside a page callback (a `: PageFC`-annotated
 * function, the component argument of `defineComponentPage(`, or an inline
 * `pages.register((props, ctx) => …)` callback), direct calls to `ctx.effect` /
 * `ctx.on` / `ctx.tools.register` are forbidden — those are Cordis Context's
 * inherent members, and inside a page they bind to the creator fiber instead of
 * the page bookkeeping. Pages must use `ctx.page.effect` / `ctx.page.on` /
 * `ctx.page.tool`.
 *
 * 用 TypeScript AST 而非正则：注释/字符串零误报；ctx 别名（const c=ctx）、
 * 解构（const { effect } = ctx）、下标（ctx['effect']）、可选链（ctx?.effect）
 * 都按符号表解析，不再漏报。检查限定在页面回调作用域内，同一文件里 apply 层
 * 的合法 ctx.effect 不受牵连。
 * AST-based (TypeScript) instead of regex: no false hits from comments or
 * strings; ctx aliases, destructuring, bracket access and optional chaining are
 * resolved through a symbol table. Checking is scoped to the page callback, so
 * a legal apply-level ctx.effect in the same file stays untouched.
 *
 * 只扫描 `plugins/<pkg>/src` 与 `packages/<pkg>/src`（不扫 tests/dist）：
 * 测试夹具可以直接造 ctx，页面生产代码才是契约面。
 * Scans only `plugins/<pkg>/src` and `packages/<pkg>/src` (not tests/dist):
 * fixtures may build raw ctxs; the production page code is the contract.
 * @module scripts/check-page-api
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCAN_GROUPS = ['plugins', 'packages']
/** 禁用 API → 页面应改用的正确面 / forbidden API → the page-scope face to use */
const FORBIDDEN_PATHS = new Map([
  ['effect', 'ctx.page.effect'],
  ['on', 'ctx.page.on'],
  ['tools,register', 'ctx.page.tool'],
])

/**
 * 类型注解是否为 `PageFC`（TypeReference 标识符名）。
 * Whether a type annotation is the `PageFC` reference.
 */
function isPageFcType(typeNode) {
  return typeNode !== undefined && ts.isTypeReferenceNode(typeNode)
    && typeNode.typeName.kind === ts.SyntaxKind.Identifier
    && typeNode.typeName.text === 'PageFC'
}

/**
 * 收集一个源文件里的全部页面回调：`: PageFC` 标注的函数、defineComponentPage
 * 的第一个函数实参、pages.register 的内联双参回调。
 * Collect every page callback in a source file: `: PageFC` functions, the first
 * function argument of defineComponentPage, and inline two-param pages.register
 * callbacks.
 */
function collectPageFunctions(sourceFile) {
  const pages = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile)
      const first = node.arguments[0]
      if (callee === 'defineComponentPage' && first !== undefined && ts.isFunctionLike(first)) {
        pages.push(first)
      }
      // 内联注册才进扫描：pages.register(namedRef) 的组件定义在别处
      // Only inline registration is scanned: a named reference is defined elsewhere.
      if (callee === 'pages.register' && first !== undefined
        && ts.isFunctionLike(first) && first.parameters.length >= 2) {
        pages.push(first)
      }
    }
    // `: PageFC` 标注：变量初始化为函数、函数声明/表达式自身返回 PageFC
    // `: PageFC` annotations: function-typed variable initializers and functions returning PageFC.
    if (ts.isVariableDeclaration(node) && isPageFcType(node.type)
      && node.initializer !== undefined && ts.isFunctionLike(node.initializer)) {
      pages.push(node.initializer)
    }
    if (ts.isFunctionLike(node) && isPageFcType(node.type)) pages.push(node)
    // 对象字面量/类字段形态 `Page: PageFC = fn`
    // Object literal / class property form `Page: PageFC = fn`.
    if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
      && isPageFcType(node.type) && node.initializer !== undefined
      && ts.isFunctionLike(node.initializer)) {
      pages.push(node.initializer)
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return pages
}

/**
 * 解析表达式在页面作用域下相对 ctx 的路径；rooted 表示确实以页面 ctx 为根。
 * Resolve an expression's path relative to the page ctx; rooted means it really
 * is rooted at the page ctx.
 */
function resolvePath(node, env, sourceFile) {
  if (ts.isIdentifier(node)) {
    if (env.ctxNames.has(node.text)) return { rooted: true, path: [] }
    if (env.members.has(node.text)) return { rooted: true, path: env.members.get(node.text) }
    return null
  }
  const prop = ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)
    ? node.name.text
    : (ts.isElementAccessExpression(node) || ts.isElementAccessChain(node))
      && node.argumentExpression !== undefined
      && ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : null
  if (prop === null) return null
  const base = resolvePath(node.expression, env, sourceFile)
  return base === null ? null : { rooted: base.rooted, path: [...base.path, prop] }
}

/**
 * 深拷贝作用域环境（进入新函数作用域时用）。
 * Deep-clone a scope environment (used when entering a nested function).
 */
const cloneEnv = (env) => ({ ctxNames: new Set(env.ctxNames), members: new Map(env.members) })

/**
 * 在页面函数体内找禁用调用。
 * Find forbidden calls inside one page function body.
 */
function scanPageFunction(pageFn, sourceFile) {
  const hits = []
  const enter = (env, name) => { env.ctxNames.delete(name); env.members.delete(name) }
  const walk = (node, env) => {
    if (ts.isFunctionLike(node)) {
      const inner = cloneEnv(env)
      for (const param of node.parameters) {
        // 遮蔽：内层函数自己的 ctx/同名成员参数不再是页面 ctx
        // Shadowing: a nested function's own ctx/member params are not the page ctx.
        if (ts.isIdentifier(param.name)) enter(inner, param.name.text)
      }
      walkChildren(node, inner)
      return env
    }
    // 别名/解构绑定跟随兄弟语句：`const c = ctx` 之后，同一块里的后续语句都能看到别名
    // Alias/destructure bindings follow sibling statements: statements after
    // `const c = ctx` in the same block see the alias too.
    const env2 = ts.isVariableStatement(node)
      ? node.declarationList.declarations.reduce((acc, d) => bindDeclaration(d, acc), cloneEnv(env))
      : env
    if (ts.isCallExpression(node)) {
      const resolved = resolvePath(node.expression, env, sourceFile)
      if (resolved !== null && resolved.rooted) {
        const api = FORBIDDEN_PATHS.get(resolved.path.join(','))
        if (api !== undefined) hits.push({ node, api })
      }
    }
    walkChildren(node, env2)
    return env2
  }
  // 逐兄弟传递环境：语句的绑定对它后面的兄弟生效（变量声明是语句级作用域）
  // Thread the env across siblings: a statement's bindings apply to its later
  // siblings (declarations are block-scoped).
  const walkChildren = (node, env) => {
    let current = env
    node.forEachChild((child) => {
      current = walk(child, current)
    })
  }
  const root = {
    ctxNames: new Set(pageFn.parameters.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.text)),
    members: new Map(),
  }
  if (pageFn.body !== undefined) walk(pageFn.body, root)
  return hits
}

/**
 * 处理 `const c = ctx`（别名）、`const { effect, tools } = ctx`、
 * `const { register } = ctx.tools`（成员解构），返回扩展后的作用域环境。
 * Handle `const c = ctx` (alias), `const { effect, tools } = ctx`, and
 * `const { register } = ctx.tools` (member destructuring); return the extended scope env.
 */
function bindDeclaration(node, env) {
  const inner = cloneEnv(env)
  if (node.initializer === undefined) return inner
  const init = resolvePath(node.initializer, env, node.getSourceFile())
  if (init === null || !init.rooted) return inner
  if (ts.isIdentifier(node.name)) {
    inner.ctxNames.add(node.name.text) // 整体别名 / whole-object alias
  } else if (ts.isObjectBindingPattern(node.name)) {
    for (const element of node.name.elements) {
      if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue
      const key = element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text
      inner.members.set(element.name.text, [...init.path, key])
    }
  }
  return inner
}

/**
 * 在源码文本里找页面回调中的禁用调用（按位置去重、按行序输出）。
 * Find forbidden calls in page callbacks within a source text (deduped by
 * position, ordered by line).
 * @param {string} source - 源码文本 / source text
 * @returns {Array<{ line: number; api: string; text: string }>} 命中 / hits
 */
export function findForbiddenPageCalls(source) {
  const sourceFile = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const seen = new Set()
  const hits = []
  for (const pageFn of collectPageFunctions(sourceFile)) {
    for (const { node, api } of scanPageFunction(pageFn, sourceFile)) {
      const pos = node.getStart(sourceFile)
      const { line } = sourceFile.getLineAndCharacterOfPosition(pos)
      const key = `${line + 1}:${api}`
      if (seen.has(key)) continue
      seen.add(key)
      const lineText = source.split(/\r?\n/)[line].trim()
      hits.push({ line: line + 1, api, text: lineText })
    }
  }
  return hits.sort((a, b) => a.line - b.line)
}

/**
 * 递归收集某个 `src` 下的 ts/tsx。
 * Collect ts/tsx files under one `src`.
 * @param {string} dir - 目录 / directory
 * @returns {Promise<string[]>} 文件路径 / file paths
 */
async function sourceFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...await sourceFiles(path))
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

/** 扫描全部工作区并打印违规；有命中时退出码 1 / scan and exit 1 on hits */
async function main() {
  const failures = []
  for (const group of SCAN_GROUPS) {
    let packages
    try {
      packages = await readdir(join(ROOT, group), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of packages) {
      if (!entry.isDirectory()) continue
      for (const file of await sourceFiles(join(ROOT, group, entry.name, 'src'))) {
        const hits = findForbiddenPageCalls(await readFile(file, 'utf8'))
        for (const hit of hits) failures.push({ file, ...hit })
      }
    }
  }
  if (failures.length === 0) {
    console.log('check-page-api: page files use ctx.page.* only / 页面文件只用 ctx.page.*')
    return
  }
  for (const failure of failures) {
    console.error(`${relative(ROOT, failure.file)}:${failure.line}: use ${failure.api} instead of ${failure.text}`)
  }
  process.exitCode = 1
}

// 仅在直接执行时跑扫描（被自测 import 时不执行）
// Run the scan only when executed directly (not when imported by the self-test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
