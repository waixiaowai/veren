/**
 * 外壳冻结模块表 —— 浏览器插件构建时唯一的事实源。
 *
 * 每个 UI 插件的 `lib/client.js` 都把这张表里的模块声明为 external，由 Web 外壳
 * 通过 `window.__ModuleLoader__` 注入同一份实例（React、cordis、slots…）。表在
 * 插件里手抄一份就等于把外壳的契约复制了 N 份，外壳增删基座模块时不会有任何
 * 门禁报错，只会白屏或 `require is not a function`。因此这里只保留一份。
 *
 * 与官方 `packages/client/web/src/platform.ts` 的冻结表同源；改动它等于改动外壳
 * 契约，必须同时升级所有 UI 插件的 `engines.dsh` 区间。
 *
 * The shell's frozen module table — the single source of truth for every
 * browser-plugin build.
 *
 * Each UI plugin's `lib/client.js` marks these modules external, and the Web
 * shell injects one shared instance of each (React, cordis, slots, …) through
 * `window.__ModuleLoader__`. Copying the table into every plugin duplicates the
 * shell contract N times: adding or removing a baseline module then fails with
 * a blank page or `require is not a function` instead of a checkable error.
 * Keep exactly one copy here.
 *
 * It mirrors the frozen table in the official
 * `packages/client/web/src/platform.ts`; changing it changes the shell
 * contract and must move every UI plugin's `engines.dsh` range in the same
 * change.
 *
 * @module @veren/shared/platform-modules
 */

/** 外壳共享进冻结模块表的模块名 / module specifiers the shell shares into its frozen table. */
export const PLATFORM_MODULES = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])
