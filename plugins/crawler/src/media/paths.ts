/**
 * 媒体落盘路径治理：文件名清洗、保留名、长度截断、目录穿越防护、
 * 扩展名白名单与推断优先级（design/modules/downloader.md §1–§2）。
 * Media path governance: filename sanitization, Windows reserved names,
 * length truncation, escape protection, the extension whitelist and the
 * inference priority (design downloader.md §1–§2).
 *
 * @module @veren/crawler/media/paths
 */
import { join, resolve, sep, extname } from 'node:path'
import { CrawlerError } from '../errors.ts'

/** 扩展名白名单（常见图片与视频格式）/ the extension whitelist (common image and video formats) */
const EXTENSION_WHITELIST = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.m4s', '.mp3', '.aac', '.m4a',
])

/** Windows 保留名 / Windows reserved device names */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** 文件名最大长度 / the max file-name length */
const MAX_NAME_LENGTH = 120

/** 不允许出现在文件名里的字符 / characters banned from file names */
const UNSAFE_CHARS = /[^\w.\-一-鿿（）() ]/g

/** 清洗文件名：安全字符集、保留名前缀、长度截断 / sanitize: safe charset, reserved-name prefix, length truncation */
export function sanitizeFileName(name: string): string {
  let cleaned = name.replace(UNSAFE_CHARS, '_').trim()
  if (cleaned.length === 0) cleaned = 'media'
  cleaned = cleaned.slice(0, MAX_NAME_LENGTH).replace(/^\.+/, '')
  const base = cleaned.split('.')[0] ?? ''
  // Windows 保留名加下划线前缀（验收 4）/ prefix Windows reserved names (acceptance 4)
  return RESERVED_NAMES.has(base.toUpperCase()) ? `_${cleaned}` : cleaned
}

/**
 * 推断扩展名：显式指定 → 地址后缀（在白名单内）→ 默认值。
 * Infers the extension: explicit → whitelisted url suffix → default.
 */
export function inferExtension(explicit: string | null, url: string, fallback: string = '.jpg'): string {
  if (explicit !== null && EXTENSION_WHITELIST.has(explicit)) return explicit
  const urlExt = extname(new URL(url).pathname).toLowerCase()
  if (EXTENSION_WHITELIST.has(urlExt)) return urlExt
  return fallback
}

/** 是否白名单扩展名 / whether the extension is whitelisted */
export function isAllowedExtension(extension: string): boolean {
  return EXTENSION_WHITELIST.has(extension.toLowerCase())
}

/** 目录穿越防护错误 / the escape-protection error */
function pathOutOfRoot(): CrawlerError {
  return new CrawlerError('DATA_PATH_OUT_OF_ROOT', '无权访问该路径', {})
}

/**
 * 约束目标路径在数据根内；越界即拒绝（验收 4）。
 * Constrains the target path inside the data root; escapes reject
 * (acceptance 4).
 */
export function guardWithin(root: string, target: string): string {
  const rootAbs = resolve(root)
  const targetAbs = resolve(target)
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) throw pathOutOfRoot()
  return targetAbs
}

/** 落盘规则构造参数 / the path-policy options */
export interface MediaPathPolicy {
  /** 数据根目录 / the data root */
  root: string
  /** 平台标识 / the platform identifier */
  platform: string
}

/**
 * 构建落盘路径：{root}/{platform}/media/{contentId}/{stem}{extension}。
 * Builds the path: root/platform/media/contentId/stem+extension.
 */
export function buildMediaPath(policy: MediaPathPolicy, contentId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName)
  return join(policy.root, policy.platform, 'media', sanitizeFileName(contentId), safeName)
}
