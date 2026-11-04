import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))
const core = resolve(root, '../core/src/index.ts')
const conversation = resolve(root, '../conversation/src/index.ts')
const coordination = resolve(root, '../coordination/src/index.ts')
const turn = resolve(root, '../turn/src/index.ts')

export default defineConfig({
  resolve: {
    alias: {
      '@veren/im': core,
      '@veren/im-conversation': conversation,
      '@veren/im-coordination': coordination,
      '@veren/im-turn': turn,
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
