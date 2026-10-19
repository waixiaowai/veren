import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const sourceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'src').replaceAll('\\', '/')

/**
 * Lower this plugin's TypeScript before the bundler's own transform sees it.
 *
 * The plugin marks its Remote methods with standard decorators. The bundler
 * used by this Vitest leaves undecorated-target syntax in place, so Node meets
 * a literal `@` and fails the suite with "Invalid or unexpected token". Running
 * the same `transpileModule` options the build uses keeps the spec's view of the
 * source identical to the shipped `dist/` output.
 */
const lowerDecorators = {
  name: 'startup-autostart:lower-decorators',
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
    // 这些用例在同一个进程里挂真实 Cordis 根与真实存储后端；并发跑多个文件会让
    // 共享的模块级状态互相污染，出现“单独跑才过”的用例。仓库规范明确把这种 spec
    // 视为缺陷，因此这里关掉文件级并发，而不是放宽超时。
    // These specs mount real Cordis roots and a real storage backend in one
    // process; running files in parallel lets shared module-level state
    // contaminate them, producing specs that pass only when run alone. The
    // repository treats that as a defect, so file parallelism is off here
    // instead of loosening the timeout.
    fileParallelism: false,
  },
})
