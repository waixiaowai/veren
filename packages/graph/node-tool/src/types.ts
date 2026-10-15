/**
 * tool 节点共享的类型：直接复用 dsh-tools 的原始类型，不做二次封装。
 *
 * Shared tool-node types: re-exports the original dsh-tools types verbatim —
 * no re-wrapping.
 */

import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';

export type { ToolExecutionInput, ToolExecutionResult };
