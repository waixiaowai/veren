/**
 * Browser half of the default icon pack.
 *
 * Every icon is a 24×24 inline `<svg>` using `stroke="currentColor"` and
 * `fill="none"`, so it inherits text colour and adapts to both schemes without
 * a second copy. The SPA writes these strings with `innerHTML` because they are
 * trusted constants from this pack, never data from an API.
 *
 * 默认图标包的浏览器半边。每个图标都是 24×24 内联 `<svg>`，使用 `stroke="currentColor"`
 * 与 `fill="none"`，因此继承文字颜色、无需第二份即可适配亮暗两套方案。SPA 用 `innerHTML`
 * 写入这些字符串，因为它们是本包的可信常量，绝非来自 API 的数据。
 *
 * @module @veren/admin-icons-default/client.js
 */

/**
 * Wrap one path body into a complete 24×24 stroke icon.
 * 把一段路径主体包装成完整的 24×24 描边图标。
 *
 * @param body - inner SVG markup 内部 SVG 标记
 * @returns the svg markup svg 标记
 */
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

/** Icon name to markup. 图标名到标记。 */
const icons = {
  // Navigation 导航
  dashboard: svg(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ),
  users: svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  shield: svg('<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>'),
  audit: svg(
    '<path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/><path d="M9.5 16h3"/>',
  ),
  capabilities: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
  logout: svg('<path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="m10 16-4-4 4-4"/><path d="M6 12h10"/>'),

  // Theme, locale and chrome 主题、语言与外壳
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  ),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),

  // Actions 操作
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg(
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  ),
  edit: svg('<path d="M12 20h9"/><path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L7 19.2l-4 1 1-4z"/>'),
  check: svg('<path d="m5 13 4 4 10-10"/>'),
}

/**
 * Register the icon set with the SPA runtime.
 *
 * @param runtime - the admin UI runtime 后台 UI 运行时
 */
export function activate(runtime) {
  runtime.registerIcons({ id: 'default', label: { en: 'Default icons', zh: '默认图标' }, icons })
}
