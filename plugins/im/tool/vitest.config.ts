import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const core = resolve(fileURLToPath(new URL('.', import.meta.url)), '../core/index.ts')

export default defineConfig({
  resolve: {
    alias: { '@veren/im': core },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
