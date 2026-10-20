/**
 * 字节稳定的消息渲染 / byte-stable message rendering
 * 模板信封固定，仅数据字面量变；canonical 键序来自 @veren/prompt-core。
 */
import { canonicalJson } from '@veren/prompt-core'
import type { Sync } from './types.ts'

/** 渲染同步消息 / render one sync message */
export function renderSync(sync: Sync): string {
  if (sync.kind === 'patch') {
    return `PATCH v${sync.fromVersion}->v${sync.toVersion} {"ops":[${sync.ops.map(canonicalJson).join(',')}]}`
  }
  return `SNAPSHOT v${sync.version} {"nodes":[${sync.nodes.map(canonicalJson).join(',')}]}`
}
