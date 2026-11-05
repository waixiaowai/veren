/**
 * 业务取数结果的格式化入口（设计 §9.9：日期/数字/容量统一走一个格式化
 * 入口；容量按 1024 进制带单位；路径映射为"我的应用数据"展示形）。基础
 * 组件只吃已格式化字符串，不认识业务字段。
 * The one formatting entry for fetched business values (design §9.9:
 * dates/numbers/sizes format through one entry; sizes are 1024-based with
 * units; paths map to the "我的应用数据" display form). Basic components eat
 * pre-formatted strings only — they never see business fields.
 *
 * @module @veren/baidu-pan/client/format
 */

/** 字节数 → 短格式（1024 进制，GiB 等）。Byte count → short form (1024-based, GiB etc.). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}

/** 服务端 mtime 秒 → 本地时区的 YYYY-MM-DD HH:mm。Server mtime seconds → local YYYY-MM-DD HH:mm. */
export function formatTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** ISO 到期时间 → 本地时区的 YYYY-MM-DD HH:mm。ISO expiry → local YYYY-MM-DD HH:mm. */
export function formatIso(iso: string): string {
  return formatTime(Math.floor(Date.parse(iso) / 1000))
}

/** 服务端路径 → 展示路径（/apps/ 前缀映射为"我的应用数据"）。Server path → display path (the /apps/ prefix maps to "我的应用数据"). */
export function displayPath(path: string): string {
  return path.replace(/^\/apps\//u, '我的应用数据/')
}

/** 已等待秒数 → "已等待 N 秒"的可读行。Elapsed seconds → a readable "waited N s" line. */
export function formatElapsed(seconds: number): string {
  return `${Math.max(0, Math.floor(seconds))}s`
}
