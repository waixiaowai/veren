/**
 * Vitest configuration for the notebook Host package.
 *
 * Remote methods carry standard decorators, which this bundler leaves in place;
 * running the same `transpileModule` options as the build keeps the spec's view
 * of the source identical to the shipped `dist/` output.
 *
 * 记事本宿主包的 Vitest 配置。远端方法带标准装饰器，此处的打包器会原样保留；使用与构建相同的
 * `transpileModule` 选项，让测试看到的源码与随包交付的 `dist/` 产物一致。
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const sourceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'src').replaceAll('\\', '/')

const lowerDecorators = {
  name: 'notebook:lower-decorators',
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
