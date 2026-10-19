/**
 * cms-bridge 客户端构建配置 —— 照官方 packages/client/tsdown.client.ts 的
 * clientConfig 预设精简而来:tsdown(cjs)+ 平台基线 external + lightningcss
 * CSS Module(哈希类名 + 挂 data-plugin-css 标签注入),产物为
 * window.__ModuleLoader__.load 闭包工厂契约的单文件 lib/client.js。
 *
 * The cms-bridge client build config — trimmed from the official
 * packages/client/tsdown.client.ts clientConfig preset: tsdown (cjs) + the
 * platform baseline externals + lightningcss CSS Modules (hashed class names
 * injected under a data-plugin-css tag), emitting the single-file
 * lib/client.js in the window.__ModuleLoader__.load closure-factory contract.
 */
import { transform } from 'lightningcss';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { UserConfig } from 'tsdown';
// 外壳冻结模块表只有一份事实源 / the shell's frozen module table has one source of truth.
import { PLATFORM_MODULES } from '@veren/platform-modules';

const PKG = '@veren/cms-bridge';

const CSS_VIRTUAL_PREFIX = '\0cms-css:';
const CSS_VIRTUAL_SUFFIX = '.mjs';

/** CSS Module → 「注入带标签 style + 导出类名映射」模块 / CSS Module → style-tag injection + class-map export */
const cssModulesInline = {
  name: 'cms-css-modules-inline',
  resolveId(source: string, importer: string | undefined): string | null {
    if (!source.endsWith('.module.css') || importer === undefined) return null;
    return CSS_VIRTUAL_PREFIX + resolve(dirname(importer), source) + CSS_VIRTUAL_SUFFIX;
  },
  async load(virtualId: string): Promise<{ code: string } | null> {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null;
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
    const source = await readFile(fileId);
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    });
    const classMap: Record<string, string> = {};
    for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      classMap[local] = exp.name;
    }
    const injection = [
      `const css = ${JSON.stringify(code.toString())};`,
      `const tagId = ${JSON.stringify(`${PKG}/${fileId.split(/[\\/]/).pop()}`)};`,
      `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
      `  const tag = document.createElement('style');`,
      `  tag.dataset.plugin = ${JSON.stringify(PKG)};`,
      `  tag.dataset.pluginCss = tagId;`,
      `  tag.textContent = css;`,
      `  document.head.appendChild(tag);`,
      `}`,
      `export default ${JSON.stringify(classMap)};`,
    ].join('\n');
    return { code: injection };
  },
};

export default {
  name: `${PKG}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  deps: {
    // 基座模块走模块表(external),其余全部内联 / baseline rows stay external, everything else inlines
    neverBundle: (specifier: string): boolean => (PLATFORM_MODULES as readonly string[]).includes(specifier),
    alwaysBundle: (specifier: string): boolean => !(PLATFORM_MODULES as readonly string[]).includes(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesInline],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
};
