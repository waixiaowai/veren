/**
 * Deterministic reader for one answer to the stranger-intake question.
 *
 * This is a shape check, not a language model: it accepts a whole-line name, a
 * small set of explicit self-introduction prefixes, or an unmistakable contact
 * pattern. Anything uncertain returns `undefined`, so a wrong guess is never
 * written into the people directory.
 *
 * 陌生人询问回答的确定性解析器。
 *
 * 这是形状检查，不是语言模型：只接受整行姓名、少量明确的自述前缀，或不会认错的联系方式格式。
 * 任何不确定内容返回 `undefined`，错误猜测永远不会写进人员名单。
 *
 * @module @veren/im/intake-parser
 */

import type { ImPersonContact } from './contract.ts'

/** One parsed self-report. Contacts are already normalized. */
export interface ParsedSelfReport {
  name?: string
  contacts: ImPersonContact[]
}

const MAX_REPLY_CHARS = 500
const MAX_BARE_CJK_NAME = 4
const MAX_PREFIXED_CJK_NAME = 12
const MAX_LATIN_NAME = 40

/** Replies that are a clear refusal; they end the intake immediately. */
const OPT_OUTS = new Set(['不方便', '不用了', '不用', '算了', '不想说', '没必要', '不需要'])
/** Whole replies that are acknowledgements, not names. */
const NON_NAMES = new Set([
  '好', '好的', '嗯', '嗯嗯', '行', '可以', '谢谢', '谢谢你', '你好', '您好', '在', '在吗', '在的',
  '没有', '收到', '知道了', '没事', '谁', '谁啊', '你是谁', '哈哈', '哈哈哈', 'ok', 'okay', 'hi',
  'hello', 'hey', 'yes', 'no', 'thanks', 'thank you', 'fine',
])
/** A name never contains these; their presence means the line says more than a name. */
const NON_NAME_MARKERS = ['你好', '您好', '在吗', '谢谢', '好的', '请问', '你是谁', '不方便', '不用了', '算了']
/** Explicit self-introduction prefixes; `我是` is excluded because "我是学生" is not a name. */
const NAME_PREFIX = /^(?:我叫|叫我|名字叫|名字是|称呼我|my name is|call me|this is)\s*[:：，,]?\s*/iu
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u
const PHONE_LABELED = /(?:电话|手机|手机号|电话号码|联系方式|contact|phone)\s*[:：是为]?\s*(\+?[\d][\d\s-]{6,20}\d)/iu
const PHONE_BARE = /^\+?\d[\d\s-]{6,20}\d$/u
const WECHAT_LABELED = /(?:微信号|微信|wechat|vx)\s*[:：是为]?\s*([A-Za-z][-_A-Za-z0-9]{5,19})/iu
const BAD_NAME_CHARS = /[\d@#$%^&*_+=[\]{}|\\/<>~`!?;:，。！？、；：]/u
const PRONOUN_START = /^[我你他她它]/u

/** Collapse one reply to one line; provider text is untrusted. */
export function oneLine(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Normalize a reply for comparison. */
export function comparisonKey(value: string): string {
  return oneLine(value).toLocaleLowerCase()
}

/** Whether a reply is a clear refusal rather than an answer. */
export function isOptOut(text: string): boolean {
  return OPT_OUTS.has(comparisonKey(text))
}

/** Strip wrapping quotes a human might type around a name. */
function unquote(value: string): string {
  return value.replace(/^["'“”‘’《》]+|["'“”‘’《》]+$/gu, '').trim()
}

/**
 * Accept one name-shaped string, or return `undefined`.
 *
 * Digits, sentence punctuation, greetings, and multi-sentence text are
 * rejected. A bare Chinese name is limited more tightly than a prefixed one
 * because a bare reply carries no evidence that it answers "what should I call
 * you".
 * 接受一个姓名形状的字符串，否则返回 undefined。
 *
 * 数字、句读、问候语与多句文本一律拒绝。裸中文名比带前缀的名字限制更紧，因为裸回复没有证据
 * 表明它是在回答「怎么称呼你」。
 */
function nameOf(value: string, maxCjk: number): string | undefined {
  const text = unquote(value)
  if (text === '' || text.length > MAX_LATIN_NAME) return undefined
  if (NON_NAMES.has(comparisonKey(text)) || NON_NAME_MARKERS.some(marker => text.includes(marker))) {
    return undefined
  }
  // A reply that starts with a pronoun is a sentence about someone, not a name
  // ("我是学生", "你是谁").
  // 以代词开头的回复是一句关于某人的话，不是名字（「我是学生」「你是谁」）。
  if (PRONOUN_START.test(text)) return undefined
  if (BAD_NAME_CHARS.test(text)) return undefined
  const compact = [...text.replace(/\s+/g, '')]
  const cjk = compact.filter(char => /\p{Script=Han}/u.test(char)).length
  if (cjk > 0) {
    if (!compact.every(char => /\p{Script=Han}/u.test(char) || char === '·' || char === '•')) return undefined
    return cjk >= 2 && cjk <= maxCjk ? text : undefined
  }
  if (!/^\p{L}[\p{L}.' -]*$/u.test(text)) return undefined
  const letters = text.replace(/[^\p{L}]/gu, '')
  const words = text.split(/\s+/).filter(Boolean)
  return letters.length >= 2 && words.length <= 4 ? text : undefined
}

/** Read one phone number only when it has a plausible digit count. */
function phoneOf(raw: string): ImPersonContact | undefined {
  const value = raw.trim().replace(/\s+/g, ' ')
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return undefined
  return { kind: 'phone', value }
}

/** Extract contacts that cannot be mistaken for prose. */
function contactsOf(text: string): ImPersonContact[] {
  const contacts: ImPersonContact[] = []
  const email = EMAIL.exec(text)?.[0]
  if (email !== undefined) contacts.push({ kind: 'email', value: email })
  const labeled = PHONE_LABELED.exec(text)?.[1]
  const bare = PHONE_BARE.test(text) ? text : undefined
  const phone = phoneOf(labeled ?? bare ?? '')
  if (phone !== undefined && !contacts.some(item => item.kind === 'phone')) contacts.push(phone)
  const wechat = WECHAT_LABELED.exec(text)?.[1]
  if (wechat !== undefined) contacts.push({ kind: 'wechat', value: wechat })
  return contacts
}

/**
 * Read the name after an explicit prefix. The name ends at punctuation, or at
 * the first whitespace when the text is Chinese; a following contact sentence
 * must not turn the name into a failed match.
 * 读取明确前缀之后的名字。名字在标点处结束；中文文本在第一个空白处结束；后面的联系方式句子
 * 不能让名字整体匹配失败。
 */
function prefixedName(rest: string): string | undefined {
  const cut = rest.search(/[，,。；;：:\n]/u)
  const head = (cut < 0 ? rest : rest.slice(0, cut)).trim()
  const candidate = /\p{Script=Han}/u.test(head) && head.includes(' ')
    ? head.split(/\s+/)[0]!
    : head
  return nameOf(candidate, MAX_PREFIXED_CJK_NAME)
}

/**
 * Parse one reply. Only a clearly stated name and/or an unmistakable contact
 * survives; everything else returns `undefined`.
 * 解析一条回复。只有明确说出的姓名和/或不会认错的联系方式会保留；其余返回 undefined。
 * @param text - One inbound text reply.
 * @returns the parsed report, or `undefined` when the reply is not usable.
 */
export function parseSelfReport(text: string): ParsedSelfReport | undefined {
  const flat = oneLine(text).slice(0, MAX_REPLY_CHARS)
  if (flat === '') return undefined
  const contacts = contactsOf(flat)
  const prefix = NAME_PREFIX.exec(flat)
  const name = prefix === null
    ? nameOf(flat, MAX_BARE_CJK_NAME)
    : prefixedName(flat.slice(prefix[0].length))
  if (name === undefined && contacts.length === 0) return undefined
  return { ...(name === undefined ? {} : { name }), contacts }
}
