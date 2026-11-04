/**
 * B 站 WBI 签名（design/modules/crawler.md §5：bili 纯算法 WBI 签名，
 * 参数级签名——查询串加盐摘要）。
 * The bilibili WBI signature (crawler.md §5: bili uses the pure-algorithm
 * WBI signing — a salted digest over the query string).
 *
 * 算法：从 nav 接口取 img_key/sub_key → 按置换表各取 32 字符得
 * mixin_key → 参数按字典序排序后拼查询串 + wts → md5 即 w_rid。
 * Algorithm: img_key/sub_key from the nav endpoint → 32 chars each via the
 * permutation table → mixin_key; sort params, append wts, md5 = w_rid.
 *
 * @module @veren/crawler/platform/bili/wbi
 */
import { createHash } from 'node:crypto'

/** WBI 密钥置换表（64 → 32）/ the WBI key permutation table (64 → 32) */
const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
]

/** nav 接口返回的 WBI 密钥对 / the wbi key pair from the nav endpoint */
export interface WbiKeys {
  imgKey: string
  subKey: string
}

/** 签名后的查询串 / the signed query string */
export interface SignedQuery {
  /** 加盐摘要 / the salted digest */
  wRid: string
  /** 签名时刻（秒）/ the signing instant (seconds) */
  wts: number
}

/** 由 img/sub 密钥得 mixin 密钥（拼串按表重排后截取前 32 字符）/ derives the mixin key from img/sub keys (permuted then truncated to 32) */
export function mixinKeyOf(keys: WbiKeys): string {
  const combined = keys.imgKey + keys.subKey
  return MIXIN_KEY_ENC_TAB.map((index) => combined[index] ?? '').join('').slice(0, 32)
}

/** wts 参数要过滤的字段（设计约定）/ the fields filtered before signing (per the convention) */
const FILTERED_CHARS = /[!'()*]/g

/**
 * 对参数签名：排序 → 过滤 → 拼 wts → md5(query + mixinKey)。
 * Signs parameters: sort → filter → append wts → md5(query + mixinKey).
 */
export function signWbiQuery(params: Record<string, string>, mixinKey: string, wts: number): SignedQuery {
  const filtered: Record<string, string> = { ...params, wts: String(wts) }
  for (const key of Object.keys(filtered)) {
    filtered[key] = filtered[key].replaceAll(FILTERED_CHARS, '')
  }
  const query = Object.keys(filtered)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(filtered[key])}`)
    .join('&')
  const wRid = createHash('md5').update(query + mixinKey, 'utf8').digest('hex')
  return { wRid, wts }
}

/** 从 nav 载荷提取密钥对（键名做 URL 解码还原）/ extracts the key pair from a nav payload */
export function wbiKeysFromNav(payload: unknown): WbiKeys | null {
  if (payload === null || typeof payload !== 'object') return null
  const img = (payload as { data?: { wbi_img?: { img_url?: string; sub_url?: string } } }).data?.wbi_img
  if (img?.img_url === undefined || img.sub_url === undefined) return null
  const fileName = (url: string): string => url.split('/').pop()?.split('.')[0] ?? ''
  return { imgKey: fileName(img.img_url), subKey: fileName(img.sub_url) }
}
