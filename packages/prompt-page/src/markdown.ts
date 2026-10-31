/**
 * Markdown 序列化器（C5/§3.2）：页面组件的元素树 → 模型可读的 Markdown。
 * 一次性渲染形态：组件体恰好执行一次，产物即刻成型——没有 fiber、没有调和、
 * 没有 diff/PAGE-PATCH。唯一的保真要求：嵌套组件在序列化前已展开（展平遍历
 * 直接调用组件函数），结构（ul→li、table→tr）因此真实存在。
 * The Markdown serializer (C5/§3.2): the page component's element tree →
 * model-readable Markdown. One-shot form: the component body runs exactly once
 * and its output is final — no fibers, no reconciler, no diff/PAGE-PATCH. The
 * only fidelity requirement: nested components are expanded before
 * serialization (the flattening walk invokes component functions directly), so
 * structure (ul→li, table→tr) really exists.
 * @module @veren/prompt-page/markdown
 */
import type { Component, ElementInput, PromptElement } from '@veren/prompt-core'

/** Markdown 特殊字符转义（行内文本；只转义行内确有语义的字符——`#`/`-`/`>` 的结构语义仅在线首，由 escapeLineStart 处理）
 * / escaping for inline Markdown special characters (only chars with real inline semantics; `#`/`-`/`>` are line-start structural and handled by escapeLineStart) */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_\[\]<>|])/g, '\\$1')
}

/** 行首结构字符转义：单元文本以 `#`/`-`/`>`/`!`/`=`/`|` 开头时前置反斜杠，避免被读成结构
 * / escape line-start structural characters: prefix a backslash when a unit's text starts with `#`/`-`/`>`/`!`/`=`/`|` */
function escapeLineStart(text: string): string {
  return /^[#>!=|-]/.test(text) ? `\\${text}` : text
}

/** 块级标签集合 / the block tag set */
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'hr', 'pre', 'table', 'div', 'section', 'article'])

/** 展平后的节点：宿主元素或原始文本值 / a flattened node: a host element or a raw text value */
type FlatNode = PromptElement | string | number

/**
 * 展平：数组摊平、空值丢弃、组件元素**就地调用展开**（一次性渲染没有调和器，
 * 组件函数即展开器）。产物只含宿主元素与原始文本值——与"reconcile 后的树"
 * 同一不变量。
 * Flatten: arrays spread, empties dropped, component elements are **invoked in
 * place** (a one-shot render has no reconciler; the component function IS the
 * expander). The output holds only host elements and raw text values — the
 * same invariant as a post-reconcile tree.
 */
function flattenNodes(input: unknown): FlatNode[] {
  if (input === null || input === undefined || typeof input === 'boolean') return []
  if (typeof input === 'string' || typeof input === 'number') return [input]
  if (Array.isArray(input)) return input.flatMap((node) => flattenNodes(node))
  const element = input as PromptElement
  if (typeof element.type === 'function') {
    return flattenNodes((element.type as Component<never>)(element.props as never))
  }
  return [element]
}

/** 元素的标签名（host 元素才有；组件已被展平）/ the element's tag (host elements only; components are flattened) */
function tagOf(node: FlatNode): string | undefined {
  return typeof node === 'object' && typeof node.type === 'string' ? node.type : undefined
}

/** `<text>` 元素的 content（或原始字符串本身）/ a `<text>` element's content (or the raw string itself) */
function textContentOf(node: FlatNode): string {
  return typeof node === 'object' ? String((node.props as { content?: unknown }).content ?? '') : String(node)
}

/** children 的展平形态 / the element's flattened children */
function childrenOf(node: FlatNode): FlatNode[] {
  return typeof node === 'object' ? flattenNodes((node.props as { children?: unknown }).children) : []
}

/** 行内序列化：text/strong/em/code/del/a/br 与未知标签（降级为子内容）
 * / inline serialization: text/strong/em/code/del/a/br and unknown tags (degrading to children) */
function serializeInline(nodes: readonly FlatNode[], inline: { text: string }): void {
  for (const node of nodes) {
    const kind = tagOf(node)
    if (kind === undefined) {
      // 原始字符串/数字：行内文本 / a raw string/number: inline text
      inline.text += escapeInline(String(node))
      continue
    }
    const children = childrenOf(node)
    if (kind === 'text') {
      inline.text += escapeInline(textContentOf(node))
      continue
    }
    if (serializeMarked(kind, children, inline)) continue
    if (kind === 'a') {
      serializeAnchor(node, children, inline)
      continue
    }
    if (kind === 'br') {
      inline.text += '  \n'
      continue
    }
    serializeInline(children, inline) // 未知/块级标签行内降级：只渲染子内容（全函数）/ unknown or block tags degrade inline: children only
  }
}

/** 行内标签 → 对称包裹标记 / an inline tag → its symmetric wrapping marker */
function inlineMarkOf(kind: string): string | undefined {
  switch (kind) {
    case 'strong':
    case 'b':
      return '**'
    case 'em':
    case 'i':
      return '*'
    case 'del':
      return '~~'
    case 'code':
      return '`'
    default:
      return undefined
  }
}

/** 对称标记的行内样式（strong/em/del/code）：true = 已处理 / the symmetric-marker styles (strong/em/del/code): true = handled */
function serializeMarked(kind: string, children: readonly FlatNode[], inline: { text: string }): boolean {
  const mark = inlineMarkOf(kind)
  if (mark === undefined) return false
  inline.text += mark
  serializeInline(children, inline)
  inline.text += mark
  return true
}

/** 链接：`[children](href)` / a link: `[children](href)` */
function serializeAnchor(node: FlatNode, children: readonly FlatNode[], inline: { text: string }): void {
  const href = typeof node === 'object' ? String((node.props as { href?: unknown }).href ?? '') : ''
  inline.text += `[`
  serializeInline(children, inline)
  inline.text += `](${href})`
}

/** 节点列表 → 行内文本 / a node list → inline text */
function inlineOf(nodes: readonly FlatNode[]): string {
  const inline = { text: '' }
  serializeInline(nodes, inline)
  return inline.text
}

/** 块级遍历产出段落；嵌套列表缩进两格 / the block walk emits paragraphs; nested lists indent two spaces */
function walkBlocks(nodes: readonly FlatNode[], units: string[], depth: number): void {
  for (const node of nodes) {
    const kind = tagOf(node)
    const indent = '  '.repeat(depth)
    if (kind === undefined) {
      // 块级的原始文本：转义成段 / block-level raw text: an escaped paragraph
      units.push(escapeInline(String(node)))
      continue
    }
    const children = childrenOf(node)
    const headingMatch = /^h([1-6])$/.exec(kind)
    if (headingMatch !== null) {
      units.push(`${'#'.repeat(Number(headingMatch[1]))} ${escapeLineStart(inlineOf(children))}`)
      continue
    }
    if (walkList(kind, children, units, depth)) continue
    if (kind === 'table') {
      units.push(`${indent}${tableToGfm(children)}`)
      continue
    }
    if (kind === 'text') {
      units.push(escapeInline(textContentOf(node)))
      continue
    }
    walkSimpleBlock(kind, children, units, indent, depth)
  }
}

/** ul/ol → 缩进列表项；返回 true = 本节点已处理 / ul/ol → indented list items; true = the node is handled */
function walkList(kind: string, children: readonly FlatNode[], units: string[], depth: number): boolean {
  if (kind !== 'ul' && kind !== 'ol') return false
  const indent = '  '.repeat(depth)
  const ordered = kind === 'ol'
  let index = 0
  for (const li of children) {
    if (tagOf(li) !== 'li') {
      walkBlocks([li], units, depth) // ul 直下非 li：按块宽松降级 / a non-li under ul: degrade as a block
      continue
    }
    index++
    const marker = ordered ? `${index}.` : '-'
    const [own, deeper] = splitListParts(childrenOf(li))
    units.push(`${indent}${marker} ${inlineOf(own).trimEnd()}`)
    walkBlocks(deeper, units, depth + 1)
  }
  return true
}

/** li 的子节点分拣：直接行内子树折进行首，嵌套列表（ul/ol 子元素）下移一层
 * / sort an li's children: the direct inline subtree folds into the marker line, nested lists go a level deeper */
function splitListParts(parts: readonly FlatNode[]): [FlatNode[], FlatNode[]] {
  const own: FlatNode[] = []
  const deeper: FlatNode[] = []
  for (const part of parts) {
    const partKind = tagOf(part)
    if (partKind === 'ul' || partKind === 'ol') deeper.push(part)
    else own.push(part)
  }
  return [own, deeper]
}

/** 简单块与透明容器的收尾路径（p/blockquote/hr/pre + default）/ the simple-block and transparent-container tail (p/blockquote/hr/pre + default) */
function walkSimpleBlock(
  kind: string,
  children: readonly FlatNode[],
  units: string[],
  indent: string,
  depth: number,
): void {
  switch (kind) {
    case 'p':
      units.push(inlineOf(children))
      return
    case 'blockquote':
      units.push(`${indent}> ${inlineOf(children)}`)
      return
    case 'hr':
      units.push(`${indent}---`)
      return
    case 'pre':
      walkPre(children, units, indent)
      return
    default:
      walkTransparent(children, units, depth)
  }
}

/** pre → 围栏块（原文不转义，剥掉行内转义）/ pre → a fenced block (raw text, inline escapes stripped) */
function walkPre(children: readonly FlatNode[], units: string[], indent: string): void {
  const raw = inlineOf(children).replace(/\\([\\`*_{}[\]()#+.!>|])/g, '$1')
  units.push(`${indent}\`\`\`\n${raw.trim()}\n${indent}\`\`\``)
}

/** 透明容器（div/section/未知标签）：含块级子则按块继续；仅行内则折叠成段落（策略位：全函数降级）
 * / transparent containers (div/section/unknown): block children continue as blocks; inline-only folds into one paragraph */
function walkTransparent(children: readonly FlatNode[], units: string[], depth: number): void {
  const hasBlockChild = children.some((child) => {
    const childKind = tagOf(child)
    return childKind !== undefined && (BLOCK_TAGS.has(childKind) || /^h[1-6]$/.test(childKind))
  })
  if (hasBlockChild) walkBlocks(children, units, depth)
  else units.push(inlineOf(children))
}

/** table → GFM（首行表头）/ table → GFM (first row as the header) */
function tableToGfm(rows: readonly FlatNode[]): string {
  const table: FlatNode[] = []
  for (const node of rows) {
    const kind = tagOf(node)
    if (kind === 'tr') table.push(node)
    else if (kind === 'thead' || kind === 'tbody') table.push(...childrenOf(node))
  }
  const cellsOf = (row: FlatNode): string[] =>
    childrenOf(row)
      .filter((cell) => tagOf(cell) === 'th' || tagOf(cell) === 'td')
      .map((cell) => inlineOf(childrenOf(cell)).replace(/\|/g, '\\|').replace(/\n/g, ' '))
  if (table.length === 0) return ''
  const [head, ...body] = table
  const headCells = cellsOf(head!)
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  const lines = [line(headCells), `| ${headCells.map(() => '---').join(' | ')} |`]
  for (const row of body) lines.push(line(cellsOf(row)))
  return lines.join('\n')
}

/**
 * 元素树 → Markdown 正文（段落序列，空行连接）。WYSIWYG 的实现核心：组件 JSX
 * 写什么标签，模型就读到什么 Markdown。一次性渲染的唯一出口。
 * The element tree → the Markdown body (paragraphs joined by blank lines). The
 * core of WYSIWYG: whatever tags the component's JSX writes, the model reads
 * that Markdown. The single exit of a one-shot render.
 */
export function elementsToMarkdown(input: ElementInput | undefined): string {
  const units: string[] = []
  walkBlocks(flattenNodes(input), units, 0)
  return units.join('\n\n')
}
