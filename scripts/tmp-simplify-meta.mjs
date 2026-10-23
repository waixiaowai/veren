// 一次性改写脚本（跑完即删）：prompt-page 的 tools 目录链退役（CRLF 归一化后替换）。
// One-off rewrite script (deleted after running): retires the tools catalog
// chain in prompt-page (replacements run on LF-normalized text).
import { readFileSync, writeFileSync } from 'node:fs'

function edit(path, fn) {
  const raw = readFileSync(path, 'utf8')
  const normalized = raw.replaceAll('\r\n', '\n')
  const next = fn(normalized)
  writeFileSync(path, next)
  console.log(path, 'changed:', next !== normalized)
}

// ---- prompt-page/src/component.tsx: drop the tools field from ComponentPageMeta ----
edit('packages/prompt-page/src/component.tsx', (s) =>
  s.replace(
    /  \/\*\* 应用工具目录的本地名清单[^\n]*\n\s*\* \/ local tool names from the app catalog[^\n]*\n\s*\*\/\n/,
    '',
  ),
)

// ---- prompt-page/src/page.tsx: definePage/defineAppPage lose the tools arm ----
edit('packages/prompt-page/src/page.tsx', (s) => {
  let out = s
  out = out.replace('  tools?: readonly string[]\n', '')
  out = out.replace(
    '  const { name, url, description, tools, writes, instructions, skills, load, instanceTitle } = definition',
    '  const { name, url, description, writes, instructions, skills, load, instanceTitle } = definition',
  )
  out = out.replace('    ...(tools === undefined ? {} : { tools }),\n', '')
  out = out.replace(
    ` * 并补齐契约缺省：tools 缺省 []（§3.1、§6.1）；详情页结构校验（§3.10.5 规则 3）。
 * 组件注册器（app-registry）的注册路径应使用本函数或等效校验。
 * App-scoped definePage: enforces the /apps url shape, contract defaults, and
 * the detail-page structure rules (§3.10.5 rule 3). App-registry's registration
 * path should use this function or equivalent validation.`,
    ` * 并做详情页说明校验（§3.10.5 规则 3 的说明半边；工具半边移到挂载期，由
 * page-registry 以真实登记面判）。组件注册器（app-registry）的注册路径应使用
 * 本函数或等效校验。
 * App-scoped definePage: enforces the /apps url shape and the instructions
 * half of the detail rule (§3.10.5 rule 3; the tool half moved to mount time,
 * judged by page-registry over the really-collected face). App-registry's
 * registration path should use this function or equivalent validation.`,
  )
  out = out.replace(
    `    // §3.10.5 规则 3：只约束"带 :param 且声明了写意图"的详情页——至少挂一个
    // 工具 + 说明非空。带 :param 而未声明 writes = viewer（只读详情），全部豁免
    // （规则 2）。工具页缺写工具走 §3.9 警告通道，不做门禁。
`,
    `    // §3.10.5 规则 3（说明半边）：带 :param 且声明写意图的详情页说明非空；
    // 工具半边（至少登记一个工具）在挂载期由 page-registry 以真实登记面判。
    // 带 :param 而未声明 writes = viewer（只读详情），全部豁免（规则 2）。
`,
  )
  out = out.replace(
    `    // Rule 3: binds only parameterized pages that declared write intent — at
    // least one mounted tool plus non-empty instructions. A parameterized page
    // without the declaration is a viewer (a read-only drilldown) and is fully
    // exempt (rule 2). An action page missing its write tools rides the §3.9
    // warning channel, never a gate.
`,
    `    // Rule 3 (the instructions half): a parameterized page that declared write
    // intent must carry non-empty instructions; the tool half (at least one
    // recorded tool) is judged at mount time by page-registry over the really-
    // collected face. A parameterized page without the declaration is a viewer
    // (a read-only drilldown) and is fully exempt (rule 2).
`,
  )
  out = out.replace(
    `    if ((page.tools ?? []).length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        \`detail page "\${page.name}" (\${page.url}) must mount at least one tool to fulfill its duty\`)
    }
`,
    '',
  )
  out = out.replace(
    `  return {
    ...page,
    tools: page.tools ?? [],
  }
}`,
    '  return page\n}',
  )
  return out
})
console.log('done')
