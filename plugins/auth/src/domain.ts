/**
 * The `web-login-gate` domain: the durable persistence layer for Better Auth.
 * Declared once with `defineDomain` and opened via `ctx.storageDomain.open()`;
 * the Kysely dialect maps every read and write onto the domain's table
 * handles, so the storage group's existing backend/routes configuration
 * decides the medium (`json` or `sqlite`) and the plugin never touches a
 * backend directly.
 * `web-login-gate` domain：Better Auth 的持久层。通过 `defineDomain` 一次性声明，
 * 经 `ctx.storageDomain.open()` 打开；Kysely dialect 把所有读写映射到 domain
 * 的表句柄上，底层介质（json/sqlite）完全由 storage group 的既有 backend/routes
 * 配置决定，插件不直接触碰后端。
 * @module src/domain
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * Loose record schema: Better Auth owns the field set and evolves it between
 * releases, so the durable boundary only guarantees an `id` — corrupt or
 * hand-edited files without one still fail the domain open loudly.
 * 宽松记录 schema：字段集合由 Better Auth 拥有并随版本演进，持久边界只保证
 * `id` 存在；缺失 `id` 的损坏/手工编辑文件仍会让 domain 打开显式失败。
 */
const authRecord = z.looseObject({ id: z.string() })

/**
 * The Better Auth table set (singular model names, `usePlural: false`).
 * Better Auth 的表集合（单数模型名，`usePlural: false`）。
 */
/** Domain name; `UNIT_NAME_RE` admits letters, digits and underscores only. domain 名；`UNIT_NAME_RE` 只接受字母、数字与下划线。 */
export const LOGIN_GATE_DOMAIN_NAME = 'web_login_gate'

/** Models this domain accepts from the adapter; anything else is a bug. 适配器接受的模型集合，其余视为缺陷。 */
export const LOGIN_GATE_MODELS = ['user', 'session', 'account', 'verification'] as const
/** 单个模型名。仅供测试/对外契约 / one model name; test-only / external contract. */
export type LoginGateModel = (typeof LOGIN_GATE_MODELS)[number]

/**
 * The declared domain. `per-record` layout: one document per auth record —
 * records are small, sparse (sessions churn), and individually disposable,
 * and per-record version checks keep restarts cheap.
 * 声明的 domain。`per-record` 布局：每条认证记录一个文档——记录小而稀疏
 * （会话频繁增删且可单独丢弃），按记录的版本校验让重启开销保持低廉。
 */
export const loginGateDomain = defineDomain({
  name: LOGIN_GATE_DOMAIN_NAME,
  version: 1,
  layout: 'per-record',
  tables: {
    user: domainTable(authRecord),
    session: domainTable(authRecord),
    account: domainTable(authRecord),
    verification: domainTable(authRecord),
  },
})

/** The opened handle type of {@link loginGateDomain}. 打开后的句柄类型。 */
export type LoginGateDomain = import('@deepseek-ai/dsh-storage-domain').Domain<typeof loginGateDomain>
