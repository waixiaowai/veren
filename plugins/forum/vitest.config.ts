/**
 * Vitest configuration for the forum host package.
 *
 * The plugin marks its Remote methods with standard decorators. The bundler
 * used by this Vitest leaves that syntax in place, so Node meets a literal `@`
 * and fails the suite; running the same `transpileModule` options the build uses
 * keeps the spec's view of the source identical to the shipped `dist/` output.
 *
 * 论坛宿主包的 Vitest 配置。
 *
 * 插件用标准装饰器标记 Remote 方法。这里的 Vitest 所用打包器不会降级该语法，Node 会直接
 * 遇到 `@` 而让套件失败；因此用与构建相同的 `transpileModule` 选项，让测试看到的源码与随包
 * 交付的 `dist/` 产物一致。
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const sourceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'src').replaceAll('\\', '/')

const lowerDecorators = {
  name: 'forum:lower-decorators',
  enforce: 'pre' as const,
  transform(code: string, id: string): { code: string; map: null } | undefined {
    const path = id.split('?')[0]?.replaceAll('\\', '/') ?? ''
    if (!path.startsWith(`${sourceRoot}/`) || !path.endsWith('.ts')) return undefined
    return {
      code: ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          isolatedModules: true,
          allowImportingTsExtensions: true,
          rewriteRelativeImportExtensions: true,
        },
        fileName: path,
      }).outputText,
      map: null,
    }
  },
}

export default defineConfig({
  plugins: [lowerDecorators],
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
