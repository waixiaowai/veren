/**
 * definePage：声明一个页面（misconfiguration fails loud）
 * definePage: declare a page (misconfiguration fails loud)
 *
 * 校验 URL 模式：必须以 / 开头、仅路径段（无查询串）、:param 名非空且不重复。
 */
import type { ElementInput } from '@veren/prompt-core'
import type { PageDefinition, PageEventMap, PageParams, PagePresetSpec } from './types.ts'

export function definePage<S>(definition: {
  name: string
  url: string
  description: string
  preset?: PagePresetSpec
  events?: PageEventMap
  tree: (props: PageParams, state: S) => ElementInput
  onLoad?: (params: PageParams) => void
  onComplete?: (params: PageParams) => boolean
}): PageDefinition<S> {
  const { name, url, description, preset, events, tree, onLoad, onComplete } = definition
  if (name.length === 0 || name.trim() !== name) {
    throw new Error(`[definePage] invalid page name: ${JSON.stringify(name)}`)
  }
  validateUrlPattern(name, url)
  if (description.length === 0 || description.trim() !== description) {
    throw new Error(`[definePage] page "${name}" needs a non-empty description`)
  }
  if (typeof tree !== 'function') {
    throw new Error(`[definePage] page "${name}" tree must be a function`)
  }
  return {
    name, url, description, tree,
    ...(preset === undefined ? {} : { preset }),
    ...(events === undefined ? {} : { events }),
    ...(onLoad === undefined ? {} : { onLoad }),
    ...(onComplete === undefined ? {} : { onComplete }),
  }
}

/** URL 模式校验 / validate a url pattern */
function validateUrlPattern(name: string, url: string): void {
  if (!url.startsWith('/') || url.includes('?')) {
    throw new Error(`[definePage] page "${name}" url must be a path pattern like /xx/:id, got ${JSON.stringify(url)}`)
  }
  const segments = url.split('/').filter((segment) => segment.length > 0)
  const paramNames = new Set<string>()
  for (const segment of segments) {
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (paramName.length === 0 || paramNames.has(paramName)) {
      throw new Error(`[definePage] page "${name}" url has an invalid or duplicate :param: ${JSON.stringify(segment)}`)
    }
    paramNames.add(paramName)
  }
}
