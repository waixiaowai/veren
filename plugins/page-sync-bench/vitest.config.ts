import { defineConfig } from 'vitest/config'

// *.spec.ts 单元测试（无网络） / unit tests only, no network
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
