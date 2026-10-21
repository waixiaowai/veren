/**
 * Vitest configuration for the forum application layer.
 *
 * TSX pages use the prompt-core JSX runtime. The host package `@veren/forum`
 * is aliased to its TypeScript sources (its shipped `dist/` carries no
 * declarations), and because its Remote methods use standard decorators that
 * the bundler leaves in place, the same `transpileModule` options the host's
 * own build uses lower them here too.
 *
 * 论坛应用层的 Vitest 配置。
 *
 * TSX 页面使用 prompt-core 的 JSX 运行时。宿主包 `@veren/forum` 被别名到它的
 * TypeScript 源码（其交付的 `dist/` 不带声明）；宿主的 Remote 方法使用标准装饰器、
 * 打包器会原样保留，因此这里也用宿主构建相同的 `transpileModule` 选项做降级。
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

// This package's own sources, plus the aliased host sources both get lowered.
// 本包自身源码与被别名的宿主源码都做同样的降级。
const sourceRoots = [
  resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../forum/src'),
].map(root => root.replaceAll('\\', '/'))

const lowerDecorators = {
  name: 'forum-app:lower-decorators',
  enforce: 'pre' as const,
  transform(code: string, id: string): { code: string; map: null } | undefined {
    const path = id.split('?')[0]?.replaceAll('\\', '/') ?? ''
    if (!sourceRoots.some(root => path.startsWith(`${root}/`))
      || (!path.endsWith('.ts') && !path.endsWith('.tsx'))
    ) return undefined
    return {
      code: ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          isolatedModules: true,
          allowImportingTsExtensions: true,
          rewriteRelativeImportExtensions: true,
          // Page sources are TSX with the prompt-core JSX runtime.
          // 页面源码是带 prompt-core JSX 运行时的 TSX。
          jsx: ts.JsxEmit.ReactJSX,
          jsxImportSource: '@veren/prompt-core',
        },
        fileName: path,
      }).outputText,
      map: null,
    }
  },
}

export default defineConfig({
  plugins: [lowerDecorators],
  resolve: {
    alias: [
      // Type-check and test run read the very same host sources.
      // 类型检查与测试运行读的是同一份宿主源码。
      { find: /^@veren\/forum$/, replacement: resolve(fileURLToPath(new URL('.', import.meta.url)), '../forum/src/index.ts').replaceAll('\\', '/') },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
