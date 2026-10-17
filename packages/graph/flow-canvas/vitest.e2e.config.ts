import { defineConfig } from 'vitest/config';

// 本包没有独立的真实 API 套件：真实 YAML + 引擎组合由 tests/demo.spec.ts
// 在内存里覆盖。passWithNoTests 让空 e2e 配置明确地空套件通过。
// This package has no standalone real-API suite: the real YAML + engine
// composition is covered in memory by tests/demo.spec.ts. passWithNoTests
// makes the empty e2e config an explicit empty-suite pass.
export default defineConfig({
    test: {
        include: ['tests/**/*.e2e.ts'],
        retry: 2,
        testTimeout: 60_000,
        passWithNoTests: true,
    },
});
