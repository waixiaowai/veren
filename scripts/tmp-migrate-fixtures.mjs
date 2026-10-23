// 一次性迁移脚本（跑完即删）：page-registry 测试夹具迁移到组件体登记。
// One-off migration script (deleted after running): moves page-registry test
// fixtures to component-body tool registration. CRLF-normalized replacements.
import { readFileSync, writeFileSync } from 'node:fs'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const CRLF = CR + LF

function edit(path, fn) {
  const s = readFileSync(path, 'utf8').split(CRLF).join(LF)
  const next = fn(s)
  writeFileSync(path, next)
  console.log(path, 'applied:', next !== s)
}

const READ_TOOL = [
  '      pageCtx.page.tool(defineTool({',
  "        name: 'read', description: '读材料', parameters: {},",
  "        output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },",
  '        execute: async () => ({ ok: true }),',
  '      }))',
].join(LF)

// ---- runtime.spec.ts ----
edit('plugins/page-registry/tests/runtime.spec.ts', (s) => {
  let out = s
  out = out.replace(
    [
      "    (props: { id?: string }) => createElement('p', { children: `任务 #${props.id ?? '?'}` }),",
      '    {',
      "      url: '/apps/demo/task/:id',",
      "      description: '任务详情页',",
      "      tools: ['read'],",
      "      instructions: '先读材料，再作答。',",
    ].join(LF),
    [
      "    (_props: { id?: string }, pageCtx) => {",
      '      // 工具只在页面存在：详情页的读工具由组件体登记（设计律）',
      '      // / a tool exists only inside a page: the detail page records its read tool in the body (design law)',
      ...READ_TOOL.split(LF),
      "      return createElement('p', { children: `任务 #${_props.id ?? '?'}` })",
      '    },',
      '    {',
      "      url: '/apps/demo/task/:id',",
      "      description: '任务详情页',",
      "      instructions: '先读材料，再作答。',",
    ].join(LF),
  )
  out = out.replace(
    [
      '  // 目录值就是 DSH ToolDefinition 本体（defineTool 产物）/ the catalog value IS a DSH ToolDefinition',
      "  const toolsOf = () => new Map([['read', defineTool({",
      "    name: 'read', description: '读材料', parameters: {},",
      "    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },",
      '    execute: async () => ({ ok: true }),',
      '  })]])',
      '  const ports = {',
      '    sessions: sessions.port,',
      "    apps: options.withApps === false ? { get: () => undefined } : { get: () => app },",
      '    toolsOf,',
    ].join(LF),
    [
      '  const ports = {',
      '    sessions: sessions.port,',
      "    apps: options.withApps === false ? { get: () => undefined } : { get: () => app },",
    ].join(LF),
  )
  out = out.replace(", toolsOf: () => new Map() })", ' })')
  out = out.replace(
    "      { url: '/apps/demo/preview', description: '预挂页', tools: ['read'], instructions: '预挂页说明。' },",
    "      { url: '/apps/demo/preview', description: '预挂页', instructions: '预挂页说明。' },",
  )
  return out
})

// ---- delivery.spec.ts ----
edit('plugins/page-registry/tests/delivery.spec.ts', (s) => {
  let out = s
  out = out.replace(
    [
      "    () => createElement('p', { children: '任务详情' }),",
      '    {',
      "      url: '/apps/demo/task/:id',",
      "      description: '任务详情页',",
      "      tools: ['read'],",
      '      writes: true,',
      "      instructions: '只处理 params.id 指定的这一条任务。',",
      '    },',
    ].join(LF),
    [
      "    (_props: Record<string, string>, pageCtx) => {",
      '      // 工具只在页面存在：组件体登记（设计律）/ a tool exists only inside a page: recorded in the body (design law)',
      ...READ_TOOL.split(LF),
      "      return createElement('p', { children: '任务详情' })",
      '    },',
      '    {',
      "      url: '/apps/demo/task/:id',",
      "      description: '任务详情页',",
      '      writes: true,',
      "      instructions: '只处理 params.id 指定的这一条任务。',",
      '    },',
    ].join(LF),
  )
  out = out.replace(
    [
      '  // 目录值就是 DSH ToolDefinition 本体（defineTool 产物）/ the catalog value IS a DSH ToolDefinition',
      "  const toolsOf = () => new Map([['read', defineTool({",
      "    name: 'read', description: '读材料', parameters: {},",
      "    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },",
      '    execute: async () => ({ ok: true }),',
      '  })]])',
    ].join(LF),
    [],
  )
  out = out.replace('    toolsOf,\n', '')
  out = out.replace(
    "    const declared = defineAppPage({ name: 'writer', url: '/apps/demo/w', description: 'd', writes: true, tools: ['read'] })",
    "    const declared = defineAppPage({ name: 'writer', url: '/apps/demo/w', description: 'd', writes: true })",
  )
  return out
})

// ---- live-binding.spec.ts ----
edit('plugins/page-registry/tests/live-binding.spec.ts', (s) => {
  let out = s
  out = out.replace(
    [
      '  // 目录值就是 DSH ToolDefinition 本体（defineTool 产物）/ the catalog value IS a DSH ToolDefinition',
      "  const toolsOf = () => new Map([['read', defineTool({",
      "    name: 'read', description: '读材料', parameters: {},",
      "    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },",
      '    execute: async () => ({ ok: true }),',
      '  })]])',
    ].join(LF),
    [],
  )
  out = out.replace('    toolsOf,\n', '')
  return out
})
console.log('done')
