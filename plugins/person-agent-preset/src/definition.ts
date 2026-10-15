// Person Agent 预设定义：人类可读、小白友好、可视化汇报。
// Person Agent preset definition: human-readable, beginner-friendly, visual reporting.
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** Plugin row shape the registry accepts for one child entry. */
/** 注册表接受的单条子插件行结构。 */
interface PluginRow extends Record<string, unknown> {
  id: string
  name: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/** Tunable knobs the host composition may override. */
/// 宿主组合可以覆盖的可调参数。
export interface PresetOptions {
  presetId: string
  order: number
  withWeb: boolean
  /** Whether the preset includes the workspace maintenance tools. 是否包含工作区维护工具。 */
  withWorkspaceTools: boolean
  /** Whether the preset includes the session maintenance tools. 是否包含会话维护工具。 */
  withSessionTools: boolean
}

/**
 * The persona prompt is the heart of this preset. It tells the agent:
 * 1. Report in plain language a non-technical reader understands.
 * 2. Lead every report with a visual summary (table / diagram / checklist).
 * 3. Deliver concrete artifacts through the `present` tool, not raw logs.
 * 人设提示词是本预设的核心：用小白能懂的语言汇报，先给可视化的总结，
 * 并用 present 工具交付成品文件而不是贴原始日志。
 */
const PERSONA_PREFIX = [
  'You are a work-reporting agent that speaks to human beings, not to engineers.',
  // 中文回答是硬性要求：所有面向用户的句子一律用简体中文。
  // Answering in Chinese is a hard requirement: every user-facing sentence
  // must be in Simplified Chinese.
  'ALWAYS answer in Simplified Chinese (简体中文). Every user-facing sentence — summaries, tables, checklists, explanations, next steps — must be written in Simplified Chinese.',
  'Write every user-facing sentence in plain, everyday language a complete beginner understands:',
  'no jargon without a one-line explanation, no raw paths, IDs or stack traces in the summary.',
  'Every report MUST open with a visual summary before any prose:',
  '- a Markdown table for "what changed / why it matters",',
  '- a Mermaid diagram (flowchart or sequence) when steps or data flow are involved,',
  '- a checklist with done/pending markers for progress.',
  'Show progress visually: percentages, checklists, or a small before/after comparison table.',
  'When a file, chart or document was produced, deliver it with the present tool instead of pasting its contents.',
  'Close each report with at most three next steps, phrased as questions or simple actions.',
].join(' ')

/**
 * Runtime context appended under the persona. Must stay free of `{{cwd}}` and
 * any other prompt variable: the loop does not register `{{cwd}}`, so a
 * reference here fails prompt assembly before any model request (see the
 * system-prompt README). The working-directory service supplies
 * current-directory context on its own.
 * 人设后缀。不得使用 `{{cwd}}` 等提示词变量：循环不注册 `{{cwd}}`，引用会让
 * 提示词组装在任何模型请求前失败（见 system-prompt README）。当前目录上下文
 * 由 working-directory 服务自行提供。
 */
const PERSONA_SUFFIX = ''

/**
 * The sibling dynamic-context plugin is consumed as a normal published
 * package: the row name is the package.json `name`, resolved by the host from
 * the private registry (npm.veren.top) or the workspace link — never a
// 兄弟包 dynamic-context 作为正常发布的包消费：行名就是 package.json 的
 * `name`，由宿主从私有仓库或工作区链接解析——禁止 file URL/相对路径凑合。
 * computed URL.
 */
const dynamicContextRowName = '@veren/person-agent-dynamic-context'

/**
 * 我的设计: 一个preset是一个场景/一个页面
 * 系统提示词{永久记忆 项目无关 通用记忆}
 * 工具提示词{动态工具，与当前项目有关}
 * 工作记忆{动态记忆，与当前项目相关} → dynamic-context 子行在挂载时注入
 */

/**
 * Build the Person Agent preset definition. Fully static: the dynamic part is
 * injected per session by the dynamic-context child row, not baked here.
 * 构建 Person Agent 预设定义。完全静态：动态部分由 dynamic-context 子行在
 * 会话创建时注入，而不是在这里烘焙。
 * @param options - identity, roster order and optional tool toggles.
 * @returns the definition accepted by `ctx.agentPresets.register`.
 */
export function buildPersonAgentPreset(options: PresetOptions): PresetDefinition {
  const tools: PluginRow[] = [
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    {
      id: 'tool-fs-search',
      name: '@deepseek-ai/dsh-tool-fs-search',
      config: { sampleOverCapGlobResults: false },
    },
    // present 让 Agent 把成果作为文件卡片交付，是人类可读汇报的关键出口。
    // present delivers artifacts as file cards - the key outlet for readable reports.
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    // allowParallelInProgress 是新版 dsh-tool-todo 的必填配置（e2e 在真实宿主上抓出）。
    // allowParallelInProgress is required by the newer dsh-tool-todo schema (caught by e2e on a real host).
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  ]
  if (options.withWeb) {
    tools.push({ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web' })
  }
  // 自助维护工具：个人助理要能自己开工作区/会话，而不是只能请用户动手。
  // Self-service maintenance tools: a personal assistant should be able to
  // open workspaces/sessions itself instead of only asking the user.
  if (options.withWorkspaceTools) {
    tools.push({
      id: 'tool-workspace',
      name: '@veren/person-agent-tool-workspace',
      config: { allowCreate: true, allowCreateDirectory: false },
    })
  }
  if (options.withSessionTools) {
    tools.push({
      id: 'tool-session',
      name: '@veren/person-agent-tool-session',
      config: { allowCreate: true, allowFork: true, allowArchive: true, allowPin: true },
    })
  }
  return {
    id: options.presetId,
    name: 'Person Agent',
    description: 'Human-facing reporting agent: plain language, visuals first, deliverable artifacts.',
    order: options.order,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: PERSONA_PREFIX, suffix: PERSONA_SUFFIX },
      },
      {
        id: 'dynamic-context',
        name: dynamicContextRowName,
      },
      ...tools,
    ],
  }
}
