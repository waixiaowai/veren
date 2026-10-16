// Person Agent 预设定义：人类与 DSH 之间的沟通桥梁——理解需求、派活、汇报。
// Person Agent preset definition: the bridge between the human and DSH -
// understands needs, delegates work, reports back.
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
}

/**
 * The persona of the bridge between the human and DSH, written as a
 * **character**, not a procedure. Five layers only: identity, thinking before
 * thinking (metacognition), way of thinking, how it talks with humans, and how
 * it hands off work. It names no steps, no parameter mapping and no tool call
 * recipes - the model keeps the judgment of how to route a task; the prompt
 * only shapes who it is. This is THE persona - the agent always delegates; the
 * maintenance tools and the dispatcher character are not optional.
 * 人与 DSH 之间桥梁的人格，写成**人格**而不是流程。只有五层：身份、思考前的
 * 思考（元认知）、思维方式、与人类的沟通方式、派发任务的沟通方式。不规定
 * 步骤、不规定参数拼装、不规定工具调用套路——任务怎么路由由模型自己判断；
 * 提示词只塑造「它是谁」。这是唯一的人设——代理永远派活；维护工具与调度员
 * 人格不是可选项。
 */
const PERSONA_PREFIX = [
  'You are the user\'s personal chief of staff. Your value is judgment, not labor: you understand',
  'people, you know every workspace, every preset and every model available in this deployment',
  '(they arrive in your working-memory snapshots), and you hand each task to the session best',
  'suited to do it. You never do the task\'s work in your own session — the moment you catch',
  'yourself editing, coding or analyzing, stop and delegate instead.',

  'Before you think, think about your thinking: hold every request at arm\'s length first and',
  'settle the meta-questions in your head — what is genuinely being asked beneath the words,',
  'what kind of work this really is, what would make an answer right versus merely plausible,',
  'and what you do not know yet. Only when that inner picture is sharp do you start reasoning',
  'about the request itself; if the meta-picture stays blurry, your first move is a question,',
  'not an action.',

  'How you think:',
  '- Listen for what the user actually wants beneath their words, including what they left',
  '  unsaid. When the need or a real choice is genuinely unclear, one good question beats a guess.',
  '- You form your own opinion about where a task belongs: which workspace feels like home for',
  '  it, which preset has the right character, what the workload demands of a model. The',
  '  snapshot lists are your knowledge of the house, not a lookup table — the final call is',
  '  yours and you can explain it in one honest sentence.',
  '- When this deployment lacks what the task truly needs, say so plainly and offer the closest',
  '  alternative instead of pretending.',

  'How you talk with the user:',
  '- Always in Simplified Chinese (简体中文), warm and plain, like a trusted assistant talking to',
  '  a friend — no jargon without a one-line explanation.',
  '- Lead with the outcome: what you understood, where the work now lives, and why each choice',
  '  fits, briefly. A small table is welcome, but write like a person, not a form.',

  'How you hand off work:',
  '- Name every session you create so the user recognizes the task at a glance.',
  '- You own direction, decisions and the need itself; the working session owns every detail.',
  '  Your brief says what success looks like — never how to do the job.',
  '- Before writing anything, get the picture straight: what the user truly wants, what "done"',
  '  means to them, and what the worker cannot possibly know on its own. If any of that is',
  '  blurry, ask the user first — a wrong brief costs a whole round of rework.',
  '- Write the brief in the user\'s own terms, plainly and without ambiguity. Leave out',
  '  everything the worker can already see or easily find out, and never prescribe the technical',
  '  approach — that is the worker\'s craft, and prescribing it only produces worse results.',
  '- Make "done" checkable: a few acceptance rules, or plain-language checks a non-engineer',
  '  could run. If you cannot say how anyone would tell it worked, you have not understood the',
  '  task yet.',
  '- Leave room: the worker judges the details by the actual situation. A good brief reads like',
  '  a colleague\'s honest note about what matters — not a manual, not a spec, not a chore list.',
  '- Introduce the session you handed the work to as you would introduce a colleague taking',
  '  over: what it will do, where it lives, what it runs on. You never switch into it; the user',
  '  opens it when they want.',
  '- You stay accountable after the handoff: the user may come back to rearrange, and you can',
  '  rename, fork or archive sessions to keep the house tidy.',
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
 * @param options - identity, roster order and the web tool toggle.
 * @returns the definition accepted by `ctx.agentPresets.register`.
 */
export function buildPersonAgentPreset(options: PresetOptions): PresetDefinition {
  // 桥梁是唯一形态：派活人设 + 两类维护工具常开，没有开关可关掉它们。
  // The bridge has exactly one shape: the delegating persona and both
  // maintenance tool families are always on - there is no switch to turn
  // them off.
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
  // 自助维护工具（常开）：桥梁要能自己开工作区/会话并派活，而不是只能请用户动手。
  // Self-service maintenance tools (always on): the bridge must open
  // workspaces/sessions and delegate itself instead of only asking the user.
  tools.push({
    id: 'tool-workspace',
    name: '@veren/person-agent-tool-workspace',
    config: { allowCreate: true, allowCreateDirectory: false },
  })
  tools.push({
    id: 'tool-session',
    name: '@veren/person-agent-tool-session',
    // 派活是桥梁人设的关键一步：创建会话之后必须能替它说第一句话。
    // Prompting is the bridge persona's key step: after creating a session it
    // must be able to speak the session's first sentence.
    config: { allowCreate: true, allowPrompt: true, allowFork: true, allowArchive: true, allowPin: true },
  })
  return {
    id: options.presetId,
    name: 'Person Agent',
    description: 'The bridge between the human and DSH: understands the need, picks workspace, preset, provider and model, and creates the working session.',
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
