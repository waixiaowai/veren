/**
 * Entry module of the admin SPA.
 *
 * It owns everything that is not pack data or a pure view: the boot sequence,
 * History-API routing, session handling, theme and locale switches, and toasts.
 * Packs contribute data; views render nodes; this file joins the two.
 *
 * 后台 SPA 的入口模块。它拥有“既不是包数据、也不是纯视图”的一切：启动顺序、History API
 * 路由、会话处理、主题与语言切换、提示。包贡献数据，视图渲染节点，本文件负责连接两者。
 *
 * Boot order mirrors the Host contract: read the public UI manifest, load the
 * packs, then ask `/bootstrap` who the caller is. A 401 means "not signed in",
 * which is a normal branch, not an error.
 *
 * 启动顺序与宿主契约一致：先读公开 UI 清单、加载包，再问 `/bootstrap` 调用方是谁。401 表示
 * “未登录”，这是一条正常分支，不是错误。
 *
 * @module @veren/admin-web/client/app.js
 */

import {
  adminManifest,
  bootstrap,
  capabilities,
  changePassword,
  createRole,
  createUser,
  deleteUser,
  getSetup,
  listAudit,
  listRoles,
  listUsers,
  login,
  logout,
  publicManifest,
  setCsrfToken,
  setup,
  updateRole,
  updateUser,
} from './api.js'
import { createRuntime } from './runtime.js'
import {
  auditView,
  authView,
  capabilitiesView,
  changePasswordView,
  dashboardView,
  el,
  emptyView,
  errorView,
  forbiddenView,
  loadingView,
  notFoundView,
  rolesView,
  shellView,
  usersView,
} from './views.js'

/** Theme preference key. 主题偏好键。 */
const THEME_KEY = 'admin.theme'

/** Locale preference key. 语言偏好键。 */
const LOCALE_KEY = 'admin.locale'

/** Theme cycle order. 主题循环顺序。 */
const THEME_ORDER = ['light', 'dark', 'system']

/** SPA mount path, derived from this module's own URL instead of a literal. 由本模块自身 URL 推导的 SPA 挂载路径，而非字面量。 */
const BASE = new URL('../', import.meta.url).pathname.replace(/\/+$/, '')

/** Client route to view name. 客户端路由到视图名。 */
const ROUTES = {
  '/': 'dashboard',
  '/users': 'users',
  '/roles': 'roles',
  '/audit': 'audit',
  '/system/capabilities': 'capabilities',
}

/** Permission each non-dashboard view requires. 每个非仪表盘视图所需的权限。 */
const PERMISSION = {
  users: 'admin.users.manage',
  roles: 'admin.roles.manage',
  audit: 'admin.audit.read',
  capabilities: 'admin.capabilities.read',
}

/** Mount point of the SPA. SPA 的挂载点。 */
const root = document.getElementById('root')

/** Live region every toast is appended to. 所有提示追加到的实时区域。 */
const toasts = el('div', { class: 'toast-region', 'aria-live': 'polite' })

/** The pack runtime. 包运行时。 */
const runtime = createRuntime()

/** Everything the SPA needs between two paints. 两次绘制之间 SPA 需要的一切。 */
const state = {
  bootstrap: null,
  auth: null,
  route: '/',
  theme: 'system',
  locale: 'en',
  locales: [],
  icons: {},
  data: {},
}

/**
 * Read one preference, tolerating blocked storage.
 *
 * @param key - storage key 存储键
 * @returns the stored text, or `null` 已存文本或 `null`
 */
function restore(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    // 隐私模式可能禁用 localStorage；偏好退回默认值即可。
    // Private mode may block localStorage; falling back to defaults is fine.
    return null
  }
}

/**
 * Write one preference, tolerating blocked storage.
 *
 * @param key - storage key 存储键
 * @param value - value to store 要存的值
 */
function store(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 同上：存不下就只是不持久化。
    // Same as above: failing to persist only loses the preference.
  }
}

/** Resolve one locale message, falling back to the key itself. 解析一条语言消息，缺失时回退到键。 */
function t(key) {
  const locale = state.locales.find((entry) => entry.id === state.locale)
  const message = locale?.messages?.[key]
  return typeof message === 'string' ? message : key
}

/** Resolve one icon name through the merged icon packs. 在合并后的图标包里解析图标名。 */
const icon = (name) => state.icons[name]

/** Path of a client route, including the mount prefix. 客户端路由的完整路径（含挂载前缀）。 */
const href = (path) => `${BASE}${path === '/' ? '/' : path}`

/** The helper object every view receives. 每个视图收到的助手对象。 */
const ui = () => ({ t, icon, href, locale: state.locale })

/** Effective colour scheme. 生效的配色方案。 */
function scheme() {
  if (state.theme !== 'system') return state.theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Apply the first registered theme, or leave the stylesheet defaults. 应用首个已注册主题，否则保留样式表默认值。 */
function applyTheme() {
  const element = document.documentElement
  const current = scheme()
  element.dataset.scheme = current
  const theme = runtime.listThemes()[0]
  const tokens = theme === undefined ? {} : current === 'dark' ? theme.dark : theme.light
  for (const [name, value] of Object.entries(tokens ?? {})) element.style.setProperty(name, String(value))
}

/** Replace the whole screen. 整体替换屏幕内容。 */
const paint = (node) => root.replaceChildren(node)

/** Append one transient toast. 追加一条临时提示。 */
function toast(message) {
  toasts.append(el('div', { class: 'toast', role: 'status', text: String(message) }))
  const node = toasts.lastElementChild
  if (node !== null) setTimeout(() => node.remove(), 4000)
}

/**
 * Localized text for one API failure.
 *
 * Structured reasons the UI can explain better than the server's English message
 * get first-class copy; everything else keeps the server's own wording, because
 * inventing text for an unknown failure hides the diagnostic.
 *
 * 某个 API 失败的本地化文本。
 *
 * UI 能比服务端英文消息解释得更好的结构化原因使用专门文案；其余保留服务端原文，因为给
 * 未知失败编造文案会掩盖诊断信息。
 *
 * @param error - the rejected value 被拒绝的错误值
 * @returns the message to show 要显示的文本
 */
function messageOf(error) {
  if (error?.code === 'VALIDATION_FAILED') {
    const reason = error?.details?.reason
    if (reason === 'UNCHANGED') return t('users.passwordUnchanged')
    if (reason === 'WRONG_PASSWORD') return t('auth.wrongPassword')
    if (reason === 'TOO_SHORT') return t('auth.passwordTooShort')
  }
  return error?.message ?? String(error)
}

/** Wrap an action so a rejection becomes a toast instead of an unhandled rejection. 包装操作，让失败变成提示而非未处理拒绝。 */
function guard(handler) {
  return async (...args) => {
    try {
      await handler(...args)
    } catch (error) {
      toast(messageOf(error))
    }
  }
}

/** Await a request, treating 401 as "session gone" rather than a page error. 等待请求，把 401 当作“会话失效”而非页面错误。 */
async function settle(promise) {
  try {
    return await promise
  } catch (error) {
    if (error?.status === 401) await handleUnauthorized()
    return null
  }
}

/** Current client route. 当前客户端路由。 */
function routePath() {
  const path = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname
  return path === '' ? '/' : path
}

/** Navigate without a reload. 无刷新导航。 */
function navigate(path, options = {}) {
  history[options.replace === true ? 'replaceState' : 'pushState']({ path }, '', href(path))
  state.route = path
  render()
}

/** Merge every registered icon set, later packs winning. 合并所有图标集，后注册者优先。 */
function mergeIcons(sets) {
  const merged = {}
  for (const set of sets) Object.assign(merged, set.icons ?? {})
  return merged
}

/**
 * Fetch and load one manifest, then refresh what packs contributed.
 *
 * @param fetcher - manifest request 清单请求
 */
async function loadPacks(fetcher) {
  try {
    const manifest = await fetcher()
    await runtime.loadPacks(manifest?.packs ?? [])
  } catch (error) {
    // 清单不可用也绝不白屏：没有包就用样式表与键回退继续渲染。
    // A manifest outage must not blank the app: without packs the stylesheet and key fallbacks carry it.
    console.warn('[admin] UI manifest could not be loaded; continuing with built-in defaults.', error)
  }
  state.locales = runtime.listLocales()
  state.icons = mergeIcons(runtime.listIconSets())
  if (!state.locales.some((locale) => locale.id === state.locale)) state.locale = state.locales[0]?.id ?? state.locale
}

/** First-run probe plus whichever auth form it implies. 首次运行探测以及它对应的认证表单。 */
async function showAuth(message) {
  state.bootstrap = null
  let setupRequired = false
  try {
    setupRequired = (await getSetup())?.required === true
  } catch (error) {
    console.warn('[admin] first-run probe failed; assuming sign-in.', error)
  }
  state.auth = { setupRequired, error: typeof message === 'string' ? message : '' }
  paintAuth()
}

/** Paint the auth screen from remembered state. 依据记住的状态绘制认证屏。 */
function paintAuth() {
  if (state.auth === null) {
    paint(loadingView(ui()))
    return
  }
  paint(authView(ui(), { ...state.auth, onSubmit: submitAuth }))
}

/** Complete sign-in or first-run setup, then re-enter the app. 完成登录或初始化，然后重新进入应用。 */
async function submitAuth(mode, values) {
  try {
    const result = mode === 'setup' ? await setup(values) : await login(values)
    setCsrfToken(result?.csrfToken)
    await loadPacks(adminManifest)
    applyTheme()
    await enter()
  } catch (error) {
    await showAuth(error?.code === 'AUTH_REQUIRED' ? t('auth.invalid') : error?.message)
  }
}

/** Ask the Host who we are and render the first authenticated screen. 向宿主询问身份并渲染首个认证界面。 */
async function enter() {
  try {
    const payload = await bootstrap()
    state.bootstrap = { ...payload, permissions: payload?.permissions ?? [], nav: payload?.nav ?? [] }
    state.auth = null
    state.data = {}
    render()
  } catch (error) {
    state.bootstrap = null
    if (error?.status === 401) await showAuth()
    else paint(errorView(ui(), { message: error?.message, onRetry: start }))
  }
}

/** Sign out through the Host, then show the auth screen. 通过宿主退出登录，然后显示认证屏。 */
async function signOut() {
  try {
    await logout()
  } catch (error) {
    console.warn('[admin] sign-out request failed; clearing the client anyway.', error)
  }
  setCsrfToken(null)
  state.bootstrap = null
  state.data = {}
  state.route = '/'
  history.replaceState({ path: '/' }, '', href('/'))
  await showAuth()
}

/** A 401 from any page request means the session is gone. 任何页面请求的 401 都表示会话失效。 */
async function handleUnauthorized() {
  if (state.bootstrap === null) return
  await showAuth()
}

/** Load one route's data, isolating each request. 加载某个路由的数据，逐请求隔离。 */
async function loadRouteData(route, view) {
  const loaders = {
    dashboard: async () => {
      const [users, catalog, audit] = await Promise.all([
        settle(listUsers()),
        settle(capabilities()),
        settle(listAudit({ limit: 5 })),
      ])
      return { users, capabilities: catalog, audit }
    },
    users: async () => {
      const [users, roles] = await Promise.all([settle(listUsers()), settle(listRoles())])
      return { users, roles }
    },
    roles: async () => ({ roles: await settle(listRoles()) }),
    audit: async () => ({ audit: await settle(listAudit({ limit: 50 })) }),
    capabilities: async () => ({ catalog: await settle(capabilities()) }),
  }
  const loader = loaders[view]
  state.data[route] = loader === undefined ? {} : await loader()
}

/** Page actions of the users view. 用户页的操作。 */
function userActions() {
  return {
    create: guard(async (values) => {
      await createUser(values)
      toast(t('toast.created'))
      await reload('/users')
    }),
    update: guard(async (id, patch) => {
      // A blank password field means "keep the current password", so it never
      // travels to the gateway; only a typed value is a reset.
      // 密码框留空表示「保持当前密码」，因此不发给网关；只有填写了才是重置。
      const { password, ...rest } = patch
      const body = typeof password === 'string' && password.trim() !== '' ? { ...rest, password } : rest
      await updateUser(id, body)
      toast(t('toast.saved'))
      await reload('/users')
    }),
    remove: guard(async (id) => {
      await deleteUser(id)
      toast(t('toast.deleted'))
      await reload('/users')
    }),
  }
}

/** Page actions of the roles view. 角色页的操作。 */
function roleActions() {
  return {
    create: guard(async (values) => {
      await createRole(values)
      toast(t('toast.created'))
      await reload('/roles')
    }),
    update: guard(async (id, patch) => {
      await updateRole(id, patch)
      toast(t('toast.saved'))
      await reload('/roles')
    }),
  }
}

/** Append the next audit page. 追加下一页审计记录。 */
const loadMoreAudit = guard(async (cursor) => {
  const page = await listAudit({ limit: 50, cursor })
  const current = state.data['/audit']?.audit ?? { items: [] }
  state.data['/audit'] = {
    audit: { items: [...(current.items ?? []), ...(page?.items ?? [])], nextCursor: page?.nextCursor },
  }
  render()
})

/** Drop one route's cache and repaint. 丢弃某个路由的缓存并重绘。 */
async function reload(route) {
  delete state.data[route]
  render()
}

/** Build the content node of one view. 构建某个视图的内容节点。 */
function contentFor(view) {
  const helpers = ui()
  const data = state.data[state.route] ?? {}
  if (view === 'dashboard') return dashboardView(helpers, { user: state.bootstrap.user, ...data })
  if (view === 'users') return usersView(helpers, { ...data, actions: userActions() })
  if (view === 'roles') return rolesView(helpers, { ...data, actions: roleActions() })
  if (view === 'audit') return auditView(helpers, { ...data, onLoadMore: loadMoreAudit })
  if (view === 'capabilities') return capabilitiesView(helpers, data)
  return emptyView(helpers)
}

/** Wrap content in the shell. 把内容包进外壳。 */
function withShell(content) {
  return shellView(ui(), {
    nav: state.bootstrap.nav,
    path: state.route,
    userName: state.bootstrap.user.name || state.bootstrap.user.email,
    theme: scheme(),
    localeLabel: nextLocaleLabel(),
    children: content,
    onCycleTheme: cycleTheme,
    onToggleLocale: toggleLocale,
    onChangePassword: openChangePassword,
    onSignOut: signOut,
  })
}

/**
 * Open the self-service password dialog.
 *
 * The server keeps the session that asks and revokes the user's other sessions, so a
 * successful change never signs the operator out of the tab they are using.
 *
 * 打开自助修改密码对话框。
 *
 * 服务端保留发起请求的会话并吊销该用户的其它会话，因此改密成功不会把操作者从当前标签页
 * 踢出。
 */
function openChangePassword() {
  changePasswordView(ui(), {
    onSubmit: guard(async (values) => {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword })
      toast(t('auth.passwordChanged'))
    }),
  })
}

/** Label of the locale the switch would move to. 切换后将生效语言的标签。 */
function nextLocaleLabel() {
  const locales = state.locales
  if (locales.length === 0) return state.locale.toUpperCase()
  const index = locales.findIndex((locale) => locale.id === state.locale)
  const target = locales[(index + 1) % locales.length] ?? locales[0]
  return target.label?.[state.locale] ?? target.label?.en ?? target.id
}

/** Paint the authenticated screen, loading data on demand. 绘制认证后的界面，按需加载数据。 */
function render() {
  if (state.bootstrap === null) return
  const view = ROUTES[state.route]
  if (view === undefined) {
    paint(withShell(notFoundView(ui(), () => navigate('/'))))
    return
  }
  const permission = PERMISSION[view]
  if (permission !== undefined && !state.bootstrap.permissions.includes(permission)) {
    paint(withShell(forbiddenView(ui(), () => navigate('/'))))
    return
  }
  if (state.data[state.route] === undefined) {
    paint(withShell(loadingView(ui())))
    void loadRouteData(state.route, view).then(() => {
      if (state.bootstrap !== null && view === ROUTES[state.route]) render()
    })
    return
  }
  paint(withShell(contentFor(view)))
}

/** Repaint the current screen, auth or app. 重绘当前屏幕（认证屏或应用）。 */
function repaint() {
  if (state.bootstrap === null) paintAuth()
  else render()
}

/** Cycle light, dark and system. 在亮色、暗色与跟随系统之间循环。 */
function cycleTheme() {
  const index = THEME_ORDER.indexOf(state.theme)
  state.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length]
  store(THEME_KEY, state.theme)
  applyTheme()
  repaint()
}

/** Switch to the next registered locale. 切换到下一个已注册语言。 */
function toggleLocale() {
  const locales = state.locales
  if (locales.length === 0) return
  const index = locales.findIndex((locale) => locale.id === state.locale)
  state.locale = (locales[(index + 1) % locales.length] ?? locales[0]).id
  store(LOCALE_KEY, state.locale)
  repaint()
}

/** Bind routing, anchor interception and the system scheme listener. 绑定路由、链接拦截与系统配色监听。 */
function bindEvents() {
  window.addEventListener('popstate', () => {
    state.route = routePath()
    repaint()
  })
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[data-route]') : null
    if (anchor === null) return
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(anchor.dataset.route)
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme !== 'system') return
    applyTheme()
    repaint()
  })
}

/** Boot the SPA. 启动 SPA。 */
async function start() {
  document.body.append(toasts)
  if (location.pathname === BASE) history.replaceState({ path: '/' }, '', `${BASE}/`)
  state.route = routePath()
  paint(loadingView(ui()))
  await loadPacks(publicManifest)
  applyTheme()
  await enter()
}

bindEvents()
state.theme = THEME_ORDER.includes(restore(THEME_KEY)) ? restore(THEME_KEY) : 'system'
state.locale = restore(LOCALE_KEY) ?? (navigator.language?.startsWith('zh') ? 'zh' : 'en')
void start()
