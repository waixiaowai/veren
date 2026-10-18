/**
 * Reuse the panel's alias-rich Vitest config: every alias is absolute, so the
 * extension's tests resolve the same DSH sources without a second map.
 *
 * 复用面板的别名 Vitest 配置：别名都是绝对路径，扩展测试因此用同一张映射解析 DSH 源码。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/vitest-config
 */

import panel from '../flow-canvas-panel/vitest.config.ts'

export default panel
