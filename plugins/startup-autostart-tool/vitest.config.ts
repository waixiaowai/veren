import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const hostEntry = resolve(packageRoot, '../startup-autostart/src/index.ts')
const sourceRoots = [resolve(packageRoot, 'src'), resolve(packageRoot, '../startup-autostart/src')]
  .map(path => path.replaceAll('\\', '/'))

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
    if (!sourceRoots.some(root => path.startsWith(`${root}/`)) || !path.endsWith('.ts')) return undefined
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
  resolve: { alias: { '@veren/startup-autostart': hostEntry } },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
