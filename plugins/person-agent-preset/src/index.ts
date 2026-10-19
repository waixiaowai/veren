// 插件入口：通过 agent-preset-registry 的运行时 API 动态注册 Person Agent 预设。
// Plugin entry: dynamically registers the Person Agent preset through the
// agent-preset-registry runtime API instead of static YAML rows.
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { buildPersonAgentPreset } from './definition.js'
import type {} from '@deepseek-ai/dsh-workspace'
export const name = 'personAgentPreset'

export interface Config {
  /** Preset identity sessions will record. */
  /** 会话将记录的预设身份。 */
  presetId: string
  /** Roster order in client pickers. */
  /** 在客户端选择器中的排序。 */
  order: number
  /** Whether the preset includes the web search tool. */
  /// 预设是否包含联网搜索工具。
  withWeb: boolean
  /** Whether the preset includes the bundled human-writing skill and its loader. */
  /** 预设是否包含内置的「人话」写作技能与加载器。 */
  withSkills: boolean
  /** Whether the preset mounts the periodic re-anchor row. */
  /** 预设是否挂载定期重锚行。 */
  withReanchor: boolean
  /** Consecutive analysis-only steps before a re-anchor reminder, also stated in the persona suffix. */
  /** 触发重锚所需的连续纯分析步数；人设 suffix 使用同一个数字。 */
  reanchorThreshold: number
}

export const Config: z<Config> = z
  .object({
    presetId: z.string().default('person-agent'),
    order: z.number().default(5),
    withWeb: z.boolean().default(true),
    withSkills: z.boolean().default(true),
    withReanchor: z.boolean().default(true),
    reanchorThreshold: z.natural().min(1).default(3),
  })
  .description('Person Agent preset identity; the delegating persona and both maintenance tool families are always on, with a configurable periodic self-work re-anchor.')

// 注入的是能力（Service）：注册表负责声明，名单由 dynamic-context 子行在
// 会话创建时读取，本入口无需 workspaceRegistry。
// Injection targets capabilities: the registry owns declarations; the lists
// are read per session by the dynamic-context child row, so this entry does
// not need workspaceRegistry itself.
export const inject = ['agentPresets']
export const provide = []

export const apply = async (ctx: Context, config: Config): Promise<void> => {
  // 本 apply 只在部署/组合加载时跑一次：它登记的是静态定义（preset 由哪些
  // 子行组成），不读任何会话状态。子行（含 dynamic-context）才是每个会话
  // 挂载时重新激活的——名单读取发生在子行挂载时刻，所以新会话总能拿到
  // 最新值（见 mount.ts 的 mountPreset）。
  // This apply runs once at deployment/composition load: it registers a
  // static definition (which child rows the preset consists of) and reads no
  // session state. The child rows (including dynamic-context) are what
  // re-activate per session mount - list reads happen at child-row mount
  // time, so a fresh session always sees fresh values (see mountPreset in
  // mount.ts).
  // 先注册拿到逆序清理用的卸载函数，再交给 cordis effect 托管。
  // Register first to obtain the disposer, then hand it to the cordis effect
  // system so uninstall runs in reverse order without leaking the definition.
  const unregister = await ctx.agentPresets.register(
    buildPersonAgentPreset({
      presetId: config.presetId,
      order: config.order,
      withWeb: config.withWeb,
      withSkills: config.withSkills,
      withReanchor: config.withReanchor,
      reanchorThreshold: config.reanchorThreshold,
    }),
  )
  // effect 的 execute 返回卸载函数本身，cordis 会在卸载时自动逆序调用。
  // The effect body returns the disposer itself; cordis invokes it in reverse
  // order automatically when the fiber unloads.
  ctx.effect(() => unregister, 'agent-preset:person-agent')
}
