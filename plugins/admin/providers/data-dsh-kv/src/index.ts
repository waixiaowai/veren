/**
 * Public entry of `@veren/admin-data-dsh-kv`.
 *
 * The loader consumes the `name` / `inject` / `Config` / `apply` exports; other
 * packages import the declaration (`adminDataDomain`), the structural KV handle
 * types, and `createKvDatabase` to mount the same port over their own domain.
 *
 * `@veren/admin-data-dsh-kv` 的公开入口。loader 消费 `name` / `inject` / `Config` /
 * `apply` 导出；其他包引用声明（`adminDataDomain`）、结构化 KV 句柄类型，以及
 * `createKvDatabase`，以便在自己的 domain 上挂载同一端口。
 *
 * @module @veren/admin-data-dsh-kv
 */

export * from './adapter.ts'
export * from './domain.ts'
export * from './plugin.ts'
