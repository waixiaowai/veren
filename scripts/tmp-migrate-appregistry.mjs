// 一次性迁移脚本（跑完即删）：app-registry 测试迁移到"工具只在页面存在"。
// One-off migration script (deleted after running): moves app-registry tests to
// the design law (a tool exists only inside a page). CRLF-normalized.
import { readFileSync, writeFileSync } from 'node:fs'

const s0 = readFileSync('plugins/app-registry/tests/service.spec.ts', 'utf8').split('\r\n').join('\n')
let out = s0

// helpers: detail fixture loses the meta.tools arm; makeTool + defineTool import go away
out = out.replace(
  `/** 详情页夹具：带 :param + writes + 工具 + 说明（§3.10.5 规则 3；引用的工具必须已定义）
 * / a detail fixture: a :param + writes + a tool + instructions (rule 3; the referenced tool must exist) */
function detailDef(appId: string, name: string, path: string, tool = 'read'): [PageFC, ComponentPageMeta] {
  const [component, meta] = pageDef(appId, name, path)
  return [component, { ...meta, tools: [tool], writes: true, instructions: \`handle one \${name} record\` }]
}

/** defineTool 产物：目录测试通用的最小工具 / minimal defineTool product */
function makeTool(name = 'read') {
  return defineTool({
    name,
    description: 'd',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({}),
  })
}`,
  `/** 详情页夹具：带 :param + writes + 说明（规则 3 的说明半边；工具半边在挂载期判）
 * / a detail fixture: a :param + writes + instructions (rule 3's instructions half; the tool half is judged at mount) */
function detailDef(appId: string, name: string, path: string): [PageFC, ComponentPageMeta] {
  const [component, meta] = pageDef(appId, name, path)
  return [component, { ...meta, writes: true, instructions: \`handle one \${name} record\` }]
}`,
)
out = out.replace("import { defineTool } from '@deepseek-ai/dsh-tools'\n", '')

// unknown-app face: only pages now
out = out.replace(
  `  it('get 未知应用返回 undefined；pages/tools 未知应用抛 NotFound', () => {
    const { apps } = setup()
    expect(apps.get('ghost' as AppId)).toBeUndefined()
    expect(() => apps.pages('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
    expect(() => apps.tools('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
  })`,
  `  it('get 未知应用返回 undefined；pages 未知应用抛 NotFound', () => {
    const { apps } = setup()
    expect(apps.get('ghost' as AppId)).toBeUndefined()
    expect(() => apps.pages('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
  })`,
)

// uniqueness test: drop the catalog define
out = out.replace("    apps.tools('todo' as AppId).define(makeTool())\n", '')

// unknown-tool reference test: deleted (the validation died with the catalog)
out = out.replace(
  `  it('页面引用未定义工具 → ManifestInvalid（工具需先定义）', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    const [component, meta] = pageDef('todo', 'main')
    expect(() => pages.register(component, { ...meta, tools: ['nope'] })).toThrowError(AppErrorCode.ManifestInvalid)
  })

`,
  '',
)
out = out.replaceAll("    apps.tools('todo' as AppId).define(makeTool())\n", '')

// viewer case: registrations carry no tools; the rule-3 arm now passes registration (mount-time owns it)
out = out.replace(
  `  it('viewer 档（只读详情）：带 :param、不声明 writes、零工具 → 如实注册', () => {
    // 只读详情页（有记录身份、纯浏览）不声明 writes、不挂写工具即通过——它是合法的 viewer
    // / a read-only drilldown registers honestly — a legal viewer with no writes claim and no write tools
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    pages.register(...pageDef('todo', 'main'))
    const [component, meta] = pageDef('todo', 'workspace', 'workspace/:wsId')
    expect(() => pages.register(component, meta)).not.toThrow()
    const registered = apps.listPages('todo' as AppId).find((page) => page.name === 'workspace')
    expect(registered?.writes).toBeUndefined()
    expect(registered?.tools).toEqual([])
    // 放宽没有打开详情门：声明 writes: true 却零工具的带参页仍被拒（规则 3）
    // / the loosening did not open the detail gate: a parameterized page
    // declaring writes: true with zero tools is still refused (rule 3)
    const [fakeComponent, fakeMeta] = pageDef('todo', 'fake', 'fake/:id')
    expect(() => pages.register(fakeComponent, { ...fakeMeta, writes: true }))
      .toThrowError(expect.objectContaining({ code: 'page/detail-invalid' }))
  })`,
  `  it('viewer 档（只读详情）：带 :param、不声明 writes → 如实注册；详情工具半边在挂载期判', () => {
    // 只读详情页（有记录身份、纯浏览）不声明 writes 即通过——它是合法的 viewer。
    // 设计律下页面定义没有工具清单；规则 3 的工具半边由 page-registry 在挂载期
    // 以真实登记面判（fail loud），注册期不再看得到也不再看工具。
    // / a read-only drilldown registers honestly — a legal viewer with no writes
    // claim. Under the design law the page definition carries no tool list;
    // rule 3's tool half is judged at mount by page-registry over the really-
    // collected face (fail loud) — registration no longer sees tools at all.
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    pages.register(...pageDef('todo', 'main'))
    const [component, meta] = pageDef('todo', 'workspace', 'workspace/:wsId')
    expect(() => pages.register(component, meta)).not.toThrow()
    const registered = apps.listPages('todo' as AppId).find((page) => page.name === 'workspace')
    expect(registered?.writes).toBeUndefined()
    expect('tools' in registered).toBe(false)
    const [fakeComponent, fakeMeta] = pageDef('todo', 'fake', 'fake/:id')
    expect(() => pages.register(fakeComponent, { ...fakeMeta, writes: true })).not.toThrow()
  })`,
)

// the tools-namespace describe block: deleted with the catalog
out = out.replace(
  `describe('tools 注册面与命名空间', () => {
  it('工具本地名重复 → ToolDuplicate；对外名 = <toolPrefix>__<name>', () => {
    const { apps } = setup('todo')
    const tools = apps.tools('todo' as AppId)
    const tool = makeTool('add')
    tools.define(tool)
    expect(() => tools.define(tool)).toThrowError(AppErrorCode.ToolDuplicate)
    expect(apps.exportToolName('todo' as AppId, 'add')).toBe('todo__add')
  })

  it('两个应用注册同名工具 → 得到两个不同前缀的对外名', () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('alpha'))
    apps.register(appDef('beta'))
    const tool = makeTool()
    apps.tools('alpha' as AppId).define(tool)
    apps.tools('beta' as AppId).define(tool)
    const [alpha, beta] = [apps.exportToolName('alpha' as AppId, 'read'), apps.exportToolName('beta' as AppId, 'read')]
    expect(alpha).toBe('alpha__read')
    expect(beta).toBe('beta__read')
    expect(alpha).not.toBe(beta)
    expect(apps.listTools('alpha' as AppId)[0]?.externalName).toBe('alpha__read')
  })
})

`,
  '',
)

writeFileSync('plugins/app-registry/tests/service.spec.ts', out)
console.log('applied:', out !== s0, '| tools refs left:', (out.match(/apps\.tools|makeTool|listTools|exportToolName/g) ?? []).length)
