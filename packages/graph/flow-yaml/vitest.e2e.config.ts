import { defineConfig } from 'vitest/config';

// flow-yaml 的加载路径由 node-tool 的真实流程 e2e 覆盖；本包没有独立的
// 真实 API 套件，passWithNoTests 让现有配置明确地空套件通过。
// flow-yaml's loading path is covered by node-tool's real-flow e2e; this
// package has no standalone real-API suite, so passWithNoTests makes the
// existing config an explicit empty-suite pass.
export default defineConfig({
    test: {
        include: ['tests/**/*.e2e.ts'],
        retry: 2,
        testTimeout: 60_000,
        passWithNoTests: true,
    },
});
