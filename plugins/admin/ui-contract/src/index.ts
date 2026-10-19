/**
 * The browser-side UI contract of the admin platform.
 *
 * The SPA loads same-origin ESM packs declared through this vocabulary. A pack
 * is data plus one `activate(runtime)` function; the runtime owns theme, locale,
 * icon and page registries, so replacing a pack never touches a page.
 *
 * 后台平台的浏览器侧 UI 契约。SPA 通过这套词汇加载同源 ESM 包。一个包就是数据加一个
 * `activate(runtime)` 函数；运行时拥有主题、语言、图标与页面注册表，因此替换包永远
 * 不需要改动页面。
 *
 * @module @veren/admin-ui-contract
 */

/**
 * Semantic version of this UI contract. A pack declares the range it implements;
 * the UI kernel admits only packs that cover this version.
 *
 * 本 UI 契约的语义版本。包声明自己实现的范围；UI 内核只接纳覆盖该版本的包。
 */
export const UI_CONTRACT_VERSION = '1.0.0'

/** Bilingual display text carried by packs. 包携带的双语显示文本。 */
export interface LocaleText {
  /** English text. 英文文本。 */
  readonly en: string
  /** Chinese text. 中文文本。 */
  readonly zh: string
}

/** What a pack contributes. 包贡献的种类。 */
export type UiPackKind = 'shell' | 'theme' | 'locale' | 'icons' | 'page'

/** One pack as the UI manifest publishes it. 清单发布的单个包。 */
export interface UiPackManifest {
  /** Unique pack id. 唯一包 id。 */
  readonly id: string
  /** Pack version. 包版本。 */
  readonly version: string
  /** Contract range implemented. 实现的契约范围。 */
  readonly uiContract: string
  /** What the pack contributes. 包贡献的种类。 */
  readonly kind: UiPackKind
  /** Same-origin ESM entry path. 同源 ESM 入口路径。 */
  readonly entry: string
  /** Display label. 显示名。 */
  readonly label: LocaleText
  /** Optional description. 可选描述。 */
  readonly description?: LocaleText
  /** Sort order inside one kind; lower first. 同一种类内的排序，值小者在前。 */
  readonly order?: number
}

/** The manifest one audience receives. 某个受众收到的清单。 */
export interface UiManifest {
  /** Contract version enforced by the host. 宿主执行的契约版本。 */
  readonly uiContract: string
  /** Admitted packs, ordered by kind then order. 被接纳的包，按种类与顺序排列。 */
  readonly packs: readonly UiPackManifest[]
}

/** One theme contribution: CSS custom properties per scheme. 主题贡献：按配色方案组织的 CSS 自定义属性。 */
export interface ThemeContribution {
  /** Theme id. 主题 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: LocaleText
  /** Token values for the light scheme. 亮色方案的 token 值。 */
  readonly light: Readonly<Record<string, string>>
  /** Token values for the dark scheme. 暗色方案的 token 值。 */
  readonly dark: Readonly<Record<string, string>>
}

/** One locale contribution. 语言贡献。 */
export interface LocaleContribution {
  /** Locale id such as `zh` or `en`. 形如 `zh` 或 `en` 的语言 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: LocaleText
  /** Flat message dictionary. 扁平消息字典。 */
  readonly messages: Readonly<Record<string, string>>
}

/** One icon contribution. 图标贡献。 */
export interface IconContribution {
  /** Icon set id. 图标集 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: LocaleText
  /** Icon name to inline SVG markup. 图标名到内联 SVG 标记。 */
  readonly icons: Readonly<Record<string, string>>
}

/** One shell contribution. 壳贡献。 */
export interface ShellContribution {
  /** Shell id. 壳 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: LocaleText
}

/** One page contribution. 页面贡献。 */
export interface PageContribution {
  /** Page id; must be unique across packs. 页面 id；跨包唯一。 */
  readonly id: string
  /** SPA path, for example `/users`. 形如 `/users` 的 SPA 路径。 */
  readonly path: string
  /** Locale key of the page title. 页面标题的 i18n key。 */
  readonly titleKey: string
  /** Permission required to open it. 打开所需权限。 */
  readonly permission?: string
  /** Icon name. 图标名。 */
  readonly icon?: string
}

/**
 * The runtime object every pack receives from `activate`.
 *
 * Packs never touch `window`, `fetch` or storage directly: they register data
 * here, and the runtime renders it.
 *
 * 每个包在 `activate` 中收到的运行时对象。包绝不直接触碰 `window`、`fetch` 或存储：
 * 它们在此注册数据，由运行时负责渲染。
 */
export interface AdminUiRuntime {
  /** Contract version the SPA implements. SPA 实现的契约版本。 */
  readonly contract: string
  /** Register a theme. 注册主题。 */
  registerTheme(theme: ThemeContribution): void
  /** Register a locale. 注册语言。 */
  registerLocale(locale: LocaleContribution): void
  /** Register an icon set. 注册图标集。 */
  registerIcons(icons: IconContribution): void
  /** Register a shell. 注册壳。 */
  registerShell(shell: ShellContribution): void
  /** Register a page. 注册页面。 */
  registerPage(page: PageContribution): void
}
