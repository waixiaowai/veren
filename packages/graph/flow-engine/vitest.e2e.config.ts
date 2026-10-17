import { defineConfig } from 'vitest/config';

// flow-engine 的 e2e 由组合方（node-tool / flow-storage）在真实运行时里覆盖；
// 本包没有独立的真实 API 套件，passWithNoTests 让现有配置明确地空套件通过。
// flow-engine's e2e is covered by composition packages (node-tool / flow-storage)
// against a real runtime; this package has no standalone real-API suite, so
// passWithNoTests makes the existing config an explicit empty-suite pass.
export default defineConfig({
    test: {
        include: ['tests/**/*.e2e.ts'],
        retry: 2,
        testTimeout: 60_000,
        passWithNoTests: true,
    },
});
