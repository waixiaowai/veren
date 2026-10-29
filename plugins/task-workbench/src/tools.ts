/**
 * 工具矩阵组装器（§3.10.1）：把队列半边、页面半边与 drive/导航面拼成本应用的
 * 完整工具集。装配（index.ts）以全名（`<toolPrefix>__<本地名>`）备好后由页面
 * 组件体按矩阵登记。本文件只组合，不定义。
 * The tool-matrix composer (§3.10.1): assembles the queue half, the page half
 * and the drive/navigation face into the app's full toolset. Assembly (index.ts)
 * prepares them under full names (`<toolPrefix>__<localName>`); page bodies
 * register their matrix rows. This file only composes, never defines.
 * @module @veren/task-workbench
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createQueueTools } from './tools-queue.ts'
import type { QueuePorts } from './actions-queue.ts'
import { createPageTools } from './tools-page.ts'
import type { PageToolPorts } from './tools-page.ts'
import { createDriveTools } from './tools-drive.ts'
import type { DriveToolPorts } from './tools-drive.ts'

/** 工具矩阵的完整端口 / the full tool-matrix ports */
export interface WorkbenchPorts extends QueuePorts, PageToolPorts, DriveToolPorts {}

/**
 * 定义应用全部工具（12 个，§4 矩阵扩展表）：本地名 ≤24 字符、应用内唯一。
 * Define the app's full toolset (12 tools, the §4 matrix extension table):
 * local names ≤24 chars, unique in-app.
 */
export function createAppTools(ports: WorkbenchPorts): ToolDefinition[] {
  return [
    ...createQueueTools(ports),
    ...createPageTools(ports),
    ...createDriveTools(ports),
  ]
}
