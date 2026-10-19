/**
 * The browser-side UI runtime the SPA hands to every pack.
 *
 * A pack is data plus one `activate(runtime)` function; the runtime owns the
 * registries so a page never imports a pack and a pack never imports a page.
 * Loading is isolated per pack: a pack that throws, misses `activate` or fails
 * to fetch is reported on the console and skipped, because one broken pack must
 * never blank the admin.
 *
 * SPA 交给每个 UI 包的浏览器侧运行时。包就是数据加一个 `activate(runtime)` 函数；运行时
 * 拥有注册表，因此页面从不导入包，包也从不导入页面。加载按包隔离：抛错、缺少 `activate`
 * 或取不到的包会在控制台报告并被跳过，因为一个坏包绝不能让后台白屏。
 *
 * @module @veren/admin-web/client/runtime.js
 */

/** Contract version this SPA implements. 本 SPA 实现的契约版本。 */
export const UI_CONTRACT = '1.0.0'

/**
 * Validate one contribution and store it by id.
 *
 * A contribution without a string id is ignored rather than throwing: a pack
 * that ships a typo should lose one entry, not the whole screen.
 *
 * 校验单个贡献并按 id 存储。缺少字符串 id 的贡献会被忽略而不是抛错：写错一个字段的包应该
 * 只丢一个条目，而不是整屏。
 *
 * @param map - the registry 注册表
 * @param kind - contribution kind 贡献种类
 * @param value - untrusted contribution 不可信贡献
 * @param warn - warning sink 告警出口
 */
function register(map, kind, value, warn) {
  if (value === null || typeof value !== 'object' || typeof value.id !== 'string' || value.id === '') {
    warn(`[admin] ignored a malformed ${kind} contribution (missing id).`)
    return
  }
  map.set(value.id, value)
}

/**
 * Create one runtime instance.
 *
 * @param options - warning sink override 告警出口覆盖
 * @returns the runtime object consumed by packs 包消费的运行时对象
 */
export function createRuntime(options = {}) {
  const warn = typeof options.warn === 'function' ? options.warn : (message, error) => {
    if (error === undefined) console.warn(message)
    else console.warn(message, error)
  }
  const registries = { theme: new Map(), locale: new Map(), icons: new Map(), shell: new Map(), page: new Map() }
  const loaded = new Set()
  const failures = []

  const runtime = {
    contract: UI_CONTRACT,
    registerTheme: (value) => register(registries.theme, 'theme', value, warn),
    registerLocale: (value) => register(registries.locale, 'locale', value, warn),
    registerIcons: (value) => register(registries.icons, 'icons', value, warn),
    registerShell: (value) => register(registries.shell, 'shell', value, warn),
    registerPage: (value) => register(registries.page, 'page', value, warn),
    listThemes: () => [...registries.theme.values()],
    listLocales: () => [...registries.locale.values()],
    listIconSets: () => [...registries.icons.values()],
    listShells: () => [...registries.shell.values()],
    listPages: () => [...registries.page.values()],
    failures,
    loadPacks,
  }

  /**
   * Load one pack module and call its `activate`.
   *
   * @param pack - manifest entry 清单条目
   * @returns true when the pack activated 激活成功时为 true
   */
  async function activatePack(pack) {
    if (pack === null || typeof pack !== 'object' || typeof pack.entry !== 'string') {
      warn(`[admin] skipped a UI pack without an entry path: ${String(pack?.id)}`)
      failures.push({ pack: String(pack?.id), error: new Error('missing entry') })
      return false
    }
    if (loaded.has(pack.id)) return true
    if (!pack.entry.startsWith('/')) {
      warn(`[admin] skipped UI pack '${pack.id}': entry '${pack.entry}' is not a same-origin absolute path.`)
      failures.push({ pack: pack.id, error: new Error('relative entry') })
      return false
    }
    try {
      // 同源绝对路径的静态 ESM 导入；浏览器按 URL 缓存模块。
      // Static ESM import from a same-origin absolute path; the browser caches by URL.
      const module = await import(pack.entry)
      if (typeof module.activate !== 'function') {
        throw new TypeError(`pack '${pack.id}' has no activate(runtime) export`)
      }
      await module.activate(runtime)
      loaded.add(pack.id)
      return true
    } catch (error) {
      failures.push({ pack: pack.id, error })
      warn(`[admin] UI pack '${pack.id}' failed to activate; continuing without it.`, error)
      return false
    }
  }

  /**
   * Load every pack of one manifest, isolating failures per pack.
   *
   * @param packs - manifest pack list 清单中的包列表
   * @returns the failures seen so far 目前见到的失败
   */
  async function loadPacks(packs) {
    for (const pack of Array.isArray(packs) ? packs : []) await activatePack(pack)
    return failures.slice()
  }

  return runtime
}
