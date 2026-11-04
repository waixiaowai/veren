import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const core = resolve(fileURLToPath(new URL('.', import.meta.url)), '../core/src/index.ts')
const conversation = resolve(fileURLToPath(new URL('.', import.meta.url)), '../conversation/src/index.ts')
const coordination = resolve(fileURLToPath(new URL('.', import.meta.url)), '../coordination/src/index.ts')

export default defineConfig({
  resolve: {
    alias: {
      '@veren/im': core,
      '@veren/im-conversation': conversation,
      '@veren/im-coordination': coordination,
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
