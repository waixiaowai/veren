/**
 * The `[[title]]` link grammar: one hand-rolled scanner, no dependency.
 *
 * A `[[` occurrence is a link iff `]]` closes it and the inner text — trimmed —
 * is non-empty, free of `[`, `]`, and newlines, and within the title limit.
 * Everything else is literal text and needs no escape: code like `[[1,2],[3,4]]`
 * fails the inner-text rule because its inner span carries a `]`. A `\[[`
 * escape writes a literal double bracket; the backslash is stored verbatim and
 * only removes link semantics. The scanner never rewrites the body, and titles
 * match exactly (no case folding, no Unicode normalization) — Chinese titles
 * are first-class addresses.
 *
 * `[[标题]]` 链接语法：一个手写扫描器，零依赖。
 *
 * 一处 `[[` 是链接，当且仅当 `]]` 闭合且内文——trim 后——非空、不含 `[`、`]` 与
 * 换行、不超标题上限。其余一切都是字面文本，无需转义：`[[1,2],[3,4]]` 这类代码
 * 因内文带 `]` 自然落回字面。`\[[` 转义写出字面双括号；反斜杠原样存储，仅消除
 * 链接语义。扫描器绝不改写正文；标题精确匹配（不折大小写、不做 Unicode 归一）
 * ——中文标题是一等地址。
 *
 * @module @veren/notebook/links
 */

import { MAX_TITLE_CHARS } from './notes.ts'

/** One link occurrence: the trimmed target title and the `[[…]]` span it occupies. 一次链接出现：trim 后的目标标题与它占据的 `[[…]]` 区间。 */
export interface LinkRef {
  readonly title: string
  readonly offset: number
  readonly end: number
}

/**
 * Extract every link occurrence of one body, in document order.
 * @param body - the stored body, read verbatim.
 * @returns the links it contains; escaped and malformed `[[` never appear.
 */
export function extractLinks(body: string): LinkRef[] {
  const refs: LinkRef[] = []
  let cursor = body.indexOf('[[')
  while (cursor !== -1) {
    if (isEscaped(body, cursor)) {
      cursor = body.indexOf('[[', cursor + 2)
      continue
    }
    const close = body.indexOf(']]', cursor + 2)
    if (close === -1) {
      cursor = body.indexOf('[[', cursor + 2)
      continue
    }
    const title = innerTitle(body.slice(cursor + 2, close))
    if (title === undefined) {
      // Not a link: rescan from one character later so a `[[` opening one
      // position over (e.g. `[[[a]]`) is still found.
      // 不是链接：从后一个字符重新扫描，隔一位开头的 `[[`（如 `[[[a]]`）仍能被找到。
      cursor = body.indexOf('[[', cursor + 1)
      continue
    }
    refs.push({ title, offset: cursor, end: close + 2 })
    cursor = body.indexOf('[[', close + 2)
  }
  return refs
}

/**
 * Rewrite one body's link occurrences of `fromTitle` to `[[toTitle]]`.
 * Escaped and non-link `[[` spans stay verbatim.
 * @param body - the stored body, read verbatim.
 * @param fromTitle - the exact old target title.
 * @param toTitle - the new target title.
 * @returns the rewritten body (identical when no occurrence matches).
 */
export function retargetOccurrences(body: string, fromTitle: string, toTitle: string): string {
  const refs = extractLinks(body).filter(ref => ref.title === fromTitle)
  if (refs.length === 0) return body
  let out = ''
  let cursor = 0
  for (const ref of refs) {
    out += body.slice(cursor, ref.offset) + `[[${toTitle}]]`
    cursor = ref.end
  }
  return out + body.slice(cursor)
}

/** Whether the `[[` at `offset` is escaped by a backslash right before it. `offset` 处的 `[[` 是否被紧邻其前的反斜杠转义。 */
function isEscaped(body: string, offset: number): boolean {
  return offset > 0 && body[offset - 1] === '\\'
}

/** The trimmed inner title, or `undefined` when the inner span is not title-like. 合法时的 trim 后内文标题；内文不像标题时为 `undefined`。 */
function innerTitle(raw: string): string | undefined {
  if (raw.includes('[') || raw.includes(']') || raw.includes('\n') || raw.includes('\r')) return undefined
  const title = raw.trim()
  if (title === '') return undefined
  if ([...title].length > MAX_TITLE_CHARS) return undefined
  return title
}
