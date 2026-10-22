// 构建器组合测试：真实 cordis Context 承载闭包里的宿主 ctx；工作区注册表用
// 假实现替换，直接驱动构建器产出的工具定义。
// Builder composition test: a real cordis Context carries the host ctx captured
// in the closures; the workspace registry is a fake, and the builder products
// are driven directly.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  buildWorkspaceCreateDefinition,
  buildWorkspaceRenameDefinition,
  buildWorkspaceSessionListDefinition,
} from '../src/index.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 工具定义的最小执行面（测试只走 execute；方法签名保持双变，宿主 exec 由假实现顶替）。 */
/** The minimal execution face of a tool definition (tests drive execute only; the method signature stays bivariant, a fake stands in for the host exec). */
interface RegisteredTool {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 测试只走 execute：收窄到最小执行面（唯一的断言点，宿主 exec 由假对象顶替）。 */
/** Tests drive execute only: narrow to the minimal face (the single assertion point; an empty object stands in for the host exec). */
function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
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

/** 构建全部工具定义并返回可驱动的映射。Build every tool definition and return a drivable map. */
function install() {
  const ctx = new Context()
  const registry = fakeRegistry()
  ctx.provide('workspaceRegistry', registry)
  // 会话事实数据源的最小假实现：组合测试不解析会话。
  // Minimal fakes for the session-facts data sources: the composition test
  // resolves no sessions.
  ctx.provide('sessions', { get: () => undefined })
  ctx.provide('sessionProjections', { stateOf: () => undefined })
  const definitions = new Map<string, RegisteredTool>([
    ['workspace_create', drivable(buildWorkspaceCreateDefinition(ctx, { allowCreateDirectory: false }))],
    ['workspace_rename', drivable(buildWorkspaceRenameDefinition(ctx))],
    ['workspace_session_list', drivable(buildWorkspaceSessionListDefinition(ctx, { maxListSessions: 200 }))],
  ])
  return {
    registry,
    run: async (tool: string, args: unknown): Promise<unknown> => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not built: ${tool}`)
      return await definition.execute(args, {})
    },
    built: (): string[] => [...definitions.keys()].sort(),
  }
}

describe('person-agent-tool-workspace builders（真实装配路径 / real assembly path）', () => {
  it('builds all three tools and routes calls to the registry', async () => {
    const env = install()
    expect(env.built()).toEqual(['workspace_create', 'workspace_rename', 'workspace_session_list'])
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

  it('rejects createDirectory when the deployment disables it', async () => {
    const env = install()
    await expect(env.run('workspace_create', { path: 'C:/tmp/missing', createDirectory: true }))
      .rejects.toMatchObject({ code: 'WORKSPACE_CREATE_DIRECTORY_DISABLED' })
    expect(env.registry.created).toHaveLength(0)
  })
})
