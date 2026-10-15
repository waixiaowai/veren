import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.e2e.ts'],
        retry: 2,
        testTimeout: 60_000,
    },
});
