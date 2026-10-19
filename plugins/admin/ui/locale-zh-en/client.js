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

  // Menu labels resolved from `bootstrap.nav[].labelKey` 来自导航的菜单标签
  'nav.dashboard': 'Dashboard',
  'nav.users': 'Users',
  'nav.roles': 'Roles',
  'nav.audit': 'Audit',
  'nav.capabilities': 'Capabilities',

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

  // Dashboard 仪表盘
  'dashboard.title': 'Dashboard',
  'dashboard.welcome': 'Welcome',
  'dashboard.users': 'Users',
  'dashboard.capabilities': 'Capabilities',
  'dashboard.audit': 'Recent audit entries',

  // Users 用户
  'users.title': 'Users',
  'users.create': 'New user',
  'users.edit': 'Edit',
  'users.deleteConfirm': 'Delete this user? This cannot be undone.',
  'users.active': 'Active',
  'users.inactive': 'Inactive',
  'users.roles': 'Roles',
  'users.email': 'Email',
  'users.lastLogin': 'Last sign-in',
  'users.created': 'Created',

  // Roles 角色
  'roles.title': 'Roles',
  'roles.name': 'Role',
  'roles.permissions': 'Permissions',
  'roles.builtIn': 'Built in',

  // Audit 审计
  'audit.title': 'Audit',
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

  // Capabilities 能力
  'capabilities.title': 'Capabilities',
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

  // 来自导航的菜单标签
  'nav.dashboard': '仪表盘',
  'nav.users': '用户',
  'nav.roles': '角色',
  'nav.audit': '审计',
  'nav.capabilities': '能力',

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

  // 仪表盘
  'dashboard.title': '仪表盘',
  'dashboard.welcome': '欢迎',
  'dashboard.users': '用户',
  'dashboard.capabilities': '能力',
  'dashboard.audit': '最近审计记录',

  // 用户
  'users.title': '用户',
  'users.create': '新建用户',
  'users.edit': '编辑',
  'users.deleteConfirm': '确定删除该用户？此操作不可撤销。',
  'users.active': '启用',
  'users.inactive': '停用',
  'users.roles': '角色',
  'users.email': '邮箱',
  'users.lastLogin': '最近登录',
  'users.created': '创建时间',

  // 角色
  'roles.title': '角色',
  'roles.name': '角色',
  'roles.permissions': '权限',
  'roles.builtIn': '内置',

  // 审计
  'audit.title': '审计',
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

  // 能力
  'capabilities.title': '能力',
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
