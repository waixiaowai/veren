/**
 * Pure view factories of the admin SPA.
 *
 * Every function returns a detached DOM node and receives all of its data and
 * callbacks as arguments; nothing here reads `window`, `location`, storage or
 * the network. That keeps views testable and keeps the one dangerous operation
 * — `innerHTML` — confined to trusted icon markup.
 *
 * User and API supplied strings are always written with `textContent` (or the
 * `text` property of {@link el}), never interpolated into markup.
 *
 * 后台 SPA 的纯视图工厂。每个函数返回游离的 DOM 节点，数据与回调都以参数传入；这里不读
 * `window`、`location`、存储或网络，因此视图可测试，而唯一危险的操作 `innerHTML` 被限制在
 * 可信图标标记里。用户与 API 提供的字符串一律用 `textContent`（或 {@link el} 的 `text`
 * 属性）写入，绝不拼进标记。
 *
 * @module @veren/admin-web/client/views.js
 */

/** Neutral placeholder for absent values. 缺失值的中性占位符。 */
const DASH = '—'

/** Audit result to locale key. 审计结果到语言键。 */
const RESULT_KEYS = { intent: 'audit.intent', success: 'audit.success', failure: 'audit.failure', denied: 'audit.denied' }

/** Audit result to badge tone. 审计结果到角标色调。 */
const RESULT_TONES = { intent: 'muted', success: 'ok', failure: 'danger', denied: 'warn' }

/** Health status to locale key. 健康状态到语言键。 */
const HEALTH_KEYS = { ok: 'health.ok', degraded: 'health.degraded', down: 'health.down' }

/** Health status to badge tone. 健康状态到角标色调。 */
const HEALTH_TONES = { ok: 'ok', degraded: 'warn', down: 'danger' }

/**
 * Create one element with attributes, listeners and children.
 *
 * @param tag - tag name 标签名
 * @param props - attributes, `class`, `text`, `dataset` and `on*` listeners 属性、类名、文本、dataset 与监听器
 * @param children - nodes or strings 节点或字符串
 * @returns the element 元素
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, String(value))
  }
  appendAll(node, children)
  return node
}

/**
 * Append children, flattening nested arrays so callers can inline `map` results.
 *
 * @param node - parent node 父节点
 * @param children - nodes, strings or nested arrays 节点、字符串或嵌套数组
 */
function appendAll(node, children) {
  for (const child of Array.isArray(children) ? children : [children]) {
    if (Array.isArray(child)) appendAll(node, child)
    else if (child !== undefined && child !== null && child !== false && child !== '') node.append(child)
  }
}

/**
 * Render an icon name through the active icon pack.
 *
 * @param ui - view helpers 视图助手
 * @param name - icon name 图标名
 * @returns the icon span 图标 span
 */
function iconOf(ui, name) {
  const span = el('span', { class: 'icon', 'aria-hidden': 'true' })
  const markup = typeof name === 'string' ? ui.icon(name) : undefined
  // 唯一允许的 innerHTML：图标包提供的可信内联 SVG，绝不来自 API 数据。
  // The only permitted innerHTML: trusted inline SVG from the icon pack, never API data.
  if (typeof markup === 'string' && markup.startsWith('<svg')) span.innerHTML = markup
  return span
}

/**
 * Render one value as text, with a neutral placeholder when absent.
 *
 * @param value - any value 任意值
 * @returns the text 文本
 */
function asText(value) {
  return value === undefined || value === null || value === '' ? DASH : String(value)
}

/**
 * Format an ISO instant for the active locale.
 *
 * @param value - ISO-8601 string ISO-8601 字符串
 * @param locale - locale id 语言 id
 * @returns the formatted text 格式化文本
 */
function formatDate(value, locale) {
  if (typeof value !== 'string' || value === '') return DASH
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return DASH
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * One page header with an optional action slot.
 *
 * @param ui - view helpers 视图助手
 * @param titleKey - locale key 语言键
 * @param action - optional action node 可选操作节点
 * @returns the header 头部
 */
function pageHeader(ui, titleKey, action) {
  const header = el('header', { class: 'page-header' }, [el('h1', { class: 'page-title', text: ui.t(titleKey) })])
  if (action !== undefined) header.append(el('div', { class: 'page-actions' }, [action]))
  return header
}

/**
 * One table, or an empty state when it has no rows.
 *
 * @param ui - view helpers 视图助手
 * @param columns - locale keys; an empty string renders an unnamed column 语言键；空串表示无列名
 * @param rows - body rows 表体行
 * @returns the table wrapper 表格容器
 */
function dataTable(ui, columns, rows) {
  if (rows.length === 0) return emptyView(ui)
  const head = el('thead', {}, [
    el('tr', {}, columns.map((key) => el('th', { scope: 'col', text: key === '' ? '' : ui.t(key) }))),
  ])
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'table' }, [head, el('tbody', {}, rows)])])
}

/**
 * One field with a label.
 *
 * @param ui - view helpers 视图助手
 * @param labelKey - locale key 语言键
 * @param type - input type 输入类型
 * @param attributes - extra input attributes 额外输入属性
 * @returns the label node and the input 标签节点与输入框
 */
function field(ui, labelKey, type, attributes = {}) {
  const input = el('input', { class: 'input', type, ...attributes })
  const node = el('label', { class: 'field' }, [el('span', { class: 'field-label', text: ui.t(labelKey) }), input])
  return { node, input }
}

/**
 * Open one modal dialog and collect its form values.
 *
 * Native `<dialog>` supplies the focus trap, Escape handling and the backdrop,
 * so the SPA carries no dialog implementation of its own.
 *
 * 打开一个模态对话框并收集表单值。原生 `<dialog>` 提供焦点陷阱、Escape 与背景遮罩，因此
 * SPA 不必自带对话框实现。
 *
 * @param ui - view helpers 视图助手
 * @param spec - title, optional message, fields and confirm callback 标题、可选消息、字段与确认回调
 */
function openModal(ui, spec) {
  const form = el('form', { class: 'dialog-form', novalidate: true })
  const fields = (spec.fields ?? []).map((entry) => modalField(ui, entry))
  if (spec.message !== undefined) form.append(el('p', { class: 'dialog-text', text: spec.message }))
  for (const entry of fields) form.append(entry.node)
  const cancel = el('button', { class: 'button', type: 'button', text: ui.t('app.cancel') })
  const confirm = el('button', {
    class: spec.danger === true ? 'button danger' : 'button primary',
    type: 'submit',
    text: ui.t(spec.confirmKey ?? 'app.save'),
  })
  form.append(el('footer', { class: 'dialog-footer' }, [cancel, confirm]))
  const dialog = el('dialog', { class: 'dialog' }, [
    el('header', { class: 'dialog-header' }, [el('h2', { class: 'dialog-title', text: ui.t(spec.titleKey) })]),
    form,
  ])
  cancel.addEventListener('click', () => dialog.close())
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const values = {}
    for (const entry of fields) values[entry.name] = entry.read()
    dialog.close()
    spec.onConfirm?.(values)
  })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
  form.querySelector('input')?.focus()
}

/**
 * One modal field, checkbox or text-like.
 *
 * @param ui - view helpers 视图助手
 * @param spec - name, label, type, value 名称、标签、类型、值
 * @returns the node and a value reader 节点与取值器
 */
function modalField(ui, spec) {
  const input = el('input', {
    class: 'input',
    type: spec.type,
    name: spec.name,
    autocomplete: spec.autocomplete,
    required: spec.required === true,
  })
  if (spec.type === 'checkbox') input.checked = spec.value === true
  else input.value = spec.value ?? ''
  const node = el('label', { class: spec.type === 'checkbox' ? 'field field-inline' : 'field' }, [
    el('span', { class: 'field-label', text: ui.t(spec.labelKey) }),
    input,
  ])
  return {
    name: spec.name,
    node,
    read: () => (spec.type === 'checkbox' ? input.checked : input.value.trim()),
  }
}

/**
 * Loading state.
 *
 * @param ui - view helpers 视图助手
 * @returns the state node 状态节点
 */
export function loadingView(ui) {
  return el('div', { class: 'state', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', { class: 'state-text', text: ui.t('app.loading') }),
  ])
}

/**
 * Empty state.
 *
 * @param ui - view helpers 视图助手
 * @param key - optional locale key 可选语言键
 * @returns the state node 状态节点
 */
export function emptyView(ui, key = 'app.empty') {
  return el('p', { class: 'state state-empty', text: ui.t(key) })
}

/**
 * Error state with a retry button.
 *
 * @param ui - view helpers 视图助手
 * @param options - detail text and retry callback 细节文本与重试回调
 * @returns the state node 状态节点
 */
export function errorView(ui, options) {
  return el('div', { class: 'state', role: 'alert' }, [
    el('p', { class: 'state-title', text: ui.t('app.error') }),
    el('p', { class: 'state-text', text: asText(options?.message) }),
    el('button', { class: 'button primary', type: 'button', text: ui.t('app.retry'), onclick: options?.onRetry }),
  ])
}

/**
 * One status page: 404, 403 or any "nothing to show" dead end.
 *
 * @param ui - view helpers 视图助手
 * @param key - locale key 语言键
 * @param onHome - back-to-dashboard callback 返回仪表盘回调
 * @returns the page 页面
 */
function statePage(ui, key, onHome) {
  return el('section', { class: 'state' }, [
    el('h1', { class: 'state-title', text: ui.t(key) }),
    el('button', { class: 'button', type: 'button', text: ui.t('nav.dashboard'), onclick: onHome }),
  ])
}

/**
 * Unknown route.
 *
 * @param ui - view helpers 视图助手
 * @param onHome - back-to-dashboard callback 返回仪表盘回调
 * @returns the page 页面
 */
export function notFoundView(ui, onHome) {
  return statePage(ui, 'app.notFound', onHome)
}

/**
 * Authenticated but not permitted.
 *
 * @param ui - view helpers 视图助手
 * @param onHome - back-to-dashboard callback 返回仪表盘回调
 * @returns the page 页面
 */
export function forbiddenView(ui, onHome) {
  return statePage(ui, 'app.forbidden', onHome)
}

/**
 * Sign-in or first-run setup view.
 *
 * @param ui - view helpers 视图助手
 * @param options - mode, error text and submit callback 模式、错误文本与提交回调
 * @returns the page 页面
 */
export function authView(ui, options) {
  const setupMode = options.setupRequired === true
  const email = field(ui, 'auth.email', 'email', { autocomplete: 'username', required: true })
  const password = field(ui, 'auth.password', 'password', {
    autocomplete: setupMode ? 'new-password' : 'current-password',
    required: true,
  })
  const name = setupMode ? field(ui, 'auth.name', 'text', { autocomplete: 'name', required: true }) : null
  const inputs = [email, password, name].filter((entry) => entry !== null)
  const submit = el('button', {
    class: 'button primary block',
    type: 'submit',
    text: ui.t(setupMode ? 'auth.setupAction' : 'auth.loginAction'),
  })
  const form = el('form', { class: 'auth-form', novalidate: true }, [
    inputs.map((entry) => entry.node),
    el('p', { class: 'form-error', role: 'alert', text: options.error ?? '' }),
    submit,
  ])
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const values = { email: email.input.value.trim(), password: password.input.value }
    if (name !== null) values.name = name.input.value.trim()
    submit.disabled = true
    Promise.resolve(options.onSubmit(setupMode ? 'setup' : 'login', values)).finally(() => {
      submit.disabled = false
    })
  })
  const card = el('main', { class: 'auth-card' }, [
    el('div', { class: 'brand' }, [iconOf(ui, 'shield'), el('span', { text: ui.t('app.title') })]),
    el('h1', { class: 'auth-title', text: ui.t(setupMode ? 'auth.setupTitle' : 'auth.loginTitle') }),
  ])
  if (setupMode) card.append(el('p', { class: 'auth-hint', text: ui.t('auth.setupHint') }))
  card.append(form)
  return el('div', { class: 'auth' }, [card])
}

/**
 * One sidebar link for a navigation node.
 *
 * @param ui - view helpers 视图助手
 * @param node - navigation node 导航节点
 * @param path - active route 当前路由
 * @returns the anchor 链接
 */
function navLink(ui, node, path) {
  const active = node.path === path
  const link = el('a', {
    class: active ? 'nav-link is-active' : 'nav-link',
    href: ui.href(node.path),
    dataset: { route: node.path },
    'aria-current': active ? 'page' : undefined,
  }, [iconOf(ui, node.icon), el('span', { class: 'nav-label', text: ui.t(node.labelKey) })])
  if (typeof node.badge === 'number' && node.badge > 0) {
    link.append(el('span', { class: 'badge muted', text: String(node.badge) }))
  }
  return link
}

/**
 * The top bar: menu toggle, title, identity, theme, locale and sign-out.
 *
 * @param ui - view helpers 视图助手
 * @param options - shell options 外壳选项
 * @param sidebar - sidebar node to toggle 要切换的侧栏节点
 * @returns the header 顶栏
 */
function topBar(ui, options, sidebar) {
  const menu = el('button', {
    class: 'icon-button menu-toggle',
    type: 'button',
    'aria-label': ui.t('app.title'),
    'aria-controls': 'admin-sidebar',
    onclick: () => sidebar.classList.toggle('is-open'),
  }, [iconOf(ui, 'menu')])
  const theme = el('button', {
    class: 'icon-button',
    type: 'button',
    title: ui.t('theme.toggle'),
    'aria-label': ui.t('theme.toggle'),
    onclick: options.onCycleTheme,
  }, [iconOf(ui, options.theme === 'dark' ? 'moon' : 'sun')])
  const locale = el('button', {
    class: 'icon-button locale-toggle',
    type: 'button',
    title: ui.t('locale.toggle'),
    'aria-label': ui.t('locale.toggle'),
    onclick: options.onToggleLocale,
  }, [iconOf(ui, 'globe'), el('span', { class: 'locale-tag', text: options.localeLabel })])
  const signOut = el('button', { class: 'button ghost', type: 'button', onclick: options.onSignOut }, [
    iconOf(ui, 'logout'),
    el('span', { class: 'button-label', text: ui.t('auth.signOut') }),
  ])
  return el('header', { class: 'topbar' }, [
    menu,
    el('div', { class: 'topbar-title', text: ui.t('app.title') }),
    el('div', { class: 'topbar-actions' }, [
      el('span', { class: 'user-chip', text: options.userName }),
      theme,
      locale,
      signOut,
    ]),
  ])
}

/**
 * Sidebar, top bar and scrollable content.
 *
 * @param ui - view helpers 视图助手
 * @param options - navigation, identity, active path and callbacks 导航、身份、当前路径与回调
 * @returns the shell 外壳
 */
export function shellView(ui, options) {
  const nav = Array.isArray(options.nav) ? options.nav : []
  const sidebar = el('aside', { class: 'sidebar', id: 'admin-sidebar' }, [
    el('div', { class: 'brand' }, [iconOf(ui, 'shield'), el('span', { text: ui.t('app.title') })]),
    el('nav', { class: 'nav', 'aria-label': ui.t('app.title') }, nav.map((node) => navLink(ui, node, options.path))),
  ])
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') !== null) sidebar.classList.remove('is-open')
  })
  return el('div', { class: 'shell' }, [
    sidebar,
    el('div', { class: 'main' }, [
      topBar(ui, options, sidebar),
      el('main', { class: 'content', id: 'admin-content' }, [options.children]),
    ]),
  ])
}

/**
 * Count one array field of a list payload.
 *
 * @param payload - list payload 列表载荷
 * @param key - field name 字段名
 * @returns the count, or null when absent 数量或 null
 */
function countOf(payload, key) {
  const value = payload?.[key]
  return Array.isArray(value) ? value.length : null
}

/**
 * Count capabilities that have an active provider.
 *
 * @param catalog - capability catalog 能力目录
 * @returns the count, or null when absent 数量或 null
 */
function activeCapabilityCount(catalog) {
  const states = catalog?.capabilities
  if (!Array.isArray(states)) return null
  return states.filter((state) => state?.active !== null && state?.active !== undefined).length
}

/**
 * Dashboard: welcome panel and three counters.
 *
 * @param ui - view helpers 视图助手
 * @param data - identity, users, capabilities and audit payloads 身份、用户、能力与审计载荷
 * @returns the page 页面
 */
export function dashboardView(ui, data) {
  const user = data.user ?? {}
  const stats = [
    { key: 'dashboard.users', value: countOf(data.users, 'items') },
    { key: 'dashboard.capabilities', value: activeCapabilityCount(data.capabilities) },
    { key: 'dashboard.audit', value: countOf(data.audit, 'items') },
  ]
  return el('section', { class: 'page' }, [
    pageHeader(ui, 'dashboard.title'),
    el('div', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: ui.t('dashboard.welcome') }),
      el('p', { class: 'panel-text', text: [user.name, user.email].filter(Boolean).join(' · ') || DASH }),
    ]),
    el('div', { class: 'stat-grid' }, stats.map((stat) => el('article', { class: 'stat' }, [
      el('p', { class: 'stat-label', text: ui.t(stat.key) }),
      el('p', { class: 'stat-value', text: stat.value === null ? DASH : String(stat.value) }),
    ]))),
  ])
}

/**
 * One user row with its edit and delete actions.
 *
 * @param ui - view helpers 视图助手
 * @param user - user view 用户视图
 * @param roleLabel - role id to label resolver 角色 id 到标签
 * @param actions - create/update/remove callbacks 增改删回调
 * @returns the row 行
 */
function userRow(ui, user, roleLabel, actions) {
  const roleNames = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles.map(roleLabel).join(', ') : DASH
  const edit = el('button', {
    class: 'icon-button',
    type: 'button',
    title: ui.t('users.edit'),
    'aria-label': ui.t('users.edit'),
    onclick: () => openEditUser(ui, user, actions),
  }, [iconOf(ui, 'edit')])
  const remove = el('button', {
    class: 'icon-button danger',
    type: 'button',
    title: ui.t('app.delete'),
    'aria-label': ui.t('app.delete'),
    onclick: () => openDeleteUser(ui, user, actions),
  }, [iconOf(ui, 'trash')])
  return el('tr', {}, [
    el('td', { text: asText(user.name) }),
    el('td', { text: asText(user.email) }),
    el('td', { text: roleNames }),
    el('td', {}, [
      el('span', {
        class: user.active === true ? 'badge ok' : 'badge muted',
        text: ui.t(user.active === true ? 'users.active' : 'users.inactive'),
      }),
    ]),
    el('td', { text: formatDate(user.lastLoginAt, ui.locale) }),
    el('td', { text: formatDate(user.createdAt, ui.locale) }),
    el('td', { class: 'cell-actions' }, [edit, remove]),
  ])
}

/**
 * Open the create-user dialog.
 *
 * @param ui - view helpers 视图助手
 * @param actions - user callbacks 用户回调
 */
function openCreateUser(ui, actions) {
  openModal(ui, {
    titleKey: 'users.create',
    fields: [
      { name: 'email', labelKey: 'auth.email', type: 'email', required: true },
      { name: 'password', labelKey: 'auth.password', type: 'password', autocomplete: 'new-password', required: true },
      { name: 'name', labelKey: 'auth.name', type: 'text', required: true },
    ],
    confirmKey: 'users.create',
    onConfirm: (values) => actions.create?.(values),
  })
}

/**
 * Open the edit-user dialog (name and active flag only).
 *
 * @param ui - view helpers 视图助手
 * @param user - the user being edited 正在编辑的用户
 * @param actions - user callbacks 用户回调
 */
function openEditUser(ui, user, actions) {
  openModal(ui, {
    titleKey: 'users.edit',
    fields: [
      { name: 'name', labelKey: 'auth.name', type: 'text', value: user.name ?? '', required: true },
      { name: 'active', labelKey: 'users.active', type: 'checkbox', value: user.active === true },
    ],
    confirmKey: 'app.save',
    onConfirm: (values) => actions.update?.(user.id, values),
  })
}

/**
 * Open the delete-user confirmation.
 *
 * @param ui - view helpers 视图助手
 * @param user - the user being deleted 正在删除的用户
 * @param actions - user callbacks 用户回调
 */
function openDeleteUser(ui, user, actions) {
  openModal(ui, {
    titleKey: 'app.delete',
    message: ui.t('users.deleteConfirm'),
    fields: [],
    confirmKey: 'app.delete',
    danger: true,
    onConfirm: () => actions.remove?.(user.id),
  })
}

/**
 * Users page: table plus create, edit and delete dialogs.
 *
 * @param ui - view helpers 视图助手
 * @param data - users, roles and action callbacks 用户、角色与操作回调
 * @returns the page 页面
 */
export function usersView(ui, data) {
  const users = data.users?.items ?? []
  const roles = data.roles?.items ?? []
  const actions = data.actions ?? {}
  const roleLabel = (id) => roles.find((role) => role.id === id)?.label ?? id
  const create = el('button', {
    class: 'button primary',
    type: 'button',
    onclick: () => openCreateUser(ui, actions),
  }, [iconOf(ui, 'plus'), el('span', { text: ui.t('users.create') })])
  const rows = users.map((user) => userRow(ui, user, roleLabel, actions))
  const columns = ['auth.name', 'users.email', 'users.roles', 'users.active', 'users.lastLogin', 'users.created', '']
  return el('section', { class: 'page' }, [pageHeader(ui, 'users.title', create), dataTable(ui, columns, rows)])
}

/**
 * Roles page: label, id, permissions and the built-in flag.
 *
 * @param ui - view helpers 视图助手
 * @param data - roles payload 角色载荷
 * @returns the page 页面
 */
export function rolesView(ui, data) {
  const roles = data.roles?.items ?? []
  const rows = roles.map((role) => el('tr', {}, [
    el('td', { text: asText(role.label) }),
    el('td', { text: asText(role.id) }),
    el('td', { class: 'cell-wrap', text: (Array.isArray(role.permissions) ? role.permissions : []).join(', ') || DASH }),
    el('td', {}, [
      el('span', {
        class: role.builtIn === true ? 'badge ok' : 'badge muted',
        text: ui.t(role.builtIn === true ? 'common.yes' : 'common.no'),
      }),
    ]),
  ]))
  return el('section', { class: 'page' }, [
    pageHeader(ui, 'roles.title'),
    dataTable(ui, ['roles.name', '', 'roles.permissions', 'roles.builtIn'], rows),
  ])
}

/**
 * Audit page with cursor paging.
 *
 * @param ui - view helpers 视图助手
 * @param data - audit page and load-more callback 审计页与加载更多回调
 * @returns the page 页面
 */
export function auditView(ui, data) {
  const page = data.audit ?? {}
  const items = Array.isArray(page.items) ? page.items : []
  const rows = items.map((entry) => el('tr', {}, [
    el('td', { text: asText(entry.actorLabel ?? entry.actorId) }),
    el('td', { text: asText(entry.action) }),
    el('td', {}, [resultBadge(ui, entry.result)]),
    el('td', { text: asText(entry.target) }),
    el('td', { text: formatDate(entry.at, ui.locale) }),
  ]))
  const section = el('section', { class: 'page' }, [
    pageHeader(ui, 'audit.title'),
    dataTable(ui, ['audit.actor', 'audit.action', 'audit.result', 'audit.target', 'audit.at'], rows),
  ])
  if (typeof page.nextCursor === 'string' && page.nextCursor !== '') {
    section.append(el('div', { class: 'page-footer' }, [
      el('button', {
        class: 'button',
        type: 'button',
        text: ui.t('audit.loadMore'),
        onclick: () => data.onLoadMore?.(page.nextCursor),
      }),
    ]))
  }
  return section
}

/**
 * One audit result badge.
 *
 * @param ui - view helpers 视图助手
 * @param result - audit result enum 审计结果枚举
 * @returns the badge 角标
 */
function resultBadge(ui, result) {
  const key = RESULT_KEYS[result]
  return el('span', {
    class: `badge ${RESULT_TONES[result] ?? 'muted'}`,
    text: key === undefined ? asText(result) : ui.t(key),
  })
}

/**
 * Capabilities page: provider, health badge and essential flag.
 *
 * @param ui - view helpers 视图助手
 * @param data - capability catalog 能力目录
 * @returns the page 页面
 */
export function capabilitiesView(ui, data) {
  const catalog = data.catalog ?? {}
  const states = Array.isArray(catalog.capabilities) ? catalog.capabilities : []
  const rows = states.map((state) => {
    const status = state.health?.status
    const key = HEALTH_KEYS[status]
    return el('tr', {}, [
      el('td', { text: asText(state.capability) }),
      el('td', { text: asText(state.active?.id) }),
      el('td', {}, [
        el('span', {
          class: `badge ${HEALTH_TONES[status] ?? 'muted'}`,
          text: key === undefined ? asText(status) : ui.t(key),
        }),
      ]),
      el('td', { text: ui.t(state.essential === true ? 'common.yes' : 'common.no') }),
    ])
  })
  const columns = ['capabilities.capability', 'capabilities.provider', 'capabilities.health', 'capabilities.essential']
  return el('section', { class: 'page' }, [pageHeader(ui, 'capabilities.title'), dataTable(ui, columns, rows)])
}
