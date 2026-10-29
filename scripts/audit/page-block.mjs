/**
 * PAGE 块的文本解析：骨架行与页面说明。
 * PAGE block text parsing: skeleton lines and the page note.
 * @module @veren/scripts/audit/page-block
 */

/** 说明行的前缀 / the page-note line prefix */
const NOTE_PREFIX = '说明：'

/** 应用说明行的前缀 / the app-note line prefix */
const APP_NOTE_PREFIX = '应用说明：'

/**
 * PAGE 块里的页面说明行正文（`说明：` 之后），无此行时为空串。
 * The page-note line of a PAGE block (after `说明：`), empty when the line is absent.
 * @param text - PAGE 块原文 / the block text
 * @returns 说明正文 / the note body
 */
export function noteOf(text) {
  const line = text.split('\n').find((candidate) => candidate.startsWith(NOTE_PREFIX))
  return line === undefined ? '' : line.slice(NOTE_PREFIX.length)
}

/**
 * PAGE 块承载了 §3.10.2 骨架的哪些行。
 * Which §3.10.2 skeleton lines the PAGE block carries.
 * @param text - PAGE 块原文 / the block text
 * @returns 各结构行的在场情况 / presence of each skeleton line
 */
export function blockLines(text) {
  return {
    map: text.includes('map:（能力地图'),
    tools: text.includes('tools:'),
    appNote: text.includes(APP_NOTE_PREFIX),
    pageNote: noteOf(text) !== '',
  }
}

/**
 * PAGE 块的定位行：`PAGE <appId>/<page> <url>`。
 * The locator line of a PAGE block: `PAGE <appId>/<page> <url>`.
 * @param text - PAGE 块原文 / the block text
 * @returns 页面键与 URL，缺行时为空串 / the page key and url, empty when the line is absent
 */
export function locatorOf(text) {
  const [marker, key, url] = text.split('\n')[0]?.split(' ') ?? []
  return marker === 'PAGE' ? { pageKey: key ?? '', url: url ?? '' } : { pageKey: '', url: '' }
}

/**
 * 页面说明里是否出现某句判定词（措辞代际划分用）。
 * Whether the page note carries one of the given markers (used to draw wording
 * generations).
 * @param note - 说明正文 / the note body
 * @param markers - 判定词 / the markers
 * @returns 命中任一判定词 / whether any marker is present
 */
export function noteHas(note, markers) {
  return markers.some((marker) => note.includes(marker))
}
