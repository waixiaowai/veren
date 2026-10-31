/**
 * flow 运行时：结构化错误、黑板、FlowDefinition → 内核图校验、运行环境与
 * 内核图组装。
 * The flow runtime: structured errors, the blackboard, FlowDefinition →
 * kernel-graph validation, and the run environment / kernel-graph assembly.
 *
 * 本文件是组合入口：职责拆分在各自模块——flow-error（结构化错误）、blackboard
 * （黑板与 slot）、compile-flow（注册期编译）、run-env（运行环境）、run-result
 * （结果聚合）。全部历史导出经此处原样转发，路径保持稳定。
 * This file is the composition entry: the responsibilities live in their own
 * modules — flow-error (structured errors), blackboard (blackboard & slots),
 * compile-flow (registration-time compilation), run-env (run environment) and
 * run-result (result aggregation). Every historical export is forwarded here
 * unchanged, keeping the import path stable.
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/runtime
 */

export {
    FlowError,
    flowError,
    toFlowError,
} from './flow-error.js';
export type { FlowErrorCode, FlowErrorFields } from './flow-error.js';
export {
    createBlackboard,
    recoveredFailure,
    resolveInputValue,
    toSlots,
} from './blackboard.js';
export { compileFlow, wrapGraphError } from './compile-flow.js';
export {
    nodeApprovalPort,
    runnerDeps,
    toKernelGraph,
} from './run-env.js';
export type { DriveEnv, OutcomePorts, RunnerDeps } from './run-env.js';
export {
    cancelledRunResult,
    rejectedRunResult,
    toFlowResult,
} from './run-result.js';
