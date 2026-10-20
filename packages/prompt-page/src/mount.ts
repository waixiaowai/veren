/**
 * mountPage：把一个页面绑定为独立页面会话 / bind a page as an isolated page-session
 *
 * 一页一会话：独立 MessageHost（独立版本链/快照基线）；store 是跨页面共享的权威状态，
 * 页面关闭只丢会话（消息日志），不丢状态。
 */
import { bindStore, createRoot, scheduleRender } from '@veren/prompt-core'
import { MessageHost, renderSync } from '@veren/prompt-host-messages'
import { formatPath } from './registry.ts'
import type { PageDefinition, PageParams, PageSession } from './types.ts'

export interface MountOptions<S> {
  page: PageDefinition<S>
  store: import('@veren/prompt-core').ExternalStore<S>
  params?: PageParams
  /** 透传给 MessageHost 的选项 / forwarded to MessageHost */
  hostOptions?: { maxPatchGap?: number; compactEvery?: number }
}

export function mountPage<S>(options: MountOptions<S>): PageSession<S> {
  const { page, store, params = {}, hostOptions = {} } = options
  const host = new MessageHost(hostOptions)
  const root = createRoot(host)
  const unsubscribe = bindStore(root, store, (state) => page.tree(params, state))
  scheduleRender(root, page.tree(params, store.getState())) // 初始挂载建立基线
  const pointerMessage = `OPEN ${formatPath(page.url, params)} ${JSON.stringify(params)}`
  return {
    page,
    params,
    host,
    pointerMessage,
    get version(): number {
      return host.currentVersion
    },
    syncText(cursor?: number): string {
      return renderSync(host.renderSince(cursor))
    },
    unsubscribe,
  }
}
