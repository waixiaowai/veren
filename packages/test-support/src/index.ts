/**
 * @veren/test-support 公共出口：测试宿主、临时存储、假会话、断言助手。
 * Public entry of @veren/test-support: the test host, temp storage, fake
 * sessions, and assertion helpers.
 *
 * @module @veren/test-support
 */
export { mountAppHost } from './host.ts'
export type { AppHost, AppHostOptions } from './host.ts'
export { mountStorage, TempDirs } from './storage.ts'
export type { StorageMount } from './storage.ts'
export { installFakeSessions, ToolTable } from './sessions.ts'
export type { AgentScopeView, FakeSessions, FollowupMessage, RegisteredTool } from './sessions.ts'
export { expectAppRemoved, expectPagesRegisteredOnce } from './assertions.ts'
export { assertUnattendedPage, assertNoUnattendedStall } from './page-contract.ts'
export type { ActionLevel, ContractToolRow, ContractPageRow } from './page-contract.ts'
