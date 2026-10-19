/**
 * The menu entries the provider registers for itself.
 *
 * Defaults are code, not rows: an upgrade can rename a label key or tighten a
 * permission without a migration, and a deployment that replaces navigation
 * policy simply disables this provider. `order` is spaced by ten so modules can
 * drop entries between the defaults without renumbering.
 *
 * provider 为自身注册的菜单项。默认项是代码而非数据行：升级可以直接改标签 key 或收紧权限
 * 而无需迁移；替换导航策略的部署只需禁用本 provider。`order` 以十为步长，模块因此可以在
 * 默认项之间插入条目而无需重编号。
 *
 * @module @veren/admin-navigation-default/contributions
 */

import { ADMIN_PERMISSIONS, type AdminNavContribution } from '@veren/admin-contract'

/**
 * The default menu, in intended render order.
 *
 * Each entry names the SPA path, the icon the icon pack resolves, and the
 * permission that admits it; the shell never invents permissions of its own.
 *
 * 默认菜单，按预期渲染顺序排列。每项声明 SPA 路径、图标包负责解析的图标名以及允许其可见的
 * 权限；外壳绝不自行发明权限。
 */
export const DEFAULT_NAVIGATION: readonly AdminNavContribution[] = [
  {
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    path: '/',
    icon: 'dashboard',
    permission: ADMIN_PERMISSIONS.dashboardRead,
    order: 10,
  },
  {
    id: 'users',
    labelKey: 'nav.users',
    path: '/users',
    icon: 'users',
    permission: ADMIN_PERMISSIONS.usersManage,
    order: 20,
  },
  {
    id: 'roles',
    labelKey: 'nav.roles',
    path: '/roles',
    icon: 'shield',
    permission: ADMIN_PERMISSIONS.rolesManage,
    order: 30,
  },
  {
    id: 'audit',
    labelKey: 'nav.audit',
    path: '/audit',
    icon: 'audit',
    permission: ADMIN_PERMISSIONS.auditRead,
    order: 40,
  },
  {
    id: 'capabilities',
    labelKey: 'nav.capabilities',
    path: '/system/capabilities',
    icon: 'capabilities',
    permission: ADMIN_PERMISSIONS.capabilitiesRead,
    order: 50,
  },
]
