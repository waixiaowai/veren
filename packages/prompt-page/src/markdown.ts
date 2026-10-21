/**
 * Markdown 序列化器（C5/§3.2）：组件 fiber 树 → 模型可读的 Markdown。
 * The Markdown serializer (C5/§3.2): the component fiber tree → model-readable
 * Markdown.
 *
 * 序列化走 **reconcile 后的 fiber 树**而不是原始元素——嵌套组件必须在树里已展开，
 * 结构（ul→li、table→tr）才真实存在。三件事：
 * - **序列化**（`fibersToMarkdown`）：按 §3.2 映射表产出正文；块级标签产出"单元"
 *   （补丁的对账单位），行内标签折进所在单元；
 * - **diff**（`diffMarkdownUnits`）：变化即补丁——新单元按 key 对位，文本变化或
 *   新增进 upsert，消失的 keyed 单元进 removal（`~~key~~` 删除线）；
 * - **文档宿主**（`MarkdownDocHost`）：PageSession.host 结构面的实现——首帧产出
 *   body（进 PAGE 块），后续渲染产出 PAGE-PATCH（经 app-host 注入通道进历史）。
 * Serialization walks the **post-reconcile fiber tree**, not raw elements —
 * nested components must already be expanded and the structure (ul→li,
 * table→tr) must really exist. Three pieces:
 * - **serialize** (`fibersToMarkdown`): emit the body per the §3.2 mapping;
 *   block tags produce "units" (the patch reconciliation unit), inline tags
 *   fold into their unit;
 * - **diff** (`diffMarkdownUnits`): change means patch — new units match by key;
 *   changed/added go to upserts, vanished keyed units to removals (`~~key~~`);
 * - **doc host** (`MarkdownDocHost`): implements PageSession.host's structural
 *   face — the first frame produces the body (into the PAGE block), later
 *   renders produce PAGE-PATCHes (into history via app-host's injection).
 * @module @veren/prompt-page/markdown
 */
import type { Fiber } from '@veren/prompt-core'
import type { Sync } from '@veren/prompt-host-messages'

/** 一个补丁对账单元：可选 key（keyed 元素）+ 渲染出的 Markdown 文本
 * / one patch reconciliation unit: optional key (a keyed element) + rendered Markdown text */
export interface MarkdownUnit {
  readonly key?: string
  readonly text: string
}

/** 行内序列化缓冲 / the inline serialization buffer */
interface Inline {
  text: string
}

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

/** 行内标签集合 / the inline tag set */
const INLINE_TAGS = new Set(['text', 'strong', 'b', 'em', 'i', 'del', 'code', 'a', 'br', 'span'])
/** 块级标签集合 / the block tag set */
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'hr', 'pre', 'table', 'div', 'section', 'article'])

/** 兄弟链遍历 / walk a sibling chain */
function eachSibling(first: Fiber | null, visit: (fiber: Fiber) => void): void {
  for (let fiber = first; fiber !== null; fiber = fiber.sibling) visit(fiber)
}

/** 行内序列化：text/strong/em/code/del/a/br 与未知标签（降级为子内容）
 * / inline serialization: text/strong/em/code/del/a/br and unknown tags (degrading to children) */
function serializeInlineFiber(first: Fiber | null, inline: Inline): void {
  eachSibling(first, (fiber) => {
    if (fiber.tag === 'component') {
      serializeInlineFiber(fiber.child, inline)
      return
    }
    const kind = fiber.instance!.kind
    const inlineChild = (): void => serializeInlineFiber(fiber.child, inline)
    switch (kind) {
      case 'text':
        inline.text += escapeInline(String(fiber.instance!.props.content ?? ''))
        return
      case 'strong':
      case 'b':
        inline.text += '**'
        inlineChild()
        inline.text += '**'
        return
      case 'em':
      case 'i':
        inline.text += '*'
        inlineChild()
        inline.text += '*'
        return
      case 'del':
        inline.text += '~~'
        inlineChild()
        inline.text += '~~'
        return
      case 'code':
        inline.text += '`'
        inlineChild()
        inline.text += '`'
        return
      case 'a':
        inline.text += `[`
        inlineChild()
        inline.text += `](${String(fiber.instance!.props.href ?? '')})`
        return
      case 'br':
        inline.text += '  \n'
        return
      default:
        inlineChild() // 未知/块级标签行内降级：只渲染子内容（全函数）/ unknown or block tags degrade inline: children only
    }
  })
}

/** fiber 子树 → 行内文本 / a fiber subtree → inline text */
function inlineOf(fiber: Fiber | null): string {
  const inline: Inline = { text: '' }
  serializeInlineFiber(fiber, inline)
  return inline.text
}

/** 块级遍历产出单元；嵌套列表缩进两格，key 沿 keyed 元素透传
 * / the block walk emits units; nested lists indent; keys ride keyed elements */
function walkBlocks(first: Fiber | null, units: MarkdownUnit[], depth: number): void {
  eachSibling(first, (fiber) => {
    if (fiber.tag === 'component') {
      walkBlocks(fiber.child, units, depth)
      return
    }
    const kind = fiber.instance!.kind
    const key = fiber.key
    const indent = '  '.repeat(depth)
    const headingMatch = /^h([1-6])$/.exec(kind)
    if (headingMatch !== null) {
      units.push({ key, text: `${'#'.repeat(Number(headingMatch[1]))} ${escapeLineStart(inlineOf(fiber.child))}` })
      return
    }
    switch (kind) {
      case 'p':
        units.push({ key, text: inlineOf(fiber.child) })
        return
      case 'ul':
      case 'ol': {
        const ordered = kind === 'ol'
        let index = 0
        eachSibling(fiber.child, (li) => {
          if (li.instance?.kind !== 'li') {
            walkBlocks(li, units, depth) // ul 直下非 li：按块宽松降级 / a non-li under ul: degrade as a block
            return
          }
          index++
          const marker = ordered ? `${index}.` : '-'
          // li 的直接行内子树折进行首；嵌套列表（ul/ol 子 fiber）下移一层
          // / li's direct inline subtree folds into the marker line; nested lists go a level deeper
          let own = ''
          let deeperFirst: Fiber | null = null
          let deeperTail: Fiber | null = null
          eachSibling(li.child, (part) => {
            const partKind = part.instance?.kind
            if (part.tag === 'host' && (partKind === 'ul' || partKind === 'ol')) {
              if (deeperTail === null) {
                deeperFirst = part
              } else {
                deeperTail.sibling = part
              }
              deeperTail = part
              return
            }
            own += inlineOf(part)
          })
          units.push({ key: li.key, text: `${indent}${marker} ${own.trimEnd()}` })
          walkBlocks(deeperFirst, units, depth + 1)
        })
        return
      }
      case 'blockquote':
        units.push({ key, text: `${indent}> ${inlineOf(fiber.child)}` })
        return
      case 'hr':
        units.push({ key, text: `${indent}---` })
        return
      case 'pre': {
        // pre → 围栏块（原文不转义）/ a fenced block (raw text, no escaping)
        const raw = inlineOf(fiber.child).replace(/\\([\\`*_{}[\]()#+.!>|])/g, '$1')
        units.push({ key, text: `${indent}\`\`\`\n${raw.trim()}\n${indent}\`\`\`` })
        return
      }
      case 'table':
        units.push({ key, text: `${indent}${tableToGfm(fiber.child)}` })
        return
      case 'text':
        units.push({ key, text: escapeInline(String(fiber.instance!.props.content ?? '')) })
        return
      default: {
        // 透明容器（div/section/未知标签）：含块级子则按块继续；仅行内则折叠成段落（策略位：全函数降级）
        // / transparent containers (div/section/unknown): block children continue as blocks; inline-only folds into one paragraph
        let hasBlockChild = false
        eachSibling(fiber.child, (child) => {
          if (child.tag === 'host' && (BLOCK_TAGS.has(child.instance!.kind) || /^h[1-6]$/.test(child.instance!.kind))) {
            hasBlockChild = true
          }
        })
        if (hasBlockChild) {
          walkBlocks(fiber.child, units, depth)
        } else {
          units.push({ key, text: inlineOf(fiber.child) })
        }
      }
    }
  })
}

/** table → GFM（首行表头）/ table → GFM (first row as the header) */
function tableToGfm(firstRow: Fiber | null): string {
  const rows: Fiber[] = []
  eachSibling(firstRow, (fiber) => {
    if (fiber.instance?.kind === 'tr') rows.push(fiber)
    else if (fiber.instance?.kind === 'thead' || fiber.instance?.kind === 'tbody') eachSibling(fiber.child, (row) => rows.push(row))
  })
  const cellsOf = (row: Fiber): string[] => {
    const cells: string[] = []
    eachSibling(row.child, (cell) => {
      if (cell.instance?.kind === 'th' || cell.instance?.kind === 'td') cells.push(inlineOf(cell.child).replace(/\|/g, '\\|').replace(/\n/g, ' '))
    })
    return cells
  }
  if (rows.length === 0) return ''
  const [head, ...body] = rows
  const headCells = cellsOf(head)
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  const lines = [line(headCells), `| ${headCells.map(() => '---').join(' | ')} |`]
  for (const row of body) lines.push(line(cellsOf(row)))
  return lines.join('\n')
}

/**
 * fiber 树 → Markdown 正文（单元序列，空行连接）。WYSIWYG 的实现核心：组件
 * JSX 写什么标签，模型就读到什么 Markdown。
 * The fiber tree → the Markdown body (units joined by blank lines). The core of
 * WYSIWYG: whatever tags the component's JSX writes, the model reads that Markdown.
 */
export function fibersToMarkdown(first: Fiber | null): string {
  const units: MarkdownUnit[] = []
  walkBlocks(first, units, 0)
  return units.map((unit) => unit.text).join('\n\n')
}

/** fiber 树 → 单元序列（diff 的输入）/ the fiber tree → the unit sequence (diff input) */
export function fibersToUnits(first: Fiber | null): MarkdownUnit[] {
  const units: MarkdownUnit[] = []
  walkBlocks(first, units, 0)
  return units
}

/** 一次 diff：upsert 单元 + removal（key 或摘录删除线）/ one diff: upsert units + removals (key or excerpt strikethrough) */
export interface MarkdownDiff {
  readonly upserts: readonly MarkdownUnit[]
  readonly removals: readonly string[]
}

/** 变化即补丁：新旧单元按 key 对位；无变化返回 null / change means patch: old/new units matched by key; null when unchanged */
export function diffMarkdownUnits(before: readonly MarkdownUnit[], after: readonly MarkdownUnit[]): MarkdownDiff | null {
  const upserts: MarkdownUnit[] = []
  const removals: string[] = []
  const oldByKey = new Map<string, MarkdownUnit>()
  const oldUnkeyed: MarkdownUnit[] = []
  for (const unit of before) {
    if (unit.key !== undefined) oldByKey.set(unit.key, unit)
    else oldUnkeyed.push(unit)
  }
  const consumedKeys = new Set<string>()
  let unkeyedIndex = 0
  for (const unit of after) {
    const beforeUnit = unit.key !== undefined ? oldByKey.get(unit.key) : oldUnkeyed[unkeyedIndex]
    if (unit.key !== undefined) consumedKeys.add(unit.key)
    else unkeyedIndex++
    if (beforeUnit === undefined || beforeUnit.text !== unit.text) upserts.push(unit)
  }
  for (const [key] of oldByKey) {
    if (!consumedKeys.has(key)) removals.push(`~~${key}~~`)
  }
  for (; unkeyedIndex < oldUnkeyed.length; unkeyedIndex++) {
    const text = oldUnkeyed[unkeyedIndex]!.text
    removals.push(`~~${text.length > 24 ? `${text.slice(0, 23)}…` : text}~~`)
  }
  if (upserts.length === 0 && removals.length === 0) return null
  return { upserts, removals }
}

/** Markdown 文档宿主守卫（page-registry/app-host 的分支用）/ a Markdown doc host guard (for page-registry/app-host branching) */
export function isMarkdownDocHost(host: unknown): host is MarkdownDocHost {
  return host instanceof MarkdownDocHost
}

/**
 * Markdown 文档宿主：PageSession.host 的结构面实现。首帧 body 进 PAGE 块；
 * 后续渲染 diff 出 PAGE-PATCH（版本门控：无变化零注入）。
 * The Markdown doc host: implements PageSession.host's structural face. The
 * first-frame body feeds the PAGE block; later renders diff into PAGE-PATCHes
 * (version-gated: no change → no injection).
 */
export class MarkdownDocHost {
  private units: MarkdownUnit[] = []
  private body = ''
  private commits: Array<{ version: number; text: string }> = []
  private current = 0

  /** 当前版本号（页面会话的 version 门控来源）/ the current version (the page session's gating source) */
  get currentVersion(): number {
    return this.current
  }

  /** 首帧：建立初始 body（版本 1，不产生 patch）/ the first frame: establishes the initial body (version 1, no patch) */
  initialize(first: Fiber | null): void {
    this.units = fibersToUnits(first)
    this.body = this.units.map((unit) => unit.text).join('\n\n')
    this.current = 1
  }

  /** 后续渲染：diff 出 PAGE-PATCH；无变化零开销。body 同步更新（PAGE 块重写场景）
   * / a later render: diffs into a PAGE-PATCH; unchanged → a no-op. The body syncs too (for PAGE-block rewrite scenarios) */
  update(first: Fiber | null): void {
    const units = fibersToUnits(first)
    const diff = diffMarkdownUnits(this.units, units)
    if (diff === null) return
    this.current++
    this.units = units
    this.body = units.map((unit) => unit.text).join('\n\n')
    const lines = [...diff.upserts.map((unit) => unit.text), ...diff.removals]
    this.commits.push({ version: this.current, text: lines.join('\n') })
  }

  /** 初始正文（PAGE 块的 body）/ the initial body (the PAGE block's body) */
  bodyText(): string {
    return this.body
  }

  /** 取 cursor 之后的 PAGE-PATCH 文本；无变化返回 undefined / the PAGE-PATCH text after the cursor; undefined when unchanged */
  takeMarkdownPatch(cursor: number): { readonly text: string; readonly version: number } | undefined {
    const pending = this.commits.filter((commit) => commit.version > cursor)
    if (pending.length === 0) return undefined
    return { text: pending.map((commit) => commit.text).join('\n'), version: this.current }
  }

  /** 结构面兼容（renderSince：Markdown 会话只产 patch 形状；ops 留空——消费方走 takeMarkdownPatch）
   * / structural-face compatibility (renderSince: markdown sessions only produce the patch shape; ops empty — consumers use takeMarkdownPatch) */
  renderSince(cursor?: number): Sync {
    const from = cursor ?? 0
    return { kind: 'patch', fromVersion: from, toVersion: this.current, ops: [] }
  }
}
