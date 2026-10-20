// Person Agent 预设定义：人类与 DSH 之间的沟通桥梁——理解需求、派活、汇报。
// Person Agent preset definition: the bridge between the human and DSH -
// understands needs, delegates work, reports back.
import { fileURLToPath } from 'node:url'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** Packaged writing-skill root. `skills/` sits beside `dist/` in the installed package. */
const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

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
  withSkills: boolean
  /** Mount the periodic re-anchor row. 是否挂载定期重锚行。 */
  withReanchor: boolean
  /** Consecutive analysis-only steps before a re-anchor reminder. 触发重锚所需的连续纯分析步数。 */
  reanchorThreshold: number
}

/**
 * The persona of the bridge between the human and DSH, written as a
 * **character**, not a procedure: identity, thinking before thinking
 * (metacognition), way of thinking, how it talks with humans, and how it hands
 * off work. The hard "stop working and delegate" rule is NOT here - it lives in
 * the suffix at the end of the system prompt, where it is closest to the
 * conversation. Keeping one statement of that rule avoids the earlier
 * duplication that diluted both copies.
 * 人与 DSH 之间桥梁的人格，写成**人格**而不是流程：身份、思考前的思考
 * （元认知）、思维方式、与人类的沟通方式、派发任务的沟通方式。最硬的「停手
 * 派活」禁令不在这里——它在系统提示词末尾的 suffix，离对话最近。禁令只保留
 * 一份，避免过去两段重复、彼此冲淡。
 */
const PERSONA_PREFIX = [
  'You are the user\'s personal chief of staff. Your value is judgment, not labor: you understand',
  'people, you know this deployment\'s presets, models and workspaces from your working-memory',
  'snapshots, and you hand each task to the session best suited to carry it.',

  'Before you think, think about your thinking: hold the request at arm\'s length and settle',
  'what is genuinely being asked beneath the words, what kind of work this really is, what',
  'would make an answer right rather than merely plausible, and what you do not know yet. If',
  'that picture stays blurry, ask one question before acting.',

  'How you think:',
  '- Listen for what the user wants beneath the words, including what they left unsaid. When',
  '  the need or a real choice is genuinely unclear, one good question beats a guess.',
  '- Form your own opinion about where a task belongs: which workspace feels like home, which',
  '  preset has the right character, what the workload demands of a model. The snapshot lists',
  '  are your knowledge of the house, not a lookup table; the call is yours, and you can',
  '  explain it in one honest sentence.',
  '- When this deployment lacks what the task truly needs, say so plainly and offer the closest',
  '  alternative instead of pretending.',

  'How you talk with the user:',
  '- Always in Simplified Chinese (简体中文), warm and plain, like a trusted assistant talking to',
  '  a friend — no jargon without a one-line explanation.',
  '- Lead with the outcome: what you understood, where the work now lives, and why each choice',
  '  fits, briefly. A small table is welcome, but write like a person, not a form.',

  'How you hand off work:',
  '- Prefer a newly created session, or a fork when an existing session already holds useful',
  '  context. Use a direct message to an existing session for a correction, small follow-up, or',
  '  work best kept there; do not create or fork merely to follow a rule.',
  '- Name every session you create so the user recognizes the task at a glance.',
  '- Write the brief in the user\'s own terms: what "done" means, acceptance checks a',
  '  non-engineer could run, and only what the worker cannot see. Never prescribe the technical',
  '  approach — that is the worker\'s craft.',
  '- Introduce the session as you would introduce a colleague taking over, and stay accountable',
  '  afterwards: rename, fork or archive sessions to keep the house tidy.',
  '- Parallelize by default: independent tasks go to different sessions at the same time, each',
  '  carrying its own completion report. Queue on one session only when the tasks truly belong',
  '  there (shared context, same target) — the one-outstanding-report-per-target limit binds',
  '  per session, never across sessions. Do not serialize merely for tidiness.',
].join(' ')

/**
 * The one carve-out from the bridge's delegating posture: text the user will
 * read is written here, not handed off. The skill carries the actual rules.
 * 派活姿态的唯一例外：用户要读的文字由桥梁自己写，不外包；具体规矩在技能里。
 */
const WRITING_SKILL_GUIDE = 'When the user asks for text other people will read — a document, letter, notice, README, or report — write it yourself and load the `renhua` skill first. Delegate tasks that need a working session; keep the wording the user will read in your own hands.'

/**
 * The hard rule, rendered last in the system prompt (order
 * `DEPLOYMENT_PERSONA_SUFFIX`) so it sits closest to the conversation. It is
 * static: no `{{cwd}}` or other prompt variable, because an unregistered
 * variable fails prompt assembly before any model request (see the
 * system-prompt README). The criteria are numeric on purpose: the model can
 * check "3+ consecutive analysis-only steps, no dispatch" instead of judging an
 * adjective.
 * 最硬的规则，渲染在系统提示词最后（order `DEPLOYMENT_PERSONA_SUFFIX`），离对话
 * 最近。它是静态文本：不使用 `{{cwd}}` 等提示词变量，因为未注册变量会让提示词
 * 组装在任何模型请求前失败（见 system-prompt README）。判据刻意带数字，且与
 * 重锚插件的 `threshold` 用同一个值：模型可以直接检查「连续 N 步以上只做分析、
 * 且没有派活」，不用猜一个形容词。
 * @param threshold - consecutive analysis-only steps the definition calls self-work. 定义视为自干的连续纯分析步数。
 * @returns the rendered suffix. 渲染出的后缀。
 */
function personaSuffix(threshold: number): string {
  return [
    'STOP AND CHECK (before every tool call): are you doing the work yourself?',
    `You are self-working when this session has ${threshold} or more consecutive steps whose only tool`,
    'calls inspect or analyze — read, read_image, glob, grep, web_search, web_fetch — and you',
    'have not handed this work to another session.',
    'If that is true, stop now: no more files, no more searches, no code. Create or dispatch a',
    'working session, put the goal and its acceptance checks in its first message, and report',
    'back to the user.',
    'The only work you do with your own hands is text a human will read; write that with `write`,',
    'guided by your writing skill.',
  ].join(' ')
}

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
  const skills: PluginRow[] = options.withSkills
    ? [
        // 写作技能只属于这个预设：文件系统来源只扫包内 skills/，不碰项目或用户根。
        // The writing skill belongs to this preset alone: the filesystem source
        // scans only the packaged skills/ directory, never project or user roots.
        {
          id: 'skill-filesystem',
          name: '@deepseek-ai/dsh-skill-filesystem',
          config: {
            includeDefaultRoots: false,
            customSkillDirs: [BUNDLED_SKILL_DIR],
          },
        },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      ]
    : []
  const tools: PluginRow[] = [
    // 文件工具：读写与搜索。write 保留（它是「写给人看的文档」这一唯一合法例外）；
    // edit 仍然关闭——要改代码就走终端执行行，或派给能干活的会话，避免「悄悄改
    // 一行」这种最难审的改动。
    // File tools: read/write plus search. `write` stays - it is the one legitimate
    // carve-out for documents a human reads. `edit` stays off so code changes go
    // through the terminal row or a delegated session, instead of a silent
    // one-line edit nobody reviews.
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { edit: false } },
    {
      id: 'tool-fs-search',
      name: '@deepseek-ai/dsh-tool-fs-search',
      config: { sampleOverCapGlobResults: false },
    },
    // 终端执行行：用户明确要求桥梁自己能跑命令，好让它亲手验收构建与门禁，不必把
    // 每条命令都退回给用户。Windows 上取 pwsh 版；它提供前台执行 + 后台作业，
    // 行为与 bash 版对等。
    // 注意：挂上这一行之后，「桥梁没有终端」这个旧前提就不成立了，自干重新有了
    // 落点；此时唯一的闸门是系统提示词末尾那条带数字的「停手派活」规则。
    // Terminal row: the user asked for real command execution so the bridge can run
    // builds and gates itself instead of bouncing every command back to the human.
    // On Windows this is the pwsh variant (foreground + background jobs, the
    // behavioural twin of the bash tool). Mounting it retires the old "the bridge
    // has no terminal" premise, so self-work has a landing point again; the
    // numeric stop-and-delegate suffix is now the only gate.
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
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
  // 定期重锚是 B 层：工作记忆会老化，人设又离得远，所以在连续 N 步只分析、
  // 没有派活时追加一条很短的事实提醒。它是 append-only 的会话消息，不是系统
  // 提示词更新——exact-prefix 缓存不会因此失效。
  // Periodic re-anchoring is layer B: working memory ages and the persona is far
  // away, so after N consecutive analysis-only steps without a dispatch it
  // appends a short factual reminder. It is an append-only session message, not
  // a system-prompt update, so the exact-prefix cache survives.
  if (options.withReanchor) {
    tools.push({
      id: 'reanchor',
      name: '@veren/person-agent-reanchor',
      config: { threshold: options.reanchorThreshold },
    })
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
    // 派活是桥梁人设的关键一步：创建会话之后必须能替它说第一句话，且派完不等结果——
    // 目标会话真正静止时由 session_dispatch 的看守把收尾输出回报回来。
    // Dispatching is the bridge persona's key step: after creating a session it
    // must be able to speak the session's first sentence without waiting - the
    // session_dispatch guard reports the closing output once the target settles.
    // allowFork 已随 session_fork 工具移除：分叉由 session-fork-enhanced 的
    // session_fork_with_options 接管，preset 不再传这个键。
    // allowFork was removed together with the session_fork tool: forking is
    // owned by session-fork-enhanced (session_fork_with_options), so the
    // preset no longer passes this key.
    config: { allowCreate: true, allowDispatch: true, allowArchive: true, allowPin: true },
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
        config: {
          prefix: options.withSkills ? `${PERSONA_PREFIX} ${WRITING_SKILL_GUIDE}` : PERSONA_PREFIX,
          suffix: personaSuffix(options.reanchorThreshold),
        },
      },
      {
        id: 'dynamic-context',
        name: dynamicContextRowName,
      },
      ...skills,
      ...tools,
    ],
  }
}
