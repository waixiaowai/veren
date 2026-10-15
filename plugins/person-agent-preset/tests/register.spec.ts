// 单测：预设定义合法、注册与逆序清理语义。
// Unit tests: definition validity, registration and reverse-order disposal.
import { describe, expect, it, vi } from 'vitest'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import { buildPersonAgentPreset } from '../src/definition.ts'
import { apply, Config } from '../src/index.ts'

const OPTIONS = {
  presetId: 'person-agent',
  order: 5,
  withWeb: true,
  withWorkspaceTools: true,
  withSessionTools: true,
}

describe('buildPersonAgentPreset', () => {
  it('produces an entry list the registry validator accepts', () => {
    const definition = buildPersonAgentPreset(OPTIONS)
    expect(entryListProblem(definition.plugins)).toBeUndefined()
  })

  it('keeps a human-facing persona and the present tool', () => {
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    const present = definition.plugins.find((row) => row.id === 'present')
    expect(persona).toBeDefined()
    expect(String((persona?.config as { prefix?: string })?.prefix)).toContain('plain')
    expect(present).toBeDefined()
  })

  it('bakes no roster into the persona suffix (lists move to the dynamic section)', () => {
    // 注册时烘焙名单会过期；suffix 只保留静态模板，名单交给 dynamic-context。
    // Baking lists at register time goes stale; the suffix stays a static template.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    expect(String((persona?.config as { suffix?: string })?.suffix)).not.toContain('Agent Preset List')
  })

  it('references the dynamic-context row by its package name', () => {
    // 行名 = package.json 的 name：包从私有仓库（npm.veren.top）或工作区链接
    // 解析，禁止 file URL/相对路径凑合。
    // Row name = the package.json name: resolved from the private registry
    // (npm.veren.top) or the workspace link - no file URL / relative hacks.
    const definition = buildPersonAgentPreset(OPTIONS)
    const section = definition.plugins.find((row) => row.id === 'dynamic-context')
    expect(section).toBeDefined()
    expect(String(section?.name)).toBe('@veren/person-agent-dynamic-context')
  })

  it('omits the web tool when withWeb is false', () => {
    const definition = buildPersonAgentPreset({ ...OPTIONS, withWeb: false })
    expect(definition.plugins.some((row) => row.id === 'tool-web')).toBe(false)
  })

  it('composes the workspace and session maintenance tool rows by package name', () => {
    // 自助维护工具按包名组合：行名 = package.json 的 name，由加载器解析。
    // Self-service maintenance tools compose by package name: row name = the
    // package.json name, resolved by the loader.
    const definition = buildPersonAgentPreset(OPTIONS)
    const workspace = definition.plugins.find((row) => row.id === 'tool-workspace')
    const session = definition.plugins.find((row) => row.id === 'tool-session')
    expect(String(workspace?.name)).toBe('@veren/person-agent-tool-workspace')
    expect(String(session?.name)).toBe('@veren/person-agent-tool-session')
    // 部署默认收紧：工具不允许擅自递归建目录。
    // Tight deployment default: the tool may not create directories on its own.
    expect(workspace?.config).toMatchObject({ allowCreate: true, allowCreateDirectory: false })
    expect(session?.config).toMatchObject({ allowCreate: true, allowFork: true, allowArchive: true, allowPin: true })
  })

  it('omits the maintenance tool rows when their toggles are false', () => {
    const definition = buildPersonAgentPreset({ ...OPTIONS, withWorkspaceTools: false, withSessionTools: false })
    expect(definition.plugins.some((row) => row.id === 'tool-workspace')).toBe(false)
    expect(definition.plugins.some((row) => row.id === 'tool-session')).toBe(false)
  })
})

describe('apply', () => {
  it('registers through agentPresets and disposes in reverse order', async () => {
    // 最小假 Context：只实现本插件用到的 effect 与 agentPresets 面。
    // Minimal fake Context: only the effect and agentPresets faces used here.
    const unregister = vi.fn(async () => {})
    const register = vi.fn(async () => unregister)
    const disposers: Array<() => unknown> = []
    const ctx = {
      agentPresets: { register },
      // 模拟 cordis 语义：execute 返回卸载函数，框架在卸载时调用它。
      // Mirror cordis semantics: the body returns the disposer the framework calls.
      effect: (execute: () => unknown, _label?: string) => {
        const disposer = execute() as () => Promise<void>
        disposers.push(disposer)
      },
    } as unknown as Parameters<typeof apply>[0]

    const config = Config(null) as never
    await apply(ctx, config)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]?.[0]).toMatchObject({ id: 'person-agent' })
    // 模拟卸载：effect 里的清理必须只调用注册表返回的卸载函数。
    // Simulated uninstall: the effect cleanup must invoke exactly the disposer.
    for (const dispose of disposers.reverse()) dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
  })
})
