/**
 * Startup autostart: run every enabled startup item each time DeepSeek Harness
 * finishes starting.
 *
 * Nothing debounces a start. A restart interrupts the sessions the items drive,
 * so a suppressed run is work the user never gets back; the only gate is an
 * item's own `enabled` flag.
 *
 * The trigger accepts two independent paths, because the launcher's successful
 * start signal is optional and one-shot:
 *
 * 1. `ctx.get('appReady').onReady(...)` when the launcher provides it — the
 *    signal commits after the whole plugin tree mounted and the surface is
 *    serving. A late subscription (an HMR reload) fires immediately, so editing
 *    this plugin never loses the trigger.
 * 2. Plugin activation completion, used when no launcher signal exists at all.
 *
 * Both paths funnel into one latched drive per activated service, and every
 * delivery runs inside `ctx.agents.withoutInitiator`. Those two facts are the
 * entire guard against a double dispatch: the latch makes one trigger per
 * activated service, and the initiator-free scope is what keeps a session this
 * plugin wakes from re-entering the trigger. A reload is a new activated
 * service, so it drives again by design.
 *
 * This entry only assembles and re-exports: the service lives in `service.ts`,
 * the storage contract in `storage.ts`, the delivery engine in `runtime.ts`,
 * and the vocabulary behind the `domain.ts` facade.
 *
 * 启动自启动：每次 DeepSeek Harness 启动完成后执行每一条 enabled 的启动项。
 *
 * 没有防抖。重启会打断启动项正在驱动的会话，被压掉的一次执行就是用户永远拿不回来
 * 的那一次；唯一的门槛是启动项自己的 `enabled`。
 *
 * 本入口只做组装与再导出：服务在 `service.ts`，存储契约在 `storage.ts`，投递引擎在
 * `runtime.ts`，词汇表藏在 `domain.ts` 门面之后。
 * @module @veren/startup-autostart
 */

import { StartupAutostartService } from './service.ts'

export type * from './domain.ts'
export { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, STARTUP_ACTIONS, StartupInputError } from './domain.ts'
export { STARTUP_DOMAIN_NAME, STARTUP_TABLE_NAME, startupDomain, startupItemSchema } from './storage.ts'
export { StartupAutostartService } from './service.ts'
export type { StartupDriveReport } from './runtime.ts'

export default StartupAutostartService
