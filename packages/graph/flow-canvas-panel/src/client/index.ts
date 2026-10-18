/**
 * Browser half of the flow-canvas panel.
 *
 * It mounts the `flowCanvas` Remote namespace, then starts the inner panel
 * plugin that injects the freshly mounted namespace and registers the
 * full-space `main` page plus its sidebar entry. Node rendering goes through
 * the keyed `flow.canvas.node` slot declared by the page.
 *
 * 画布面板的浏览器半边。它先挂载 `flowCanvas` Remote 命名空间，再启动内层面板插件：
 * 注入刚挂载的命名空间，并注册整块空间的 `main` 页面与侧栏入口。节点渲染走页面声明的
 * keyed `flow.canvas.node` 槽位。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { flowCanvasRemote } from './remote.ts'
import { PanelPlugin } from './panel-plugin.tsx'

export type {
    FlowCanvasNodeOwnerProps,
    FlowCanvasPanelInjected,
    FlowCanvasPanelProps,
} from './slots.ts'
export type { FlowCanvasViewState, RunView } from './store.ts'
export { NodeApprovalCard } from './NodeApprovalCard.tsx'
export type { NodeApprovalCardProps } from './NodeApprovalCard.tsx'

/** Keep the page key exported for tests and third-party composition. */
export { PANEL_ID } from './panel-plugin.tsx'

/**
 * Client services of the entry plugin. `remote.flowCanvas` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the Loader wait for a service that does not exist until `apply` runs.
 *
 * 入口插件的客户端服务。`remote.flowCanvas` 绝不能写在这里：本插件是该命名空间唯一的
 * 挂载者，声明依赖会让 Loader 等待一个在 `apply` 运行前不存在的服务。
 */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the Remote namespace, then start the inner panel plugin. Disposal
 * unwinds in reverse: page first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the page fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
    const unmount = await ctx.remote.$mount(flowCanvasRemote)
    const panel = ctx.plugin(PanelPlugin)
    await panel
    return async () => {
        await panel.dispose()
        await unmount()
    }
}
