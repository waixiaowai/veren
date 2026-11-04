/**
 * 分享：为授权根内的文件或目录创建私密分享链接。链接与短链一律透传
 * 服务端返回，本地不自行拼接；提取码由调用方指定（4 位）。
 * Sharing: creates a private share link for files or directories inside the
 * authorized root. Link and short link pass through from the server verbatim
 * — never assembled locally; the caller picks the 4-char password.
 *
 * @module @veren/baidu-pan
 */
import type { BaiduPanClient } from './client.js'
import { baiduPanError } from './errors.js'
import type { ShareReceipt, ShareRequest } from './types.js'

/** 提取码合法性：4 位数字与小写字母。The password rule: 4 chars, digits and lowercase letters. */
export function isValidPassword(password: string): boolean {
  return /^[0-9a-z]{4}$/u.test(password)
}

/** 有效期合法性：官方允许 0/1/7/30 天。The period rule: the official 0/1/7/30 days. */
export function isValidPeriod(period: number): boolean {
  return period === 0 || period === 1 || period === 7 || period === 30
}

/** share set 响应的形状守卫：主链与短链取服务端返回，缺一也可用主链。The share-set response shape guard: link and short link come from the server; the link alone suffices. */
function parseShare(json: Record<string, unknown>, request: ShareRequest): ShareReceipt {
  const shortUrl = typeof json['shorturl'] === 'string' ? json['shorturl'] : undefined
  const link = typeof json['link'] === 'string' && json['link'].length > 0
    ? json['link']
    : shortUrl === undefined ? undefined : `https://pan.baidu.com/s/${shortUrl}`
  if (link === undefined) throw baiduPanError('BDPAN_UPSTREAM', { detail: 'share set returned no link' })
  return {
    link,
    ...(shortUrl === undefined ? {} : { shortUrl }),
    password: request.password,
    period: request.period,
  }
}

/** 创建私密分享：fsids 必须非空，参数先本地校验再出网。Creates a private share: non-empty fsids, params validated locally before going out. */
export async function createShare(client: BaiduPanClient, request: ShareRequest): Promise<ShareReceipt> {
  if (request.fsids.length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'fsids is empty' })
  if (!isValidPeriod(request.period)) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'period must be 0/1/7/30' })
  if (!isValidPassword(request.password)) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'password must be 4 digits/lowercase letters' })
  const response = await client.call('xpan/share', {
    method: 'set',
    period: String(request.period),
    pwd: request.password,
    fsids: JSON.stringify(request.fsids.map(fsid => Number(fsid))),
  }, { method: 'POST' })
  return parseShare(response.json, request)
}
