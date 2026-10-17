import { defineConfig } from 'vitest/config';

// 本包是纯内存内核，没有真实外部 API 的 e2e；配置保留给未来的真实组合，
// 当前用 passWithNoTests 让"按现有配置执行"得到明确的空套件通过而不是 exit 1。
// This package is an in-memory kernel with no real external-API e2e; the config
// stays for future real compositions, and passWithNoTests makes running the
// existing config a clear empty-suite pass instead of exit 1.
export default defineConfig({
    test: {
        include: ['tests/**/*.e2e.ts'],
        retry: 2,
        testTimeout: 60_000,
        passWithNoTests: true,
    },
});
