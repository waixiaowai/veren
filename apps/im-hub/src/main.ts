/**
 * im-hub entry point: `authorize` mints the single iLink session once, `serve`
 * holds it and serves the device API. Both commands share the data directory;
 * the device token is the only mandatory environment value.
 *
 * im-hub 入口：`authorize` 一次性铸出唯一 iLink 会话，`serve` 持有它并服务设备 API。
 * 两条命令共享数据目录；设备令牌是唯一必填的环境值。
 *
 * @module im-hub/main
 */

import { mkdirSync } from 'node:fs'
import { authorize, startPolling } from './session.ts'
import { configFromEnv, dataFile } from './config.ts'
import { readContexts, writeContexts } from './store.ts'
import { HubRouter } from './route.ts'
import { startServer } from './server.ts'

const command = process.argv[2] ?? 'serve'
const config = configFromEnv()
mkdirSync(config.dataDir, { recursive: true })

if (command === 'authorize') {
  await authorize(config)
  process.exit(0)
}

if (command === 'serve') {
  // 重启后回复依然要带 context_token（否则 iLink 以 -2 拒绝）：令牌映射持久化。
  // Replies after a restart still need the context_token (iLink refuses with
  // -2 otherwise): the token map is persisted.
  const contextFile = dataFile(config, 'hub-contexts.json')
  const contexts = readContexts(contextFile)
  const router = new HubRouter(config)
  startPolling(config, routed => {
    if (routed.contextToken !== undefined) {
      contexts.set(routed.conversationId, routed.contextToken)
      writeContexts(contextFile, contexts)
    }
    const row = router.deliver(routed)
    console.log(`[im-hub] routed ${row.id} → ${config.defaultDevice} seq=${row.seq}`)
  })
  startServer(config, router, contexts)
  console.log(`[im-hub] serving; data dir: ${config.dataDir}`)
} else {
  console.error('usage: main.ts [authorize|serve]')
  process.exit(1)
}
