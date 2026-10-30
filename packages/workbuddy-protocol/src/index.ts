/**
 * @veren/workbuddy-protocol：WorkBuddy / CodeBuddy 双区域上游协议纯库。
 * The WorkBuddy / CodeBuddy dual-region upstream protocol as a pure library.
 *
 * 零 DSH 依赖：区域表、OAuth、刷新、指纹、池、脱敏、上游客户端、目录解析
 * 全在这里；DSH 壳（插件）只做接缝。协议事实的唯一契约面是
 * docs/workbuddy-protocol.md（中文版 .cn.md）。
 * Zero DSH dependencies: the region table, OAuth, refresh, fingerprints, pool,
 * redaction, upstream client and catalog parsing all live here; the DSH shell
 * (the plugin) only wires seams. The sole contract surface for protocol facts
 * is docs/workbuddy-protocol.md (Chinese edition .cn.md).
 *
 * @module @veren/workbuddy-protocol
 */

export * from './region.ts'
export * from './errors.ts'
export * from './redaction.ts'
export * from './fingerprint.ts'
export * from './oauth.ts'
export * from './refresh.ts'
export * from './identity.ts'
export * from './conversation-ids.ts'
export * from './chat-body.ts'
export * from './classify.ts'
export * from './catalog-types.ts'
export * from './catalog-parse.ts'
export * from './catalog-data.ts'
export * from './catalog-fetch.ts'
export * from './upstream-headers.ts'
export * from './upstream-client.ts'
export * from './billing.ts'
export * from './probe.ts'
export * from './pool.ts'
export * from './state-doc.ts'
