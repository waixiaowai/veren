import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// *.spec.ts 单元测试 / unit tests only
// TSX 使用 @veren/prompt-core 的 JSX runtime：显式 esbuild 声明 + react 兼容别名双保险
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@veren/prompt-core',
  },
  resolve: {
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: '@veren/prompt-core/jsx-dev-runtime' },
      { find: /^react\/jsx-runtime$/, replacement: '@veren/prompt-core/jsx-runtime' },
      // 工作区兄弟包交付的 `dist/` 会落后于源码；测试运行与检查器钉到同一份源码（见 tsconfig paths）。
      // The workspace siblings' shipped `dist/` can lag their sources; the test
      // run reads the same sources the checker pins to (see tsconfig paths).
      { find: /^@veren\/prompt-page$/, replacement: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../packages/prompt-page/src/index.ts').replaceAll('\\', '/') },
      { find: /^@veren\/task-center$/, replacement: resolve(fileURLToPath(new URL('.', import.meta.url)), '../task-center/src/index.ts').replaceAll('\\', '/') },
      { find: /^@veren\/page-registry$/, replacement: resolve(fileURLToPath(new URL('.', import.meta.url)), '../page-registry/src/index.ts').replaceAll('\\', '/') },
      { find: /^@veren\/app-registry$/, replacement: resolve(fileURLToPath(new URL('.', import.meta.url)), '../app-registry/src/index.ts').replaceAll('\\', '/') },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
