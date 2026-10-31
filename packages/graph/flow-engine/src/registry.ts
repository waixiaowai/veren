/**
 * 节点类型注册表实现与内置最简节点（noop / fail / echo / subflow）。
 *
 * The node-type registry implementation and the built-in minimal node types
 * (noop / fail / echo / subflow).
 *
 * 内置节点只作为参考实现与集成测试夹具，不承载任何业务语义。
 * The built-ins are reference implementations and integration-test fixtures
 * only; they carry no business semantics.
 *
 * 本文件是组合入口：职责拆分在各自模块——node-registry（注册表实现）、
 * builtin-nodes（内置节点）、node-runner（执行器）、node-timeout（超时预算）、
 * reference-cycle（引用环检测）。全部历史导出经此处原样转发。
 * This file is the composition entry: the responsibilities live in their own
 * modules — node-registry (the registry), builtin-nodes (the built-ins),
 * node-runner (the executor), node-timeout (the timeout budget) and
 * reference-cycle (cycle detection). Every historical export is forwarded here.
 */

export { NodeRegistryImpl } from './node-registry.js';
export {
    createBuiltinHandlers,
    createSubflowHandler,
    echoHandler,
    failHandler,
    noopHandler,
} from './builtin-nodes.js';
export type { SubflowRunner } from './builtin-nodes.js';
export { createRunner } from './node-runner.js';
export { assertNoReferenceCycle } from './reference-cycle.js';
