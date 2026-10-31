/**
 * The framework-absent half of the G2 package split: the forum host service
 * activates with no app framework on the context, raises no inject/wait
 * warning, and registers no model-facing tool of its own — headless
 * deployments keep the durable service and nothing else.
 *
 * G2 拆包的「框架缺席」半边：论坛宿主服务在上下文上没有应用框架时照常激活、
 * 不产生任何注入等待告警、也不注册任何模型侧工具——headless 部署保留持久化
 * 服务，仅此而已。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { disposeTrackedRoots, mount, seedBoard } from './helpers/tools-mount.ts'
import type { Mounted } from './helpers/tools-mount.ts'

afterEach(disposeTrackedRoots)

/** One mount plus every logger line it emitted while settling. 一次挂载及其稳定期间产生的全部日志行。 */
interface LoggedMount {
  mounted: Mounted
  lines: string[]
}

/**
 * Capture every logger line emitted while one mount settles, so the specs
 * can prove the activation raised no inject/wait warning at all.
 * 捕获一次挂载稳定期间产生的每一条日志，用例据此证明激活过程没有产生任何注入等待告警。
 */
async function mountWatchingLogs(options?: Parameters<typeof mount>[0]): Promise<LoggedMount> {
  const lines: string[] = []
  const warn = console.warn
  const error = console.error
  console.warn = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
  console.error = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
  try {
    const mounted = await mount(options)
    return { mounted, lines }
  } finally {
    console.warn = warn
    console.error = error
  }
}

describe('framework-absent deployment (G2 package split) / 框架缺席的部署（G2 拆包）', () => {
  it('activates the host with no app framework present and no inject warning', async () => {
    const { mounted, lines } = await mountWatchingLogs()
    const { ctx, fiber } = mounted

    // The framework really is absent: no `apps` service exists on this context.
    // 框架确实缺席：此上下文上不存在 `apps` 服务。
    expect(ctx.get('apps')).toBeUndefined()
    // The host activated anyway: the service face answers and [Service.init] ran.
    // 宿主照样激活：服务面可用，[Service.init] 已执行。
    expect(ctx.forum).toBeDefined()

    await fiber.dispose()
    expect(lines).toHaveLength(0)
  })

  it('registers no model-facing tool of its own', async () => {
    const { mounted } = await mountWatchingLogs({ preset: 'ptc' })
    const { ctx, fiber, registered, cwd } = mounted

    // Headless deployments keep the durable service — boards, posts, the
    // Remote namespace, the notices — but no agent sees a forum tool until the
    // application layer mounts one into a page session.
    // headless 部署保留持久化服务——板块、主题、远端命名空间与通知——但在应用层把工具
    // 挂进页面会话之前，没有任何 agent 能看到论坛工具。
    const boardId = await seedBoard(ctx, cwd)
    const catalog = await ctx.forum.catalog({ boardId })
    expect(catalog.boards.map((board) => board.id)).toEqual([boardId])
    expect(registered.size).toBe(0)

    await fiber.dispose()
    expect(registered.size).toBe(0)
  })
})
