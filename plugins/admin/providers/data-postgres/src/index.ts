/**
 * Public entry of `@veren/admin-data-postgres`.
 *
 * The loader consumes the `name` / `inject` / `Config` / `apply` exports; other
 * packages import the schema catalog, the SQL store contracts, and the adapter
 * factory to mount the same port over PostgreSQL.
 *
 * `@veren/admin-data-postgres` 的公开入口。loader 消费 `name` / `inject` /
 * `Config` / `apply` 导出；其他包引用 schema 目录、SQL 存储契约与适配器工厂，以便在
 * PostgreSQL 上挂载同一端口。
 *
 * @module @veren/admin-data-postgres
 */

export * from './adapter.ts'
export * from './plugin.ts'
export * from './schema.ts'
export * from './store.ts'
