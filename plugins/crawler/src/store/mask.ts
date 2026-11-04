/**
 * 匿名化脱敏：人物标识哈希化与昵称遮蔽（架构铁律 3）。
 * Anonymization: creator hashing and nickname masking (architecture
 * invariant 3 — every persisted person identifier passes through here).
 *
 * 明文可识别字段不得出现在任何落地介质中。
 * Plain identifiable fields must never reach any persistence medium.
 *
 * @module @veren/crawler/store/mask
 */
import { createHash } from 'node:crypto'

/**
 * 人物标识匿名哈希：SHA-256 截断 16 位十六进制（design/data.md）。
 * Anonymized creator hash: SHA-256 truncated to 16 hex chars (design/data.md).
 *
 * @param identifier - 明文人物标识 / the plain identifier
 * @returns 16 位哈希十六进制串 / the 16-char hash hex
 */
export function creatorHash(identifier: string): string {
  return createHash('sha256').update(identifier, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 昵称遮蔽：首尾各留一字，中间以星号替代；单字昵称原样保留会被识别，
 * 因此单字返回「字*」以维持不可识别性。
 * Masking: keep the first and last chars and replace the middle with stars;
 * a single-char nickname would stay identifiable, so it becomes "字*".
 *
 * @param nickname - 明文昵称 / the plain nickname
 * @returns 遮蔽后的昵称 / the masked nickname
 */
export function maskNickname(nickname: string): string {
  const chars = Array.from(nickname.trim())
  if (chars.length <= 1) return chars.length === 1 ? `${chars[0]}*` : ''
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`
}
