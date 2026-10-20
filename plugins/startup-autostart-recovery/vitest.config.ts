import { defineConfig } from 'vitest/config'

// Recovery specs mount a real Cordis root with session-layer doubles, like the
// host plugin's specs do; no bundler transform is needed because this plugin
// uses no decorators.
// 恢复用例与宿主插件一样在真实 Cordis 根上挂载会话层替身；本插件不用装饰器，
// 因此无需打包转换。
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // 文件级并发关闭：与宿主插件同一理由——同进程真实根避免模块级状态互相污染。
    // File parallelism off, for the same reason as the host plugin: real roots
    // in one process must not contaminate each other's module-level state.
    fileParallelism: false,
  },
})
