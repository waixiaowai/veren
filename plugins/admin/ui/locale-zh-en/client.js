/**
 * Browser half of the default locale pack.
 *
 * Two dictionaries with exactly the same key set. Every key is a `namespace.name`
 * pair; the SPA resolves all copy through them and falls back to the key itself
 * when a pack omits one, so a missing translation degrades to a visible key
 * rather than to English sneaking into a Chinese screen.
 *
 * 默认语言包的浏览器半边。两份键集完全一致的词典。键都是 `namespace.name` 形式；SPA 的
 * 全部文案都通过它们解析，缺失时回退到键本身，因此漏译会退化成可见的键，而不是让英文悄悄
 * 出现在中文界面里。
 *
 * @module @veren/admin-locale-zh-en/client.js
 */

/** English dictionary. 英词典。 */
const en = {
  // Shell, generic states and actions 外壳、通用状态与操作
  'app.title': 'Admin',
  'app.loading': 'Loading…',
  'app.empty': 'Nothing here yet',
  'app.error': 'Something went wrong',
  'app.retry': 'Retry',
  'app.cancel': 'Cancel',
  'app.save': 'Save',
  'app.delete': 'Delete',
  'app.close': 'Close',
  'app.notFound': 'Page not found',
  'app.forbidden': 'You do not have permission to open this page',
  'app.emptyHint': 'Records appear here once they exist.',
  'app.searchHint': 'Try a shorter keyword, or clear the filter.',
  'app.breadcrumb': 'Breadcrumb',
  'app.userMenu': 'Account menu',
  'app.collapseSidebar': 'Collapse sidebar',
  'app.expandSidebar': 'Expand sidebar',
  // Separator for a list of translated values inside one cell. 单元格内已翻译值的分隔符。
  'app.listSeparator': ', ',

  // Menu labels resolved from `bootstrap.nav[].labelKey` 来自导航的菜单标签
  'nav.dashboard': 'Dashboard',
  'nav.users': 'Users',
  'nav.roles': 'Roles',
  'nav.audit': 'Audit',
  'nav.capabilities': 'Capabilities',

  // Sidebar sections 侧栏分组
  'nav.section.overview': 'Overview',
  'nav.section.access': 'Access',
  'nav.section.observability': 'Observability',
  'nav.section.system': 'System',
  'nav.section.general': 'General',

  // Authentication 认证
  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.name': 'Name',
  'auth.loginTitle': 'Sign in to Admin',
  'auth.setupTitle': 'Create the first administrator',
  'auth.setupHint': 'No administrator exists yet. Create one to finish setup.',
  'auth.loginAction': 'Sign in',
  'auth.setupAction': 'Create administrator',
  'auth.invalid': 'Email or password is incorrect',
  // Placeholders: examples, not copy, so the address is identical in both locales.
  // 占位提示：属于示例而非文案，因此邮箱在两语言下保持同一值。
  'auth.emailPlaceholder': 'admin@example.com',
  'auth.passwordPlaceholder': 'Enter your password',
  'auth.namePlaceholder': 'Display name',
  'auth.changePassword': 'Change password',
  'auth.currentPassword': 'Current password',
  'auth.currentPasswordPlaceholder': 'Enter your current password',
  'auth.newPassword': 'New password',
  'auth.passwordRule': 'Must differ from the current password',
  'auth.passwordChanged': 'Password changed',
  'auth.wrongPassword': 'Current password is incorrect',
  'auth.passwordTooShort': 'The new password is too short',

  // Dashboard 仪表盘
  'dashboard.title': 'Dashboard',
  'dashboard.description': 'A snapshot of accounts, capabilities and recent activity.',
  'dashboard.welcome': 'Welcome',
  'dashboard.users': 'Users',
  'dashboard.capabilities': 'Capabilities',
  'dashboard.audit': 'Recent audit entries',

  // Users 用户
  'users.title': 'Users',
  'users.description': 'Accounts, their roles and sign-in status.',
  'users.create': 'New user',
  'users.edit': 'Edit',
  'users.deleteConfirm': 'Delete this user? This cannot be undone.',
  'users.active': 'Active',
  'users.inactive': 'Inactive',
  'users.roles': 'Roles',
  'users.email': 'Email',
  'users.lastLogin': 'Last sign-in',
  'users.created': 'Created',
  'users.searchPlaceholder': 'Search by email or name',
  'users.searchEmpty': 'No user matches this keyword',
  'users.passwordReset': 'Reset password',
  'users.passwordKeepHint': 'Leave blank to keep the current password',
  'users.passwordUnchanged': 'The new password must differ from the current password',
  'users.passwordPlaceholder': 'At least 8 characters',
  'users.namePlaceholder': 'Display name',

  // Roles 角色
  'roles.title': 'Roles',
  'roles.description': 'The role catalog and the permissions each role grants.',
  'roles.name': 'Role',
  'roles.label': 'Name',
  'roles.id': 'Identifier',
  'roles.idPlaceholder': 'lowercase letters, digits and hyphens',
  'roles.namePlaceholder': 'Role name',
  'roles.create': 'New role',
  'roles.edit': 'Edit',
  'roles.builtInHint': 'Built-in role — cannot be edited',
  'roles.permissions': 'Permissions',
  'roles.builtIn': 'Built in',

  // Audit 审计
  'audit.title': 'Audit',
  'audit.description': 'Every write the gateway recorded, newest first.',
  'audit.actor': 'Actor',
  'audit.action': 'Action',
  'audit.result': 'Result',
  'audit.target': 'Target',
  'audit.at': 'When',
  'audit.loadMore': 'Load more',
  'audit.intent': 'Intent',
  'audit.success': 'Success',
  'audit.failure': 'Failure',
  'audit.denied': 'Denied',
  'audit.searchPlaceholder': 'Search by actor, action or target',
  'audit.searchEmpty': 'No audit entry matches this keyword',

  // Capabilities 能力
  'capabilities.title': 'Capabilities',
  'capabilities.description': 'Which provider serves each capability, and its health.',
  'capabilities.capability': 'Capability',
  'capabilities.provider': 'Provider',
  'capabilities.health': 'Health',
  'capabilities.essential': 'Essential',

  // Health badges 健康角标
  'health.ok': 'Healthy',
  'health.degraded': 'Degraded',
  'health.down': 'Down',

  // Generic yes/no 通用是/否
  'common.yes': 'Yes',
  'common.no': 'No',

  // Top-bar switches 顶栏开关
  'theme.toggle': 'Toggle theme',
  'locale.toggle': 'Switch language',

  // Confirmation toasts 操作提示
  'toast.created': 'Created',
  'toast.saved': 'Saved',
  'toast.deleted': 'Deleted',

  // Permission names, keyed by the wire value (`perm.<permission>`). The raw id
  // stays visible as the option's subtitle, so a renamed label never loses
  // traceability to what the gateway compares.
  // 权限名称，按线上值建键（`perm.<permission>`）。原始标识仍作为选项副标题可见，
  // 因此改名后的标签永远保留回指网关实际比较的值。
  'perm.admin.dashboard.read': 'Dashboard · Read',
  'perm.admin.users.manage': 'Users · Manage',
  'perm.admin.roles.manage': 'Roles · Manage',
  'perm.admin.tokens.manage': 'API tokens · Manage',
  'perm.admin.audit.read': 'Audit log · Read',
  'perm.admin.capabilities.read': 'Capabilities · Read',
  'perm.admin.settings.write': 'Settings · Write',
  'perm.admin.plugins.manage': 'Plugins · Manage',
  'perm.terminal.tasks.read': 'Terminal tasks · Read',
  'perm.terminal.tasks.decide': 'Terminal tasks · Decide',

  // Permission sections and picker controls. 权限分组与选择器控件。
  'permGroup.overview': 'Overview',
  'permGroup.identity': 'Users & roles',
  'permGroup.observe': 'Audit & capabilities',
  'permGroup.system': 'System',
  'permGroup.terminal': 'Terminal tasks',
  'permGroup.other': 'Other',
  'permPicker.all': 'Select all',
  'permPicker.none': 'Clear all',
  'permPicker.invert': 'Invert',
  'permPicker.toggleGroup': 'Expand or collapse',
  'permPicker.selectGroup': 'Select all in this section',
}

/** Chinese dictionary; same keys as {@link en}. 中词典；键与 {@link en} 完全一致。 */
const zh = {
  // 外壳、通用状态与操作
  'app.title': '后台',
  'app.loading': '加载中…',
  'app.empty': '暂无内容',
  'app.error': '出错了',
  'app.retry': '重试',
  'app.cancel': '取消',
  'app.save': '保存',
  'app.delete': '删除',
  'app.close': '关闭',
  'app.notFound': '页面不存在',
  'app.forbidden': '你没有打开该页面的权限',
  'app.emptyHint': '创建记录后会显示在这里。',
  'app.searchHint': '试试更短的关键字，或清空筛选。',
  'app.breadcrumb': '面包屑',
  'app.userMenu': '账号菜单',
  'app.collapseSidebar': '收起侧栏',
  'app.expandSidebar': '展开侧栏',
  // 单元格内已翻译值的分隔符。
  'app.listSeparator': '、',

  // 来自导航的菜单标签
  'nav.dashboard': '仪表盘',
  'nav.users': '用户',
  'nav.roles': '角色',
  'nav.audit': '审计',
  'nav.capabilities': '能力',

  // 侧栏分组
  'nav.section.overview': '概览',
  'nav.section.access': '访问控制',
  'nav.section.observability': '可观测性',
  'nav.section.system': '系统',
  'nav.section.general': '通用',

  // 认证
  'auth.signIn': '登录',
  'auth.signOut': '退出登录',
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.name': '姓名',
  'auth.loginTitle': '登录后台',
  'auth.setupTitle': '创建首个管理员',
  'auth.setupHint': '尚未存在管理员。创建首个管理员以完成初始化。',
  'auth.loginAction': '登录',
  'auth.setupAction': '创建管理员',
  'auth.invalid': '邮箱或密码不正确',
  // 占位提示：属于示例而非文案，因此邮箱在两语言下保持同一值。
  // Placeholders: examples, not copy, so the address is identical in both locales.
  'auth.emailPlaceholder': 'admin@example.com',
  'auth.passwordPlaceholder': '请输入密码',
  'auth.namePlaceholder': '请输入姓名',
  'auth.changePassword': '修改密码',
  'auth.currentPassword': '当前密码',
  'auth.currentPasswordPlaceholder': '请输入当前密码',
  'auth.newPassword': '新密码',
  'auth.passwordRule': '不能与当前密码相同',
  'auth.passwordChanged': '密码已修改',
  'auth.wrongPassword': '当前密码不正确',
  'auth.passwordTooShort': '新密码长度不足',

  // 仪表盘
  'dashboard.title': '仪表盘',
  'dashboard.description': '账号、能力与近期活动的一览。',
  'dashboard.welcome': '欢迎',
  'dashboard.users': '用户',
  'dashboard.capabilities': '能力',
  'dashboard.audit': '最近审计记录',

  // 用户
  'users.title': '用户',
  'users.description': '账号、角色与登录状态。',
  'users.create': '新建用户',
  'users.edit': '编辑',
  'users.deleteConfirm': '确定删除该用户？此操作不可撤销。',
  'users.active': '启用',
  'users.inactive': '停用',
  'users.roles': '角色',
  'users.email': '邮箱',
  'users.lastLogin': '最近登录',
  'users.created': '创建时间',
  'users.searchPlaceholder': '按邮箱或姓名搜索',
  'users.searchEmpty': '没有匹配该关键字的用户',
  'users.passwordReset': '重置密码',
  'users.passwordKeepHint': '留空表示不修改当前密码',
  'users.passwordUnchanged': '新密码不能与当前密码相同',
  'users.passwordPlaceholder': '至少 8 位字符',
  'users.namePlaceholder': '请输入姓名',

  // 角色
  'roles.title': '角色',
  'roles.description': '角色目录，以及每个角色授予的权限。',
  'roles.name': '角色',
  'roles.label': '名称',
  'roles.id': '标识',
  'roles.idPlaceholder': '小写字母、数字与连字符',
  'roles.namePlaceholder': '角色名称',
  'roles.create': '新增角色',
  'roles.edit': '编辑',
  'roles.builtInHint': '内置角色，不可编辑',
  'roles.permissions': '权限',
  'roles.builtIn': '内置',

  // 审计
  'audit.title': '审计',
  'audit.description': '网关记录的每次写入，按时间倒序。',
  'audit.actor': '操作者',
  'audit.action': '动作',
  'audit.result': '结果',
  'audit.target': '对象',
  'audit.at': '时间',
  'audit.loadMore': '加载更多',
  'audit.intent': '意图',
  'audit.success': '成功',
  'audit.failure': '失败',
  'audit.denied': '拒绝',
  'audit.searchPlaceholder': '按操作者、操作类型或对象搜索',
  'audit.searchEmpty': '没有匹配该关键字的审计记录',

  // 能力
  'capabilities.title': '能力',
  'capabilities.description': '每项能力由哪个 provider 提供，以及它的健康状态。',
  'capabilities.capability': '能力',
  'capabilities.provider': '提供方',
  'capabilities.health': '健康',
  'capabilities.essential': '必需',

  // 健康角标
  'health.ok': '正常',
  'health.degraded': '降级',
  'health.down': '不可用',

  // 通用是/否
  'common.yes': '是',
  'common.no': '否',

  // 顶栏开关
  'theme.toggle': '切换主题',
  'locale.toggle': '切换语言',

  // 操作提示
  'toast.created': '已创建',
  'toast.saved': '已保存',
  'toast.deleted': '已删除',

  // 权限名称，按线上值建键（`perm.<permission>`）。原始标识仍作为选项副标题可见，
  // 因此改名后的标签永远保留回指网关实际比较的值。
  // Permission names, keyed by the wire value (`perm.<permission>`); the raw id stays
  // visible as the option's subtitle.
  'perm.admin.dashboard.read': '仪表盘·查看',
  'perm.admin.users.manage': '用户管理',
  'perm.admin.roles.manage': '角色管理',
  'perm.admin.tokens.manage': 'API 令牌管理',
  'perm.admin.audit.read': '审计日志·读取',
  'perm.admin.capabilities.read': '能力清单·读取',
  'perm.admin.settings.write': '系统设置·修改',
  'perm.admin.plugins.manage': '插件管理',
  'perm.terminal.tasks.read': '终端任务·查看',
  'perm.terminal.tasks.decide': '终端任务·审批',

  // 权限分组与选择器控件。
  // Permission sections and picker controls.
  'permGroup.overview': '概览',
  'permGroup.identity': '用户与角色',
  'permGroup.observe': '审计与能力',
  'permGroup.system': '系统',
  'permGroup.terminal': '终端任务',
  'permGroup.other': '其他',
  'permPicker.all': '全选',
  'permPicker.none': '全不选',
  'permPicker.invert': '反选',
  'permPicker.toggleGroup': '展开或折叠',
  'permPicker.selectGroup': '全选本组',
}

/**
 * Register both locales with the SPA runtime.
 *
 * @param runtime - the admin UI runtime 后台 UI 运行时
 */
export function activate(runtime) {
  runtime.registerLocale({ id: 'zh', label: { en: 'Chinese', zh: '中文' }, messages: zh })
  runtime.registerLocale({ id: 'en', label: { en: 'English', zh: '英文' }, messages: en })
}
