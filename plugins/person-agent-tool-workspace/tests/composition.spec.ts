// 组合测试：走真实 cordis Context——真实 inject 解析与真实 effect 逆序清理；
// 工具注册表与工作区注册表用假实现替换，直接驱动被注册的工具定义。
// Composition test: real cordis Context - real inject resolution and real
// effect reverse-order disposal; the tool registry and workspace registry are
// fakes, and the registered tool definitions are driven directly.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { resolveConfig } from './support.js'

/** 被注册工具定义的最小执行面（测试只走 execute）。 */
/** The minimal execution face of a registered tool (tests drive execute only). */
interface RegisteredTool {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 记录 registry 调用的假工作区注册表。A fake workspace registry recording calls. */
function fakeRegistry() {
  const titles = new Map<string, string>()
  return {
    titles,
    created: [] as Array<{ path: string, title?: string }>,
    async create(path: string, title?: string) {
      this.created.push({ path, title })
      const id = `ws-${path}`
      titles.set(id, title ?? 'fallback')
      return {
        id,
        path,
        title: title ?? 'fallback',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sessionIds: [],
      }
    },
    get(id: string) {
      if (!titles.has(id)) return undefined
      return {
        id,
        path: 'C:/ws',
        // title 是 getter：与宿主实体一致，改名后读回的是新值。
        // title is a getter: like the host entity, reads return the new value
        // after a rename.
        get title() {
          return titles.get(id)
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        sessionIds: [],
        // 假实体：改名只落进本地 Map，锁定工具把新标题传给了 setTitle。
        // Fake entity: rename lands in the local Map, locking that the tool
        // forwards the new title to setTitle.
        async setTitle(title: string) {
          titles.set(id, title)
        },
      }
    },
  }
}

/** 安装真实 apply 与可变假服务，返回被捕获的工具定义。 */
/** Install the real apply with mutable fakes; return the captured tool definitions. */
async function install(config: Partial<ConfigShape> = {}) {
  const ctx = new Context()
  const registry = fakeRegistry()
  const definitions = new Map<string, RegisteredTool>()
  ctx.provide('tools', {
    // 与宿主一致：register 返回精确卸载函数，供 cordis effect 逆序清理。
    // Host contract: register returns the exact disposer for cordis effect
    // reverse-order cleanup.
    register: (definition: { name: string } & RegisteredTool) => {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  })
  ctx.provide('workspaceRegistry', registry)
  // 会话事实数据源的最小假实现：组合测试不解析会话，只需 inject 可解析。
  // Minimal fakes for the session-facts data sources: the composition test
  // resolves no sessions, the injectables only need to resolve.
  ctx.provide('sessions', { get: () => undefined })
  ctx.provide('sessionProjections', { stateOf: () => undefined })
  const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig(config))
  await fiber
  return {
    registry,
    run: async (tool: string, args: unknown): Promise<unknown> => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not registered: ${tool}`)
      return await definition.execute(args, {})
    },
    registered: (): string[] => [...definitions.keys()].sort(),
    unload: async (): Promise<void> => {
      await fiber.dispose()
    },
  }
}

describe('personAgentToolWorkspace composition（真实装配路径 / real assembly path）', () => {
  it('registers both tools and routes calls to the registry', async () => {
    const env = await install()
    expect(env.registered()).toEqual(['workspace_create', 'workspace_rename', 'workspace_session_list'])
    // 真实工具体会对路径做存在性检查，所以这里用一个真实存在的临时目录。
    // The real tool body checks path existence, so a real temp directory is used.
    const dir = await mkdtemp(join(tmpdir(), 'patw-'))
    const created = await env.run('workspace_create', { path: dir, title: 'Alpha' })
    expect(created).toMatchObject({ title: 'Alpha', created: true })
    expect(env.registry.created).toEqual([{ path: dir, title: 'Alpha' }])
    const renamed = await env.run('workspace_rename', { workspaceId: `ws-${dir}`, title: '  Beta  ' })
    expect(renamed).toMatchObject({ title: 'Beta' })
    expect(env.registry.titles.get(`ws-${dir}`)).toBe('Beta')
  })

  it('omits workspace_create when allowCreate is false', async () => {
    const env = await install({ allowCreate: false })
    expect(env.registered()).toEqual(['workspace_rename', 'workspace_session_list'])
  })

  it('omits workspace_session_list when allowListSessions is false', async () => {
    const env = await install({ allowListSessions: false })
    expect(env.registered()).toEqual(['workspace_create', 'workspace_rename'])
  })

  it('rejects createDirectory when the deployment disables it', async () => {
    const env = await install({ allowCreateDirectory: false })
    await expect(env.run('workspace_create', { path: 'C:/tmp/missing', createDirectory: true }))
      .rejects.toMatchObject({ code: 'WORKSPACE_CREATE_DIRECTORY_DISABLED' })
    expect(env.registry.created).toHaveLength(0)
  })

  it('unregisters every tool on dispose (HMR safety)', async () => {
    const env = await install()
    expect(env.registered()).toHaveLength(3)
    await env.unload()
    expect(env.registered()).toHaveLength(0)
  })
})
