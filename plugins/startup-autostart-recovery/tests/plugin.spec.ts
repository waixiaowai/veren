/**
 * Composition specs: the real Cordis runtime mounts the real plugin, and only
 * the Session layer is doubled, exactly as the host plugin's specs do. The
 * state directory, the crash-log directory, and the Startup folder are all
 * temp directories passed through the plugin's own config, so the user's DSH
 * home, desktop crash logs, and real Startup folder are never touched.
 *
 * 并发安全：每个用例使用独立临时目录与独立 Cordis 根。
 * Concurrency safe: each spec uses its own temp directories and Cordis root.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Recovery from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { claimBootFlag, readLastSession, saveLastSession } from '../src/marker.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temp tree holding the state dir, a crash-log dir, and a Startup folder. */
function sandbox(): { stateDir: string; crashLogDir: string; startupFolder: string } {
  const root = mkdtempSync(join(tmpdir(), 'startup-recovery-plugin-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  const crashLogDir = join(root, 'logs')
  const startupFolder = join(root, 'startup')
  mkdirSync(crashLogDir)
  return { stateDir, crashLogDir, startupFolder }
}

/** The recorded Session-layer effects of one mounted plugin. */
interface Calls {
  readonly followup: { readonly sessionId: string; readonly text: string }[]
  flush: number
}

/** A fake Agent recording the inbox operations the plugin performs on it. */
function fakeAgent(
  sessionId: string,
  calls: Calls,
  header: { readonly origin?: 'subagent'; readonly delegationDepth?: number } = {},
) {
  return {
    session: { id: sessionId, header },
    followup: (message: { content: readonly { readonly text: string }[] }) => {
      calls.followup.push({ sessionId, text: message.content[0]?.text ?? '' })
    },
  }
}

/** Session-layer doubles: deliveries are recorded, persistence always confirms. */
function sessionLayer(calls: Calls, resumeRejects = false): { readonly agents: object; readonly sessions: object } {
  return {
    agents: {
      withoutInitiator: <T>(work: () => T): T => work(),
      get: () => undefined,
      resume: async ({ resumeSessionId }: { resumeSessionId: string }) => {
        if (resumeRejects) throw new Error(`session ${resumeSessionId} no longer exists`)
        return { agent: fakeAgent(resumeSessionId, calls) }
      },
    },
    sessions: { flush: async () => { calls.flush += 1; return true } },
  }
}

/** Wait until the mounted service's recovery drive has produced its report. */
async function settle(ctx: Context): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const report = ctx.startupRecovery.recoveryReport()
    if (!report.detail.includes('has not run yet')) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('startup-autostart-recovery: the boot drive did not finish within 10s')
}

/**
 * Publish a test double for one Host service, mirroring the host plugin's spec:
 * the double implements only the members the plugin calls.
 * @param ctx - the root context to publish on.
 * @param name - the service key being replaced.
 * @param value - the members the plugin calls.
 */
function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

/** Mount the plugin on one real Cordis root with session doubles. */
async function boot(
  dirs: ReturnType<typeof sandbox>,
  config: Partial<Config> = {},
  resumeRejects = false,
): Promise<{ ctx: Context; calls: Calls }> {
  const calls: Calls = { followup: [], flush: 0 }
  const layer = sessionLayer(calls, resumeRejects)
  const ctx = new Context()
  provideStub(ctx, 'agents', layer.agents)
  provideStub(ctx, 'sessions', layer.sessions)
  await ctx.plugin(Recovery.apply, { stateDir: dirs.stateDir, crashLogDir: dirs.crashLogDir, autostartFolder: dirs.startupFolder, ...config })
  return { ctx, calls }
}

describe('unclean-exit recovery', () => {
  it('reads a first boot as clean, claims the flag, and clears it on graceful dispose', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs)
    await settle(ctx)
    expect(ctx.startupRecovery.recoveryReport()).toMatchObject({ unclean: false, delivered: false })
    expect(claimBootFlag(dirs.stateDir, 'probe', '2026-01-01T00:00:00.000Z').unclean).toBe(true)
    await ctx.fiber.dispose()
    // Graceful dispose removed the flag, so the probe claim reads clean again.
    // 正常收尾已删除标记，探测性认领重新读到干净。
    expect(claimBootFlag(dirs.stateDir, 'probe-2', '2026-01-01T00:00:00.000Z').unclean).toBe(false)
  })

  it('delivers the honest recovery prompt to the recorded session, exactly once', async () => {
    const dirs = sandbox()
    // Simulate the previous run: it claimed a flag, saw session activity, and crashed.
    // 模拟上一次运行：认领过标记、记录过会话活动，然后崩溃。
    claimBootFlag(dirs.stateDir, 'boot-crashed', '2026-01-01T00:00:00.000Z')
    saveLastSession(dirs.stateDir, { sessionId: 'session-x', at: '2026-01-01T00:05:00.000Z' })

    const { ctx, calls } = await boot(dirs)
    await settle(ctx)
    const report = ctx.startupRecovery.recoveryReport()
    expect(report.unclean).toBe(true)
    expect(report.delivered).toBe(true)
    expect(report.lastSession?.sessionId).toBe('session-x')
    expect(calls.followup).toHaveLength(1)
    expect(calls.followup[0]?.sessionId).toBe('session-x')
    expect(calls.followup[0]?.text).toBe(
      `DSH 系统由于 原因未知（未找到崩溃日志） 退出后重启，请继续未完成的工作。`,
    )
    expect(calls.flush).toBe(1)

    await ctx.fiber.dispose()
    // The claim happened before the delivery, so a re-boot recovers nothing.
    // 认领先于投递，因此再次启动不会再恢复。
    const { ctx: again, calls: more } = await boot(dirs)
    await settle(again)
    expect(again.startupRecovery.recoveryReport()).toMatchObject({ unclean: false, delivered: false })
    expect(more.followup).toHaveLength(0)
    await again.fiber.dispose()
  })

  it('quotes a real crash log newer than the previous boot, and no older one', async () => {
    const dirs = sandbox()
    claimBootFlag(dirs.stateDir, 'boot-crashed', '2026-01-01T00:00:00.000Z')
    saveLastSession(dirs.stateDir, { sessionId: 'session-x', at: '2026-01-01T00:05:00.000Z' })
    const oldPath = join(dirs.crashLogDir, 'crash-old-web-boot.log')
    writeFileSync(oldPath, 'stale crash from last month')
    utimesSync(oldPath, new Date('2025-12-01T00:00:00Z'), new Date('2025-12-01T00:00:00Z'))
    const freshPath = join(dirs.crashLogDir, 'crash-fresh-web-boot.log')
    writeFileSync(freshPath, 'renderer process exited unexpectedly')
    utimesSync(freshPath, new Date('2026-01-01T00:04:00Z'), new Date('2026-01-01T00:04:00Z'))

    const { ctx, calls } = await boot(dirs)
    await settle(ctx)
    expect(calls.followup[0]?.text).toContain('crash-fresh-web-boot.log')
    expect(calls.followup[0]?.text).toContain('renderer process exited unexpectedly')
    await ctx.fiber.dispose()
  })

  it('skips the delivery when the recovery switch is off, but still claims the flag', async () => {
    const dirs = sandbox()
    claimBootFlag(dirs.stateDir, 'boot-crashed', '2026-01-01T00:00:00.000Z')
    saveLastSession(dirs.stateDir, { sessionId: 'session-x', at: '2026-01-01T00:05:00.000Z' })

    const { ctx, calls } = await boot(dirs, { recoveryEnabled: false })
    await settle(ctx)
    expect(ctx.startupRecovery.recoveryReport()).toMatchObject({ unclean: true, delivered: false })
    expect(calls.followup).toHaveLength(0)
    await ctx.fiber.dispose()
    // The flag was claimed even though nothing was delivered: at most once.
    // 即使没有投递，标记也已认领：至多恢复一次。
    expect(claimBootFlag(dirs.stateDir, 'probe', '2026-01-02T00:00:00.000Z').unclean).toBe(false)
  })

  it('skips a recorded session that no longer resolves, without throwing', async () => {
    const dirs = sandbox()
    claimBootFlag(dirs.stateDir, 'boot-crashed', '2026-01-01T00:00:00.000Z')
    saveLastSession(dirs.stateDir, { sessionId: 'session-gone', at: '2026-01-01T00:05:00.000Z' })

    // The resume path rejects (deleted or deprecated session): the boot must
    // stay up, deliver nothing, and keep the at-most-once claim.
    // resume 路径拒绝（会话已删或已废弃）：启动不崩、什么都不投、认领仍然生效。
    const { ctx, calls } = await boot(dirs, {}, true)
    await settle(ctx)
    expect(ctx.startupRecovery.recoveryReport()).toMatchObject({ unclean: true, delivered: false })
    expect(calls.followup).toHaveLength(0)
    await ctx.fiber.dispose()
    expect(claimBootFlag(dirs.stateDir, 'probe', '2026-01-02T00:00:00.000Z').unclean).toBe(false)
  })
})

describe('last active session recording', () => {
  it('records every session the agent/created event reports', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs)
    const payload = { agent: fakeAgent('session-live', { followup: [], flush: 0 }), source: 'startup' as const }
    // The event's payload type names the full Agent; the double only carries
    // the members the recording reads, so the emit site carries the narrowing.
    // 事件载荷类型点名完整 Agent；替身只带记录路径读的成员，收窄放在发射处。
    ctx.emit('agent/created', payload as never)
    expect(readLastSession(dirs.stateDir)?.sessionId).toBe('session-live')
    await ctx.fiber.dispose()
  })

  it('never records a subagent child, so recovery cannot target it', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs)
    const calls: Calls = { followup: [], flush: 0 }
    // A subagent child announces first (origin and delegation depth both say
    // so), a top-level session announces second: the recorder must keep the
    // second, because that is the session the user works in.
    // 子代理先上报（origin 与 delegationDepth 双重标记），顶层会话后上报：记录器
    // 必须留下后者，因为那才是用户干活的主会话。
    ctx.emit('agent/created', { agent: fakeAgent('session-child', calls, { origin: 'subagent', delegationDepth: 1 }), source: 'startup' as const } as never)
    expect(readLastSession(dirs.stateDir)?.sessionId).not.toBe('session-child')
    ctx.emit('agent/created', { agent: fakeAgent('session-top', calls), source: 'resume' as const } as never)
    ctx.emit('agent/created', { agent: fakeAgent('session-child-2', calls, { origin: 'subagent', delegationDepth: 2 }), source: 'startup' as const } as never)
    expect(readLastSession(dirs.stateDir)?.sessionId).toBe('session-top')
    await ctx.fiber.dispose()
  })

  it('still records a forked session: a fork is a top-level user session', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs)
    const calls: Calls = { followup: [], flush: 0 }
    // parentSession marks fork lineage, not delegation; the fork the user
    // drives is exactly where a recovery prompt belongs.
    // parentSession 标记 fork 血缘，不是委派；用户驱动的 fork 正是恢复提示该去的地方。
    const forked = {
      session: { id: 'session-fork', header: { parentSession: 'session-parent' } },
      followup: (message: { content: readonly { readonly text: string }[] }) => {
        calls.followup.push({ sessionId: 'session-fork', text: message.content[0]?.text ?? '' })
      },
    }
    ctx.emit('agent/created', { agent: forked, source: 'resume' as const } as never)
    expect(readLastSession(dirs.stateDir)?.sessionId).toBe('session-fork')
    await ctx.fiber.dispose()
  })
})

describe('logon autostart through the service', () => {
  it('starts off, enables into the configured folder, and undoes in one call', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs, { autostartCommand: '"C:\\apps\\DeepSeek Harness.exe"' })
    expect(ctx.startupRecovery.autostart()).toMatchObject({ enabled: false })
    ctx.startupRecovery.enableAutostart()
    expect(ctx.startupRecovery.autostart().enabled).toBe(true)
    expect(ctx.startupRecovery.disableAutostart().enabled).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud when enabling without a configured command', async () => {
    const dirs = sandbox()
    const { ctx } = await boot(dirs)
    expect(() => ctx.startupRecovery.enableAutostart()).toThrow(/autostartCommand/)
    await ctx.fiber.dispose()
  })
})
