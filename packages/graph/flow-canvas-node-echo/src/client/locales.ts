/**
 * `flowCanvasEcho` dictionaries for the demo echo renderer.
 *
 * demo echo 渲染器的 `flowCanvasEcho` 词典。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'flowCanvasEcho'

/** Simplified Chinese dictionary. */
export const zh = {
    'badge': '扩展渲染',
    'status.pending': '等待',
    'status.ready': '就绪',
    'status.running': '运行中',
    'status.awaiting': '等待授权',
    'status.completed': '完成',
    'status.failed': '失败',
    'status.skipped': '跳过',
    'status.cancelled': '已取消',
    'status.recovered': '完成 · 已兜底',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<EchoKey, string> = {
    'badge': 'extension renderer',
    'status.pending': 'pending',
    'status.ready': 'ready',
    'status.running': 'running',
    'status.awaiting': 'awaiting approval',
    'status.completed': 'completed',
    'status.failed': 'failed',
    'status.skipped': 'skipped',
    'status.cancelled': 'cancelled',
    'status.recovered': 'completed · recovered',
}

/** Key domain of the `flowCanvasEcho` namespace. */
export type EchoKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Custom echo renderer copy. */
        flowCanvasEcho: EchoKey
    }
}
