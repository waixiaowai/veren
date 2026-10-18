import { clientBundle } from '../../../deepseek/deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle(import.meta.dirname, ['src/index.ts'])
