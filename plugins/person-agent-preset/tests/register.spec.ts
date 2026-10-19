// 单测：预设定义合法、注册与逆序清理语义。
// Unit tests: definition validity, registration and reverse-order disposal.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import { buildPersonAgentPreset } from '../src/definition.ts'
import { apply, Config } from '../src/index.ts'

const OPTIONS = {
  presetId: 'person-agent',
  order: 5,
  withWeb: true,
  withSkills: true,
  withReanchor: true,
  reanchorThreshold: 3,
}

describe('buildPersonAgentPreset', () => {
  it('produces an entry list the registry validator accepts', () => {
    const definition = buildPersonAgentPreset(OPTIONS)
    expect(entryListProblem(definition.plugins)).toBeUndefined()
  })

  it('is the bridge: delegating persona and both maintenance tool families are always on', () => {
    // 桥梁是唯一形态：没有开关，人设与维护工具不可拆。
    // The bridge has exactly one shape: no switches - the persona and the
    // maintenance tool families are not optional.
    const definition = buildPersonAgentPreset(OPTIONS)
    const workspace = definition.plugins.find((row) => row.id === 'tool-workspace')
    const session = definition.plugins.find((row) => row.id === 'tool-session')
    expect(String(workspace?.name)).toBe('@veren/person-agent-tool-workspace')
    expect(String(session?.name)).toBe('@veren/person-agent-tool-session')
    // 部署默认收紧：工具不允许擅自递归建目录。
    // Tight deployment default: the tool may not create directories on its own.
    expect(workspace?.config).toMatchObject({ allowCreate: true, allowCreateDirectory: false })
    expect(session?.config).toMatchObject({ allowCreate: true, allowDispatch: true, allowFork: true, allowArchive: true, allowPin: true })
  })

  it('keeps the bridge persona: a character with metacognition, not a handbook', () => {
    // 人设四层 + 元认知层齐备；身份是「总管」，从不亲自干活。
    // The persona layers plus metacognition are all present; the identity is
    // a chief of staff that never does the work itself.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    const prefix = String((persona?.config as { prefix?: string })?.prefix)
    expect(prefix).toContain('chief of staff')
    expect(prefix).toContain('think about your thinking')
    expect(prefix).toContain('How you think')
    expect(prefix).toContain('How you talk with the user')
    expect(prefix).toContain('How you hand off work')
    expect(prefix).toContain('Simplified Chinese')
    expect(definition.description).toContain('bridge between the human and DSH')
  })

  it('prefers a fresh or context-bearing fork without forbidding direct follow-ups', () => {
    // 新任务倾向创建或复用上下文的 fork；纠错与后续沟通可留在原会话。
    // Prefer create or a context-bearing fork for new work; keep corrections and follow-ups in place.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    const prefix = String((persona?.config as { prefix?: string })?.prefix)
    expect(prefix).toContain('Prefer a newly created session, or a fork')
    expect(prefix).toContain('already holds useful')
    expect(prefix).toContain('Use a direct message to an existing session')
    expect(prefix).toContain('correction, small follow-up')
    expect(prefix).toContain('do not create or fork merely to follow a rule')
  })

  it('guides instead of dictating: the persona carries no tool recipes', () => {
    // 提示词只是引导，不是员工手册：不出现逐步流程编号，也不替模型拼装
    // 工具参数——判断权留给模型本身。
    // The prompt guides, it is not an employee handbook: no numbered workflow
    // and no parameter assembly on the model's behalf - judgment stays with it.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    const prefix = String((persona?.config as { prefix?: string })?.prefix)
    expect(prefix).not.toMatch(/[1-6]\. [A-Z]/)
    expect(prefix).not.toContain('workspaceId')
    expect(prefix).not.toContain('session_create')
    expect(prefix).not.toContain('workspace_create')
  })

  it('bakes no roster into the persona suffix (lists move to the dynamic section)', () => {
    // 注册时烘焙名单会过期；suffix 只保留静态模板，名单交给 dynamic-context。
    // Baking lists at register time goes stale; the suffix stays a static template.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    expect(String((persona?.config as { suffix?: string })?.suffix)).not.toContain('Agent Preset List')
  })

  it('puts the hard ban in the suffix with numeric self-work criteria', () => {
    // 最硬的禁令在 suffix（系统提示词最后），判据带数字，模型不用猜形容词。
    // The hard ban lives in the suffix (end of the system prompt), with numeric
    // criteria so the model checks a count instead of judging an adjective.
    const definition = buildPersonAgentPreset(OPTIONS)
    const persona = definition.plugins.find((row) => row.id === 'persona')
    const prefix = String((persona?.config as { prefix?: string })?.prefix)
    const suffix = String((persona?.config as { suffix?: string })?.suffix)
    expect(suffix).toContain('3 or more consecutive steps')
    expect(suffix).toContain('STOP AND CHECK')
    expect(suffix).toContain('Create or dispatch a working session')
    // 后缀里的数字与重锚阈值同源：改成 5，prompt 也变成 5。
    // The number in the suffix comes from the same threshold: 5 changes both.
    const five = buildPersonAgentPreset({ ...OPTIONS, reanchorThreshold: 5 })
    const fiveSuffix = String((five.plugins.find((row) => row.id === 'persona')?.config as { suffix?: string } | undefined)?.suffix)
    expect(fiveSuffix).toContain('5 or more consecutive steps')
    // 禁令只保留一份：prefix 不再重复「停手改派活」。
    // One statement only: the prefix no longer repeats "stop and delegate".
    expect(prefix).not.toContain('stop and delegate')
    expect(prefix).not.toContain('STOP AND CHECK')
  })

  it('mounts no edit tool but keeps write for human-facing documents', () => {
    // 预设不再挂 edit（不是删工具包），write 保留给「写给人看的文档」。
    // The preset no longer mounts edit (the package stays intact), while write
    // remains for documents a human reads.
    const definition = buildPersonAgentPreset(OPTIONS)
    const fs = definition.plugins.find((row) => row.id === 'tool-fs')
    expect(String(fs?.name)).toBe('@deepseek-ai/dsh-tool-fs')
    expect(fs?.config).toMatchObject({ edit: false })
    expect(fs?.config).not.toMatchObject({ write: false })
    expect(definition.plugins.some((row) => /(?:^|[^a-z])edit(?:[^a-z]|$)/iu.test(String(row.name)))).toBe(false)
  })

  it('mounts the periodic re-anchor row with a configurable threshold', () => {
    // B 层是独立子行，阈值可配；关掉 withReanchor 后整行消失。
    // Layer B is its own child row with a configurable threshold; turning
    // withReanchor off removes the row entirely.
    const definition = buildPersonAgentPreset(OPTIONS)
    const reanchor = definition.plugins.find((row) => row.id === 'reanchor')
    expect(String(reanchor?.name)).toBe('@veren/person-agent-reanchor')
    expect(reanchor?.config).toMatchObject({ threshold: 3 })
    const disabled = buildPersonAgentPreset({ ...OPTIONS, withReanchor: false })
    expect(disabled.plugins.some((row) => row.id === 'reanchor')).toBe(false)
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

  it('loads only the packaged writing skill and keeps it inside this preset', () => {
    // 技能来源只扫包内 skills/：不把项目或用户根技能带进个人助理。
    // The skill source scans only the packaged skills/ directory: project and
    // user-root skills stay out of the person-agent preset.
    const definition = buildPersonAgentPreset(OPTIONS)
    const filesystem = definition.plugins.find((row) => row.id === 'skill-filesystem')
    expect(String(filesystem?.name)).toBe('@deepseek-ai/dsh-skill-filesystem')
    const config = filesystem?.config as { includeDefaultRoots?: boolean; customSkillDirs?: string[] }
    expect(config.includeDefaultRoots).toBe(false)
    expect(config.customSkillDirs).toHaveLength(1)
    expect(config.customSkillDirs?.[0]).toMatch(/skills[\\/]$/)
    expect(definition.plugins.some((row) => row.id === 'tool-skill')).toBe(true)
    expect(String((definition.plugins.find((row) => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix)).toContain('renhua')
  })

  it('omits the skill rows when withSkills is false', () => {
    const definition = buildPersonAgentPreset({ ...OPTIONS, withSkills: false })
    expect(definition.plugins.some((row) => row.id === 'skill-filesystem')).toBe(false)
    expect(definition.plugins.some((row) => row.id === 'tool-skill')).toBe(false)
    expect(String((definition.plugins.find((row) => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix)).not.toContain('renhua')
  })

  it('ships a kebab-case skill whose description names when to use it', () => {
    const path = fileURLToPath(new URL('../skills/renhua/SKILL.md', import.meta.url))
    const text = readFileSync(path, 'utf8')
    expect(text).toMatch(/^---\nname: renhua\ndescription: .+\n---\n/)
    expect(text).toContain('什么时候不该用')
    expect(text).toContain('否定词、条件、数量、代码/路径/报错原文一律不动')
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
