/**
 * Shared Vitest alias table for the `plugins/admin/*` packages.
 *
 * Every package imports its siblings by their published names; the aliases map
 * those names onto the sibling sources so a test runs against live code without
 * a workspace install.
 *
 * `plugins/admin/*` 各包共享的 Vitest 别名表。包之间按发布名互相引用；别名把这些
 * 名字映射到兄弟包源码，因此测试无需安装工作区即可跑在实时代码上。
 *
 * @module plugins/admin/vitest.aliases
 */

import { fileURLToPath } from 'node:url'

/** Absolute source path of one sibling package entry. 兄弟包入口的源码绝对路径。 */
function source(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url))
}

/** Package name to source entry map consumed by `resolve.alias`. 供 `resolve.alias` 使用的包名到源码入口映射。 */
export const adminAliases: Record<string, string> = {
  '@veren/admin-contract': source('./contract/src/index.ts'),
  '@veren/admin-kernel': source('./kernel/src/index.ts'),
  '@veren/admin-api-kernel': source('./api/src/index.ts'),
  '@veren/admin-data-dsh-kv': source('./providers/data-dsh-kv/src/index.ts'),
  '@veren/admin-auth-local': source('./providers/auth-local/src/index.ts'),
  '@veren/admin-access-rbac': source('./providers/access-rbac/src/index.ts'),
  '@veren/admin-navigation-default': source('./providers/nav-default/src/index.ts'),
  '@veren/admin-audit-default': source('./providers/audit-default/src/index.ts'),
  '@veren/admin-docs-openapi': source('./providers/docs-openapi/src/index.ts'),
  '@veren/admin-ui-contract': source('./ui-contract/src/index.ts'),
  '@veren/admin-ui-kernel': source('./ui-kernel/src/index.ts'),
  '@veren/admin-web': source('./web/src/index.ts'),
}
