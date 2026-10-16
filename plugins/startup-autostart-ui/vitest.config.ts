/**
 * Vitest configuration for the panel package.
 *
 * No decorator transform is needed here: this package is the browser half and
 * declares no `@Remote` methods (those live in the Host service). Component
 * specs opt into the DOM per file with a `// @vitest-environment jsdom` pragma,
 * matching the Client test convention in the checkout, so the shared
 * environment stays `node`.
 *
 * 面板包的 Vitest 配置。这里不需要装饰器转译：本包是浏览器半边，不声明任何 `@Remote`
 * 方法（那些在宿主服务里）。组件测试按检出仓库的客户端测试约定，在文件首行用
 * `// @vitest-environment jsdom` 单独切换到 DOM 环境，因此共享环境保持 `node`。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
  },
})
