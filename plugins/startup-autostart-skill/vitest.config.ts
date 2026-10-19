import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))

// 测试只借用宿主导出的长度常量，因此指向纯 domain 源码而不是插件入口：
// 后者带 Remote 装饰器与 Typert 依赖，会让规格测试拖进整套宿主运行时。
// The spec borrows only the Host's length constants, so it points at the pure
// domain source instead of the plugin entry: the entry carries Remote
// decorators and Typert dependencies that would drag the whole Host runtime
// into a registry test.
const hostDomain = resolve(packageRoot, '../startup-autostart/src/domain.ts')

export default defineConfig({
  resolve: { alias: { '@veren/startup-autostart': hostDomain } },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
