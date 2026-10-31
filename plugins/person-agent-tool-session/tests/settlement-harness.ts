// 结算测试辅助的组装门面：真正的实现按职责分域——
//   - harness-deferred.ts：可从外部结清的 promise 令牌；
//   - harness-fake-agent.ts：假 Agent 与作用域上下文；
//   - harness-env.ts：测试环境（真实 Context + 假外部服务）与 settleAsync。
// 本文件只做 re-export，既有导入路径 `./settlement-harness.js` 保持可用。
// The settlement test-support assembly facade; the implementations live by duty
// domain in harness-deferred.ts (the externally settleable promise token),
// harness-fake-agent.ts (the fake Agent with a real scoped context) and
// harness-env.ts (the test environment plus settleAsync). This file only
// re-exports, so the existing import path `./settlement-harness.js` keeps working.
export { deferred } from './harness-deferred.js'
export type { Deferred } from './harness-deferred.js'
export { createFakeAgent } from './harness-fake-agent.js'
export type { FakeAgent, FakeMessage } from './harness-fake-agent.js'
export { install, settleAsync } from './harness-env.js'
export type { Env, RegisteredTool } from './harness-env.js'
export { dispatchTo, noticeText } from './settlement-helpers.js'
