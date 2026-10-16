/**
 * Sidebar glyph for the startup-item entry.
 *
 * Drawn inline rather than imported from the primitives catalog: this package
 * builds outside the Client bundler, and the glyph is one path. It uses
 * `currentColor` so the row's own state decides the tone, and it is decorative
 * because the sidebar owns the row's accessible name.
 *
 * 启动项侧栏入口的图标。直接内联绘制而不是从 primitives 目录导入：本包在客户端打包器
 * 之外构建，而这个图形只有一条路径。它用 `currentColor`，颜色由该行自身状态决定；因为
 * 侧栏自己持有该行的无障碍名称，所以它是纯装饰性的。
 *
 * @module @veren/startup-autostart/client/icon
 */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the power glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: requested edge and selection state.
 * @returns the decorative glyph.
 */
export function StartupPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): React.ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2.4v5.4" />
      <path d="M4.7 4.7a4.7 4.7 0 1 0 6.6 0" />
    </svg>
  )
}
