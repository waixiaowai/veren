// 一次性迁移脚本（跑完即删）：lifecycle.spec 迁移到"工具只在页面存在"。
// One-off migration script (deleted after running): moves lifecycle.spec to the
// design law. CRLF-normalized.
import { readFileSync, writeFileSync } from 'node:fs'

const s0 = readFileSync('plugins/app-registry/tests/lifecycle.spec.ts', 'utf8').split('\r\n').join('\n')
let out = s0

// 1) app_pages bootstrap test: the tool-name projection is gone — assert the page shape only
out = out.replace(
  `  it('app_pages 返回页面键/URL 模式/入口标记/带前缀的工具名；disabled 返回结构化错误', async () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('todo'))
    apps.tools('todo' as AppId).define(makeTool('add'))
    const [component, meta] = pageDef('todo', 'main')
    apps.pages('todo' as AppId).register(component, { ...meta, tools: ['add'] })`,
  `  it('app_pages 返回页面键/URL 模式/入口标记；disabled 返回结构化错误', async () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('todo'))
    const [component, meta] = pageDef('todo', 'main')
    apps.pages('todo' as AppId).register(component, meta)`,
)

// 2) fiber teardown test: drop the tool define + listTools assertion
out = out.replace(
  `      apps.pages('todo' as AppId, ctx).register(...pageDef('todo', 'main'))
      apps.tools('todo' as AppId, ctx).define(makeTool('add'))
    })
    expect(apps.catalog()).toHaveLength(1)
    expect(apps.listPages('todo' as AppId)).toHaveLength(1)
    expect(apps.listTools('todo' as AppId)).toHaveLength(1)`,
  `      apps.pages('todo' as AppId, ctx).register(...pageDef('todo', 'main'))
    })
    expect(apps.catalog()).toHaveLength(1)
    expect(apps.listPages('todo' as AppId)).toHaveLength(1)`,
)

// 3) ownership test: only the pages face remains
out = out.replace(
  `  it('pages/tools 只允许注册 fiber 自己获取；跨 fiber → Forbidden', async () => {`,
  `  it('pages 只允许注册 fiber 自己获取；跨 fiber → Forbidden', async () => {`,
)
out = out.replace(
  `    expect(() => apps.pages('todo' as AppId, otherCtx)).toThrowError(AppErrorCode.Forbidden)
    expect(() => apps.tools('todo' as AppId, otherCtx)).toThrowError(AppRegistryError)`,
  `    expect(() => apps.pages('todo' as AppId, otherCtx)).toThrowError(AppErrorCode.Forbidden)`,
)

// 4) drop the tools fixture at line ~49 area (defineTool-based composition test)
out = out.replace(
  `      apps.tools('todo' as AppId, ctx).define(makeTool('add'))\n`,
  '',
)
out = out.replace(
  `    expect(apps.listTools('todo' as AppId)).toHaveLength(1)\n`,
  '',
)

// 5) makeTool + defineTool import: drop if now unused
if (!out.includes('makeTool(')) {
  out = out.replace(/\/\*\* defineTool 产物[^\n]*\n(.*\n)*?}\n\n/, '')
  out = out.replace("import { defineTool } from '@deepseek-ai/dsh-tools'\n", '')
}

writeFileSync('plugins/app-registry/tests/lifecycle.spec.ts', out)
console.log('applied:', out !== s0, '| left:', (out.match(/apps\.tools|makeTool|listTools/g) ?? []).length)
