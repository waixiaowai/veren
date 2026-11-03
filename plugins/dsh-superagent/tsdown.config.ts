import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
// `?raw` imports a file as its text, as Vite and vitest do; tsdown refuses `.css` ids without @tsdown/css, so this loads them.
const raw = { name: 'raw',
  resolveId: (source: string, importer?: string) => source.endsWith('?raw') && importer ? resolve(dirname(importer), source) : undefined,
  load: (id: string) => id.endsWith('?raw') ? { code: `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' as const }
    : undefined }
// React comes from the host's module loader; `deps.neverBundle` does not bind on the browser/cjs config, so externalize it at the resolver.
/* React 由宿主模块加载器提供；deps.neverBundle 在 browser/cjs 配置上不生效，改在解析层强制外置。 */
const externalReact = { name: 'externalize-react',
  resolveId: (source: string) => /^react(-dom)?(\/|$)/.test(source) ? { id: source, external: true as const } : undefined }
export default defineConfig([
  { entry: { index: 'src/index.ts', 'github-watch': 'src/sources/github.ts', 'gitea-watch': 'src/sources/gitea.ts', 'feishu-watch': 'src/sources/feishu.ts', 'taskhub-watch': 'src/sources/taskhub.ts' }, outDir: 'lib', format: 'esm', fixedExtension: false, platform: 'node', target: 'es2024', dts: true, clean: true, deps: { neverBundle: [/^@deepseek-ai\//, 'zod', 'proper-lockfile', 'ws'] } },
  { entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false, plugins: [raw, externalReact],
    outputOptions: { entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({ id: "dsh-superagent", factory: (require) => {', footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' } },
])
