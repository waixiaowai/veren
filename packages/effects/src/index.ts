/**
 * @veren/effects public entry: the durable side-effect queue core, its
 * storage port, the memory backend, and the key/value adapter.
 *
 * 语义出处：官方 dsh-superagent `src/app/effects.ts`（MIT，只读参照
 * `deepseek/dsh-superagent`），按本仓规范重写为存储无关核。
 * / Public entry. Semantics ported from the official dsh-superagent
 * `src/app/effects.ts` (MIT, read-only reference), rewritten as a
 * storage-agnostic core per this repository's rules.
 *
 * @module @veren/effects
 */

export { Effects, Later } from './core.ts'
export type { EffectsOptions } from './core.ts'
export type { DispatchContext, RegisteredHandler, Task } from './dispatch.ts'
export { FAILURES_BEFORE_ERROR, brokenSnapshot, waitingSnapshot } from './health.ts'
export type { EffectHealthSink, EffectHealthSnapshot } from './health.ts'
export { MemoryEffectStorage } from './memory.ts'
export { kvEffectStorage } from './kv.ts'
export type { EffectKvTable } from './kv.ts'
export { effectRowKey } from './rows.ts'
export type { EffectPayloadMap, EffectRow, EffectStorage, HandlerOptions } from './rows.ts'
