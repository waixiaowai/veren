/**
 * Capability interfaces: identity, authentication, authorization, navigation,
 * audit, settings and documentation.
 *
 * This module is the stable import path of the capability contract. Each
 * capability lives in its own file by responsibility domain; this façade only
 * re-exports them, so replacing a capability file never moves an import.
 *
 * 能力接口：身份、认证、授权、导航、审计、设置与文档。本模块是能力契约的稳定导入
 * 路径。各能力按职责域拆分在独立文件中，此处只做再导出，因此调整能力文件不会移动
 * 任何导入。
 *
 * @module @veren/admin-contract/capabilities
 */

export type { AdminIdentity, AuthenticatedPrincipal } from './identity.ts'
export type {
  AdminAuth,
  AdminLoginInput,
  AdminLoginResult,
  AdminSessionView,
  AdminSetupInput,
  AdminTokenView,
  AdminUserView,
} from './auth.ts'
export type { AdminAccess, AdminRoleView } from './access.ts'
export type { AdminNavContribution, AdminNavNode, AdminNavigation } from './navigation.ts'
export type { AdminAudit, AdminAuditEntry, AdminAuditQuery, AdminAuditResult } from './audit.ts'
export type { AdminSettings } from './settings.ts'
export type { AdminDocs } from './docs.ts'
