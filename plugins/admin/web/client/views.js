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
 * Semantic sections of the permission catalog.
 *
 * Grouping is by what an operator is granting, not by the wire prefix: `admin.` covers
 * a read-only overview, identity, observability and system administration, so a prefix
 * split would put unrelated grants in one list. Order is the order of increasing
 * blast radius — overview first, terminal approvals last.
 *
 * 权限目录的语义分组。
 *
 * 分组依据是「操作者在授予什么」，而非线上前缀：`admin.` 同时覆盖只读概览、身份、可观测性
 * 与系统管理，按前缀切会把互不相关的授权塞进同一列表。顺序按影响面递增——概览在前，终端
 * 审批在后。
 */
const PERMISSION_GROUPS = [
  { id: 'overview', labelKey: 'permGroup.overview', permissions: ['admin.dashboard.read'] },
  {
    id: 'identity',
    labelKey: 'permGroup.identity',
    permissions: ['admin.users.manage', 'admin.roles.manage', 'admin.tokens.manage'],
  },
  {
    id: 'observe',
    labelKey: 'permGroup.observe',
    permissions: ['admin.audit.read', 'admin.capabilities.read'],
  },
  {
    id: 'system',
    labelKey: 'permGroup.system',
    permissions: ['admin.settings.write', 'admin.plugins.manage'],
  },
  {
    id: 'terminal',
    labelKey: 'permGroup.terminal',
    permissions: ['terminal.tasks.read', 'terminal.tasks.decide'],
  },
]

/**
 * Split the available permissions into the sections the picker renders.
 *
 * Every available value appears exactly once: a permission the catalog has never seen
 * (a newer provider) lands in the trailing `other` section instead of disappearing.
 * Empty sections are dropped, so a deployment with a narrower catalog shows no blank
 * groups.
 *
 * 把可用权限切成选择器要渲染的小节。
 *
 * 每个可用值恰好出现一次：目录里没有的权限（更新的 provider）落到末尾的 `other` 小节，
 * 而不是凭空消失。空小节会被丢弃，因此权限目录较窄的部署不会出现空白分组。
 *
 * @param available - permission wire values to place 要归位的权限线上值
 * @returns the sections in display order 按展示顺序排列的小节
 */
export function groupPermissions(available) {
  const pool = new Set(Array.isArray(available) ? available : [])
  const groups = []
  for (const group of PERMISSION_GROUPS) {
    const permissions = group.permissions.filter((permission) => pool.has(permission))
    if (permissions.length === 0) continue
    for (const permission of permissions) pool.delete(permission)
    groups.push({ id: group.id, labelKey: group.labelKey, permissions })
  }
  if (pool.size > 0) {
    groups.push({ id: 'other', labelKey: 'permGroup.other', permissions: [...pool].sort() })
  }
  return groups
}

/**
 * Count selected permissions overall and per section.
 *
 * @param groups - sections from {@link groupPermissions} 来自 {@link groupPermissions} 的小节
 * @param selected - selected permission values 已选权限值
 * @returns totals plus one entry per section 合计与逐小节计数
 */
export function selectionSummary(groups, selected) {
  const chosen = new Set(Array.isArray(selected) ? selected : [])
  const entries = groups.map((group) => ({
    id: group.id,
    total: group.permissions.length,
    selected: group.permissions.filter((permission) => chosen.has(permission)).length,
  }))
  return {
    total: entries.reduce((sum, entry) => sum + entry.total, 0),
    selected: entries.reduce((sum, entry) => sum + entry.selected, 0),
    groups: entries,
  }
}

/**
 * Invert a selection over the offered values.
 *
 * @param values - every offered permission 全部可选项
 * @param selected - currently selected permissions 当前已选权限
 * @returns the complement, in the offered order 补集，按可选项顺序
 */
export function invertSelection(values, selected) {
  const chosen = new Set(Array.isArray(selected) ? selected : [])
  return (Array.isArray(values) ? values : []).filter((value) => !chosen.has(value))
}

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
 * One page header: title, optional one-line description and an optional action.
 *
 * @param ui - view helpers 视图助手
 * @param titleKey - locale key 语言键
 * @param action - optional action node 可选操作节点
 * @param descriptionKey - optional locale key for the description 描述的可选语言键
 * @returns the header 头部
 */
function pageHeader(ui, titleKey, action, descriptionKey) {
  const heading = el('div', { class: 'page-heading' }, [el('h1', { class: 'page-title', text: ui.t(titleKey) })])
  if (descriptionKey !== undefined) heading.append(el('p', { class: 'page-desc', text: ui.t(descriptionKey) }))
  const header = el('header', { class: 'page-header' }, [heading])
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
  if (spec.type === 'permission-groups') return permissionGroupField(ui, spec)
  const input = el('input', {
    class: 'input',
    type: spec.type,
    name: spec.name,
    autocomplete: spec.autocomplete,
    required: spec.required === true,
    placeholder: spec.placeholderKey === undefined ? undefined : ui.t(spec.placeholderKey),
  })
  if (spec.type === 'checkbox') input.checked = spec.value === true
  else input.value = spec.value ?? ''
  const children = [el('span', { class: 'field-label', text: ui.t(spec.labelKey) }), input]
  // An optional hint sits under the control, e.g. "leave blank to keep the password".
  // 可选提示放在控件下方，例如「留空表示不修改密码」。
  if (spec.hintKey !== undefined) children.push(el('span', { class: 'field-hint', text: ui.t(spec.hintKey) }))
  const node = el('label', { class: spec.type === 'checkbox' ? 'field field-inline' : 'field' }, children)
  return {
    name: spec.name,
    node,
    read: () => (spec.type === 'checkbox' ? input.checked : input.value.trim()),
  }
}

/**
 * The permission picker: sections with per-section select-all, group summaries and a
 * global select-all / clear / invert toolbar.
 *
 * Every control is a real checkbox, so the browser supplies focus, keyboard toggling and
 * form semantics; the section and global summaries are recomputed from the inputs on every
 * change, which keeps the three levels of state unable to disagree.
 *
 * 权限选择器：分小节、每节可全选、组标题带汇总，顶部有全局全选/全不选/反选。
 *
 * 每个控件都是真正的复选框，浏览器因此负责焦点、键盘切换与表单语义；小节与全局汇总在每次
 * 变更后由输入框重新计算，三层状态因此不可能互相矛盾。
 *
 * @param ui - view helpers 视图助手
 * @param spec - name, label, offered permissions and selected values
 *   名称、标签、可授权限与已选值
 * @returns the fieldset node and an array reader 字段集节点与数组取值器
 */
function permissionGroupField(ui, spec) {
  const available = Array.isArray(spec.permissions) ? spec.permissions : []
  const groups = groupPermissions(available)
  const initial = new Set(Array.isArray(spec.values) ? spec.values : [])
  const inputs = new Map()
  const sections = []

  const selectedValues = () => available.filter((permission) => inputs.get(permission)?.checked === true)
  const globalCount = el('span', { class: 'picker-count' })

  const sync = () => {
    const summary = selectionSummary(groups, selectedValues())
    globalCount.textContent = `${summary.selected}/${summary.total}`
    for (const entry of summary.groups) {
      const section = sections.find((candidate) => candidate.id === entry.id)
      if (section === undefined) continue
      section.count.textContent = `${entry.selected}/${entry.total}`
      section.toggle.checked = entry.selected === entry.total
      // Indeterminate is the browser's own tri-state, so the header never claims
      // "all" while a member is off. 半选态用浏览器自带的三态，组标题绝不会在仍有成员未选时
      // 显示成「全选」。
      section.toggle.indeterminate = entry.selected > 0 && entry.selected < entry.total
    }
  }

  const setChecked = (values) => {
    const wanted = new Set(values)
    for (const [permission, input] of inputs) input.checked = wanted.has(permission)
    sync()
  }

  const groupNodes = groups.map((group) => {
    const toggle = el('input', {
      type: 'checkbox',
      class: 'picker-toggle',
      'aria-label': `${ui.t('permPicker.selectGroup')}: ${ui.t(group.labelKey)}`,
    })
    const count = el('span', { class: 'picker-group-count' })
    toggle.addEventListener('change', () => {
      for (const permission of group.permissions) {
        const input = inputs.get(permission)
        if (input !== undefined) input.checked = toggle.checked
      }
      sync()
    })
    const items = group.permissions.map((permission) => {
      const input = el('input', { type: 'checkbox', value: permission })
      input.checked = initial.has(permission)
      input.addEventListener('change', sync)
      inputs.set(permission, input)
      return el('label', { class: 'option', title: permission }, [
        input,
        el('span', { class: 'option-text' }, [
          el('span', { class: 'option-label', text: permissionLabel(ui, permission) }),
          // The raw value stays a subtitle: names are for reading, ids for tracing
          // back to what the gateway compares. 原始值保留为副标题：名称用于阅读，id 用于
          // 回溯网关的比较值。
          el('span', { class: 'option-id', text: permission }),
        ]),
      ])
    })
    const itemsId = `perm-group-${group.id}`
    const itemsNode = el('div', { class: 'picker-items', id: itemsId }, items)
    const chevron = el('span', { class: 'picker-chevron', 'aria-hidden': 'true' })
    const header = el('header', {
      class: 'picker-group-header',
      role: 'button',
      tabindex: '0',
      'aria-expanded': 'true',
      'aria-controls': itemsId,
      'aria-label': `${ui.t('permPicker.toggleGroup')}: ${ui.t(group.labelKey)}`,
    }, [chevron, toggle, el('span', { class: 'picker-group-name', text: ui.t(group.labelKey) }), count])
    const section = el('section', { class: 'picker-group' }, [header, itemsNode])
    const setCollapsed = (collapsed) => {
      section.classList.toggle('is-collapsed', collapsed)
      itemsNode.hidden = collapsed
      header.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    }
    header.addEventListener('click', (event) => {
      // The checkbox is the one hit area inside the header that must only change
      // selection; everything else in the row folds the section.
      // 复选框是标题行里唯一只改变选择的命中区；行内其它位置都折叠小节。
      if (event.target.closest('input') !== null) return
      setCollapsed(!section.classList.contains('is-collapsed'))
    })
    header.addEventListener('keydown', (event) => {
      // Only the header itself folds; a focused checkbox keeps its own Space behaviour.
      // 只有标题本身负责折叠；焦点在复选框上时保留其自身的空格行为。
      if (event.target !== header) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      setCollapsed(!section.classList.contains('is-collapsed'))
    })
    sections.push({ id: group.id, toggle, count })
    return section
  })

  const toolbar = el('div', { class: 'picker-toolbar' }, [
    el('button', {
      class: 'button small',
      type: 'button',
      text: ui.t('permPicker.all'),
      onclick: () => setChecked(available),
    }),
    el('button', {
      class: 'button small',
      type: 'button',
      text: ui.t('permPicker.none'),
      onclick: () => setChecked([]),
    }),
    el('button', {
      class: 'button small',
      type: 'button',
      text: ui.t('permPicker.invert'),
      onclick: () => setChecked(invertSelection(available, selectedValues())),
    }),
    globalCount,
  ])

  const node = el('fieldset', { class: 'field field-group permission-picker' }, [
    el('legend', { class: 'field-label', text: ui.t(spec.labelKey) }),
    toolbar,
    el('div', { class: 'picker-groups' }, groupNodes),
  ])
  sync()
  return {
    name: spec.name,
    node,
    read: selectedValues,
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
  return emptyState(ui, { titleKey: key })
}

/**
 * One empty or no-match state: icon, title, one sentence and optional actions.
 *
 * A no-match state is not the same fact as an empty collection, so callers pass
 * their own title/hint instead of reusing one generic sentence. The icon defaults
 * to the inbox for "nothing here yet"; search results pass the magnifier.
 *
 * 空态或“无命中”态：图标、标题、一句话说明与可选操作。
 *
 * “没有命中”与“集合为空”是两个不同事实，因此调用方传入各自的标题与提示，而不是共用
 * 一句通用文案。图标默认用收件箱表示“暂无内容”，搜索结果则用放大镜。
 *
 * @param ui - view helpers 视图助手
 * @param options - title, hint, icon and optional action nodes 标题、提示、图标与可选操作
 * @returns the state node 状态节点
 */
export function emptyState(ui, options = {}) {
  const titleKey = options.titleKey ?? 'app.empty'
  const hintKey = options.hintKey ?? 'app.emptyHint'
  const node = el('div', { class: 'state state-empty' }, [
    el('span', { class: 'state-icon' }, [iconOf(ui, options.icon ?? 'inbox')]),
    el('p', { class: 'state-title', text: ui.t(titleKey) }),
    el('p', { class: 'state-text', text: ui.t(hintKey) }),
  ])
  if (Array.isArray(options.actions) && options.actions.length > 0) {
    node.append(el('div', { class: 'state-actions' }, options.actions))
  }
  return node
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
  const email = field(ui, 'auth.email', 'email', {
    autocomplete: 'username',
    required: true,
    placeholder: ui.t('auth.emailPlaceholder'),
  })
  const password = field(ui, 'auth.password', 'password', {
    autocomplete: setupMode ? 'new-password' : 'current-password',
    required: true,
    placeholder: ui.t('auth.passwordPlaceholder'),
  })
  const name = setupMode
    ? field(ui, 'auth.name', 'text', {
      autocomplete: 'name',
      required: true,
      placeholder: ui.t('auth.namePlaceholder'),
    })
    : null
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
 * Self-service password dialog: the old password proves ownership, the new one must
 * satisfy the same policy the admin reset enforces.
 *
 * 自助修改密码对话框：旧口令用于证明身份，新口令必须满足与管理员重置相同的策略。
 *
 * @param ui - view helpers 视图助手
 * @param options - submit callback 提交回调
 */
export function changePasswordView(ui, options) {
  openModal(ui, {
    titleKey: 'auth.changePassword',
    fields: [
      {
        name: 'currentPassword',
        labelKey: 'auth.currentPassword',
        type: 'password',
        autocomplete: 'current-password',
        required: true,
        placeholderKey: 'auth.currentPasswordPlaceholder',
      },
      {
        name: 'newPassword',
        labelKey: 'auth.newPassword',
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        placeholderKey: 'users.passwordPlaceholder',
        hintKey: 'auth.passwordRule',
      },
    ],
    confirmKey: 'auth.changePassword',
    onConfirm: (values) => options.onSubmit?.(values),
  })
}

/**
 * Sidebar sections, in display order.
 *
 * The navigation data model stays a flat, permission-filtered list (a provider
 * contributes `{ path, labelKey, icon }`), so grouping lives in the shell: a known
 * path maps into its section and anything a newer provider adds falls into
 * "general" instead of disappearing.
 *
 * 侧栏分组，按展示顺序排列。
 *
 * 导航数据模型仍是扁平的、按权限裁剪的列表（provider 只贡献 `{ path, labelKey, icon }`），
 * 因此分组留在外壳里：已知路径归入对应分组，更新的 provider 新增的路径落入「通用」而不是
 * 消失。
 */
const NAV_SECTIONS = [
  { id: 'overview', labelKey: 'nav.section.overview', paths: ['/'] },
  { id: 'access', labelKey: 'nav.section.access', paths: ['/users', '/roles'] },
  { id: 'observability', labelKey: 'nav.section.observability', paths: ['/audit'] },
  { id: 'system', labelKey: 'nav.section.system', paths: ['/system'] },
]

/**
 * Test whether one navigation path belongs to a section's path list.
 *
 * @param path - navigation path 导航路径
 * @param paths - section path prefixes 分组路径前缀
 * @returns true when it belongs 属于该分组时为 true
 */
function inSection(path, paths) {
  return paths.some((candidate) => (candidate === '/'
    ? path === '/'
    : path === candidate || path.startsWith(`${candidate}/`)))
}

/**
 * Group navigation nodes into sidebar sections.
 *
 * @param nav - flat navigation nodes 扁平导航节点
 * @returns non-empty sections in display order 按展示顺序的非空分组
 */
export function groupNavigation(nav) {
  const nodes = Array.isArray(nav) ? nav : []
  const placed = new Set()
  const sections = []
  for (const section of NAV_SECTIONS) {
    const members = nodes.filter((node) => !placed.has(node) && inSection(String(node?.path ?? ''), section.paths))
    if (members.length === 0) continue
    for (const node of members) placed.add(node)
    sections.push({ id: section.id, labelKey: section.labelKey, nodes: members })
  }
  const rest = nodes.filter((node) => !placed.has(node))
  if (rest.length > 0) sections.push({ id: 'general', labelKey: 'nav.section.general', nodes: rest })
  return sections
}

/**
 * First visible character of a display name, for the avatar.
 *
 * @param name - display name or email 显示名或邮箱
 * @returns one uppercase character 一个大写字符
 */
function initialOf(name) {
  const text = String(name ?? '').trim()
  return text === '' ? '?' : [...text][0].toUpperCase()
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
 * The top bar: mobile menu toggle, breadcrumb, theme, locale and the avatar menu.
 *
 * @param ui - view helpers 视图助手
 * @param options - shell options 外壳选项
 * @param sidebar - sidebar node to toggle 要切换的侧栏节点
 * @param userMenu - avatar menu node 头像菜单节点
 * @returns the header 顶栏
 */
function topBar(ui, options, sidebar, userMenu) {
  const menuToggle = el('button', {
    class: 'icon-button menu-toggle',
    type: 'button',
    'aria-label': ui.t('app.title'),
    'aria-controls': 'admin-sidebar',
    onclick: () => sidebar.classList.toggle('is-open'),
  }, [iconOf(ui, 'menu')])
  const breadcrumb = el('nav', { class: 'breadcrumb', 'aria-label': ui.t('app.breadcrumb') }, [
    el('span', { class: 'breadcrumb-app', text: ui.t('app.title') }),
    el('span', { class: 'breadcrumb-sep', 'aria-hidden': 'true', text: '/' }),
    el('span', { class: 'breadcrumb-page', text: options.pageTitle ?? ui.t('app.title') }),
  ])
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
  return el('header', { class: 'topbar' }, [
    menuToggle,
    breadcrumb,
    el('div', { class: 'topbar-actions' }, [theme, locale, userMenu]),
  ])
}

/**
 * Sidebar, top bar and scrollable content.
 *
 * The sidebar keeps its grouping, collapse state and user card here; the content
 * region stays a single scroll container so pages never fight the shell for
 * scrolling.
 *
 * 侧栏、顶栏与可滚动内容区。
 *
 * 分组、折叠状态与用户卡都留在侧栏里；内容区仍是唯一的滚动容器，页面因此不必和外壳争夺
 * 滚动权。
 *
 * @param ui - view helpers 视图助手
 * @param options - navigation, identity, active path, collapse state and callbacks
 *   导航、身份、当前路径、折叠状态与回调
 * @returns the shell 外壳
 */
export function shellView(ui, options) {
  const nav = Array.isArray(options.nav) ? options.nav : []
  const sections = groupNavigation(nav)
  const collapsed = options.collapsed === true

  const avatar = () => el('span', { class: 'avatar', 'aria-hidden': 'true', text: initialOf(options.userName) })
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': ui.t('app.userMenu') }, [
    el('button', {
      class: 'menu-item',
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        closeUserMenu()
        options.onChangePassword?.()
      },
    }, [iconOf(ui, 'key'), el('span', { text: ui.t('auth.changePassword') })]),
    el('div', { class: 'menu-sep', role: 'separator' }),
    el('button', {
      class: 'menu-item danger',
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        closeUserMenu()
        options.onSignOut?.()
      },
    }, [iconOf(ui, 'logout'), el('span', { text: ui.t('auth.signOut') })]),
  ])
  const avatarButton = el('button', {
    class: 'icon-button avatar-button',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': ui.t('app.userMenu'),
    onclick: toggleUserMenu,
  }, [avatar()])
  const userCard = el('button', {
    class: 'user-card',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: toggleUserMenu,
  }, [
    avatar(),
    el('span', { class: 'user-card-text' }, [
      el('span', { class: 'user-card-name', text: options.userName }),
      el('span', { class: 'user-card-meta', text: options.userMeta ?? '' }),
    ]),
  ])

  /** Open or close the avatar menu, keeping both triggers' ARIA state in sync. 开合头像菜单，并同步两个触发器的 ARIA 状态。 */
  function toggleUserMenu() {
    const open = menu.classList.toggle('is-open')
    for (const trigger of [avatarButton, userCard]) trigger.setAttribute('aria-expanded', String(open))
    // Focus the first item so the menu is operable without a pointer. 聚焦首项，菜单无需指针即可操作。
    if (open) menu.querySelector('.menu-item')?.focus()
  }

  /**
   * Close the avatar menu.
   *
   * @param restoreFocus - return focus to the avatar button 把焦点交回头像按钮
   */
  function closeUserMenu(restoreFocus = false) {
    if (!menu.classList.contains('is-open')) return
    menu.classList.remove('is-open')
    for (const trigger of [avatarButton, userCard]) trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) avatarButton.focus()
  }

  const brand = el('div', { class: 'brand' }, [
    el('span', { class: 'brand-mark' }, [iconOf(ui, 'shield')]),
    el('span', { class: 'brand-name', text: ui.t('app.title') }),
    el('button', {
      class: 'icon-button sidebar-toggle',
      type: 'button',
      title: ui.t(collapsed ? 'app.expandSidebar' : 'app.collapseSidebar'),
      'aria-label': ui.t(collapsed ? 'app.expandSidebar' : 'app.collapseSidebar'),
      'aria-expanded': String(!collapsed),
      onclick: options.onToggleSidebar,
    }, [el('span', { class: 'chevron', 'aria-hidden': 'true' })]),
  ])
  const navNode = el('nav', { class: 'nav', 'aria-label': ui.t('app.title') }, sections.map((section) => el('div', { class: 'nav-section' }, [
    el('p', { class: 'nav-section-label', text: ui.t(section.labelKey) }),
    section.nodes.map((node) => navLink(ui, node, options.path)),
  ])))
  const sidebar = el('aside', { class: 'sidebar', id: 'admin-sidebar' }, [
    brand,
    navNode,
    el('div', { class: 'sidebar-foot' }, [userCard]),
  ])
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') !== null) sidebar.classList.remove('is-open')
    closeUserMenu()
  })

  const shell = el('div', { class: collapsed ? 'shell is-collapsed' : 'shell' }, [
    sidebar,
    el('div', { class: 'main' }, [
      topBar(ui, options, sidebar, el('div', { class: 'user-menu-wrap' }, [avatarButton, menu])),
      el('main', { class: 'content', id: 'admin-content' }, [options.children]),
    ]),
  ])
  // Light dismiss: a click anywhere outside the menu closes it. The listener lives
  // on the shell, so it dies with the shell on the next repaint.
  // 轻量关闭：菜单外任意点击关闭。监听器挂在 shell 上，下次重绘时随外壳一起消失。
  shell.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null) return
    if (target.closest('.user-menu-wrap') !== null || target.closest('.user-card') !== null) return
    closeUserMenu()
  })
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeUserMenu(true)
  })
  return shell
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
    pageHeader(ui, 'dashboard.title', undefined, 'dashboard.description'),
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
      {
        name: 'email',
        labelKey: 'auth.email',
        type: 'email',
        required: true,
        placeholderKey: 'auth.emailPlaceholder',
      },
      {
        name: 'password',
        labelKey: 'auth.password',
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        placeholderKey: 'users.passwordPlaceholder',
      },
      {
        name: 'name',
        labelKey: 'auth.name',
        type: 'text',
        required: true,
        placeholderKey: 'users.namePlaceholder',
      },
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
      {
        name: 'password',
        labelKey: 'users.passwordReset',
        type: 'password',
        autocomplete: 'new-password',
        placeholderKey: 'users.passwordPlaceholder',
        hintKey: 'users.passwordKeepHint',
      },
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
 * Filter users by an email or name keyword.
 *
 * The match is a case-insensitive substring test over both fields, so typing
 * `ali` finds `alice@example.com` and `Alice` alike. An empty or blank keyword
 * keeps every user, which is what a cleared search box must mean.
 *
 * 按邮箱或姓名关键字过滤用户。
 *
 * 匹配是对两个字段做大小写不敏感的子串判断，因此输入 `ali` 既能命中
 * `alice@example.com` 也能命中 `Alice`；关键字为空或全空白时保留全部用户，这也正是清空
 * 搜索框应有的语义。
 *
 * @param users - the users to filter 待过滤的用户
 * @param query - the keyword typed by the operator 操作者输入的关键字
 * @returns the users matching the keyword 命中关键字的用户
 */
export function filterUsers(users, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  if (needle === '') return users
  return users.filter((user) => [user?.email, user?.name]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)))
}

/**
 * Users page: searchable table plus create, edit and delete dialogs.
 *
 * The keyword filters the already-loaded page in the browser: the list is bounded
 * by the gateway's page size, so a round trip per keystroke would cost more than
 * it explains.
 *
 * 用户页：可检索表格与增改删对话框。
 *
 * 关键字在浏览器内过滤已加载的这一页数据：列表受网关分页上限约束，逐键往返请求的代价
 * 大于它带来的解释力。
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
  const search = el('input', {
    class: 'input search-input',
    type: 'search',
    autocomplete: 'off',
    placeholder: ui.t('users.searchPlaceholder'),
    'aria-label': ui.t('users.searchPlaceholder'),
  })
  const columns = ['auth.name', 'users.email', 'users.roles', 'users.active', 'users.lastLogin', 'users.created', '']
  const results = el('div', { class: 'search-results' })
  const render = () => {
    const matches = filterUsers(users, search.value)
    // No user at all and no match are different facts, so they get different copy.
    // “一个用户都没有”与“没有命中”是两件事，因此使用不同文案。
    results.replaceChildren(matches.length === 0 && users.length > 0
      ? emptyState(ui, { icon: 'search', titleKey: 'users.searchEmpty', hintKey: 'app.searchHint' })
      : dataTable(ui, columns, matches.map((user) => userRow(ui, user, roleLabel, actions))))
  }
  search.addEventListener('input', render)
  render()
  return el('section', { class: 'page' }, [
    pageHeader(ui, 'users.title', create, 'users.description'),
    el('div', { class: 'toolbar' }, [search]),
    results,
  ])
}

/**
 * Locale key of one permission's human-readable name.
 *
 * The key carries the wire value (`perm.admin.users.manage`), so adding a
 * permission needs exactly one locale entry and nothing else.
 *
 * 某个权限的人类可读名对应的语言键。键里带线上值（`perm.admin.users.manage`），
 * 因此新增权限只需要补一条文案。
 *
 * @param permission - permission wire value 权限线上值
 * @returns the locale key 语言键
 */
function permissionKey(permission) {
  return `perm.${permission}`
}

/**
 * Human-readable name of one permission.
 *
 * Falls back to the raw wire value when the locale pack has no entry, so a
 * permission added by a newer provider stays readable instead of rendering a
 * dangling key.
 *
 * 权限的人类可读名。语言包缺失时回退到原始线上值，因此更新的 provider 新增的权限仍然
 * 可读，而不会渲染出一个悬空的键。
 *
 * @param ui - view helpers 视图助手
 * @param permission - permission wire value 权限线上值
 * @returns the display name 显示名
 */
function permissionLabel(ui, permission) {
  const key = permissionKey(permission)
  const text = ui.t(key)
  return text === key ? permission : text
}

/**
 * Permission values the role dialogs offer: the union of every loaded role's
 * grants, which is exactly the catalog the gateway accepts.
 *
 * 角色对话框提供的权限值：已加载角色授予项的并集，也就是网关会接受的目录。
 *
 * @param roles - loaded roles 已加载角色
 * @returns the sorted permission strings 排序后的权限串
 */
function permissionOptions(roles) {
  const values = roles.flatMap((role) => (Array.isArray(role.permissions) ? role.permissions : []))
  return [...new Set(values)].sort()
}

/**
 * Open the create-role dialog.
 *
 * @param ui - view helpers 视图助手
 * @param actions - role callbacks 角色回调
 * @param permissions - permission values to offer 可选权限值
 */
function openCreateRole(ui, actions, permissions) {
  openModal(ui, {
    titleKey: 'roles.create',
    fields: [
      {
        name: 'label',
        labelKey: 'roles.label',
        type: 'text',
        required: true,
        placeholderKey: 'roles.namePlaceholder',
      },
      {
        name: 'id',
        labelKey: 'roles.id',
        type: 'text',
        required: true,
        placeholderKey: 'roles.idPlaceholder',
      },
      {
        name: 'permissions',
        labelKey: 'roles.permissions',
        type: 'permission-groups',
        permissions,
        values: [],
      },
    ],
    confirmKey: 'roles.create',
    onConfirm: (values) => actions.create?.(values),
  })
}

/**
 * Open the edit-role dialog for one custom role.
 *
 * The id is identity, not a field: it is shown as dialog text so an edit can never
 * silently rebind users to a different role.
 *
 * 打开某个自定义角色的编辑对话框。id 是身份而非字段：只作为对话框文本展示，避免编辑
 * 悄悄把用户重绑到另一个角色。
 *
 * @param ui - view helpers 视图助手
 * @param role - the role being edited 正在编辑的角色
 * @param actions - role callbacks 角色回调
 * @param permissions - permission values to offer 可选权限值
 */
function openEditRole(ui, role, actions, permissions) {
  openModal(ui, {
    titleKey: 'roles.edit',
    message: `${ui.t('roles.id')}: ${role.id}`,
    fields: [
      {
        name: 'label',
        labelKey: 'roles.label',
        type: 'text',
        value: role.label ?? '',
        required: true,
        placeholderKey: 'roles.namePlaceholder',
      },
      {
        name: 'permissions',
        labelKey: 'roles.permissions',
        type: 'permission-groups',
        permissions,
        values: Array.isArray(role.permissions) ? role.permissions : [],
      },
    ],
    confirmKey: 'app.save',
    onConfirm: (values) => actions.update?.(role.id, values),
  })
}

/**
 * One role row: identity, grants, the built-in flag and its action.
 *
 * Built-in roles are code, so their action cell carries the restriction as copy
 * instead of a button that would fail.
 *
 * 单个角色行：身份、授权、内置标记与操作。内置角色是代码，因此操作列用文案说明限制，
 * 而不是放一个必然失败的按钮。
 *
 * @param ui - view helpers 视图助手
 * @param role - the role 角色
 * @param actions - role callbacks 角色回调
 * @param permissions - permission values to offer 可选权限值
 * @returns the row 行
 */
function roleRow(ui, role, actions, permissions) {
  const granted = Array.isArray(role.permissions) ? role.permissions : []
  const actionCell = role.builtIn === true
    ? el('td', { class: 'cell-actions' }, [el('span', { class: 'hint', text: ui.t('roles.builtInHint') })])
    : el('td', { class: 'cell-actions' }, [
      el('button', {
        class: 'icon-button',
        type: 'button',
        title: ui.t('roles.edit'),
        'aria-label': ui.t('roles.edit'),
        onclick: () => openEditRole(ui, role, actions, permissions),
      }, [iconOf(ui, 'edit')]),
    ])
  return el('tr', {}, [
    el('td', { text: asText(role.label) }),
    el('td', { text: asText(role.id) }),
    el('td', {
      class: 'cell-wrap',
      // The wire values stay reachable on hover even though the cell shows names.
      // 即使单元格显示名称，悬停时仍可看到线上值。
      title: granted.join(', '),
      text: granted.map((permission) => permissionLabel(ui, permission)).join(ui.t('app.listSeparator')) || DASH,
    }),
    el('td', {}, [
      el('span', {
        class: role.builtIn === true ? 'badge ok' : 'badge muted',
        text: ui.t(role.builtIn === true ? 'common.yes' : 'common.no'),
      }),
    ]),
    actionCell,
  ])
}

/**
 * Roles page: the role directory plus create and edit dialogs.
 *
 * @param ui - view helpers 视图助手
 * @param data - roles payload and action callbacks 角色载荷与操作回调
 * @returns the page 页面
 */
export function rolesView(ui, data) {
  const roles = data.roles?.items ?? []
  const actions = data.actions ?? {}
  const permissions = permissionOptions(roles)
  const create = el('button', {
    class: 'button primary',
    type: 'button',
    onclick: () => openCreateRole(ui, actions, permissions),
  }, [iconOf(ui, 'plus'), el('span', { text: ui.t('roles.create') })])
  const rows = roles.map((role) => roleRow(ui, role, actions, permissions))
  const columns = ['roles.name', '', 'roles.permissions', 'roles.builtIn', '']
  return el('section', { class: 'page' }, [
    pageHeader(ui, 'roles.title', create, 'roles.description'),
    dataTable(ui, columns, rows),
  ])
}

/**
 * Filter audit entries by a keyword over action, actor, target and result.
 *
 * The match is a case-insensitive substring test and an empty keyword keeps every
 * entry, which is what a cleared search box must mean. Filtering happens over the
 * pages already loaded, so it never hides the fact that more pages exist.
 *
 * 按关键字过滤审计记录，覆盖操作类型、操作者、对象与结果。
 *
 * 匹配为大小写不敏感的子串判断；关键字为空时保留全部记录，这正是清空搜索框应有的
 * 语义。过滤只作用于已加载的页面，因此不会掩盖「还有更多页」这一事实。
 *
 * @param items - loaded audit entries 已加载审计记录
 * @param query - the keyword typed by the operator 操作者输入的关键字
 * @returns the entries matching the keyword 命中关键字的记录
 */
export function filterAudit(items, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  if (needle === '') return items
  return items.filter((entry) => [entry?.action, entry?.actorLabel, entry?.actorId, entry?.target, entry?.result]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)))
}

/**
 * One audit table row.
 *
 * @param ui - view helpers 视图助手
 * @param entry - one audit entry 单条审计记录
 * @returns the row 行
 */
function auditRow(ui, entry) {
  return el('tr', {}, [
    el('td', { text: asText(entry.actorLabel ?? entry.actorId) }),
    el('td', { text: asText(entry.action) }),
    el('td', {}, [resultBadge(ui, entry.result)]),
    el('td', { text: asText(entry.target) }),
    el('td', { text: formatDate(entry.at, ui.locale) }),
  ])
}

/**
 * Audit page with keyword search and cursor paging.
 *
 * @param ui - view helpers 视图助手
 * @param data - audit page and load-more callback 审计页与加载更多回调
 * @returns the page 页面
 */
export function auditView(ui, data) {
  const page = data.audit ?? {}
  const items = Array.isArray(page.items) ? page.items : []
  const columns = ['audit.actor', 'audit.action', 'audit.result', 'audit.target', 'audit.at']
  const search = el('input', {
    class: 'input search-input',
    type: 'search',
    autocomplete: 'off',
    placeholder: ui.t('audit.searchPlaceholder'),
    'aria-label': ui.t('audit.searchPlaceholder'),
  })
  const results = el('div', { class: 'search-results' })
  const render = () => {
    const matches = filterAudit(items, search.value)
    results.replaceChildren(matches.length === 0 && items.length > 0
      ? emptyState(ui, { icon: 'search', titleKey: 'audit.searchEmpty', hintKey: 'app.searchHint' })
      : dataTable(ui, columns, matches.map((entry) => auditRow(ui, entry))))
  }
  search.addEventListener('input', render)
  render()
  const section = el('section', { class: 'page' }, [
    pageHeader(ui, 'audit.title', undefined, 'audit.description'),
    el('div', { class: 'toolbar' }, [search]),
    results,
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
  return el('section', { class: 'page' }, [pageHeader(ui, 'capabilities.title', undefined, 'capabilities.description'), dataTable(ui, columns, rows)])
}
