/**
 * Bundled `startup-autostart` skill provider: one model-invocable skill that
 * teaches when a startup item is the right request, how the four actions
 * differ, and how the run rules, input bounds, and failure codes behave.
 *
 * The provider is immutable and has no configuration: it registers one fixed
 * candidate at the bundled skill rank and reads the body from the packaged
 * asset on every load. Mounting the plugin row is the only switch; a profile
 * without the `skills` service leaves the row pending instead of failing boot.
 *
 * 内置 `startup-autostart` 技能提供者：一条面向模型的技能，讲清什么时候该建
 * 启动项、四个动作的区别，以及运行规则、输入边界和失败码怎么处理。
 *
 * 提供者不可变、零配置：在 bundled rank 注册唯一候选，每次加载都从包内 asset
 * 读取正文；挂载这一行就是唯一开关。没有 `skills` 服务的 profile 只会让这一行
 * 保持 pending，不会拖垮启动。
 * @module @veren/startup-autostart-skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'

/** Plugin name registered with the Loader. / 注册到 Loader 的插件名。 */
export const name = 'skill-startup-autostart'

/**
 * Empty configuration: the guidance is fixed and mounting the row is the only
 * switch. / 空配置：指导内容固定，挂载这一行就是唯一开关。
 */
export const Config = z.object({})

/**
 * Service the provider registers on. A profile without `skills` keeps this row
 * pending; it never fails the boot that mounted it.
 * 提供者注册所需的技能注册表。没有 `skills` 服务的 profile 会让本行保持 pending，
 * 绝不会让挂载它的启动失败。
 */
export const inject = ['skills']

const PROVIDER_NAME = 'startup-autostart-skill'
const SKILL_NAME = 'startup-autostart'
const SKILL_BODY_URL = new URL('../assets/startup-autostart.md', import.meta.url)
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * Routing text the session skill catalog shows the model. It must name both
 * the requests that should load this skill and the ones that should not, and
 * stay inside the catalog's 500-character budget so the exclusion clause is
 * never truncated away.
 * 会话技能目录展示给模型的路由文字。必须同时写明「该加载」和「不该加载」的请求，
 * 并控制在目录 500 字符的预算内，避免排除条件被截掉。
 */
const DESCRIPTION = 'Use when the user wants work to run at every DeepSeek Harness start ("每次都要", "以后每次都", "开机就"), or asks to list, add, change, disable, or delete their startup items. Covers which action fits (new_session / resume_session / message_session / queue_message) and the run rules: every enabled item runs on every successful start with no debounce, and a restart interrupts the previous start\'s work. Skip it for one-off work, clock-time scheduling, or a question that only asks what startup items are.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      path: SKILL_PATH,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/**
 * Register the bundled provider on the calling scope's skill registry.
 * @param ctx - Context carrying the `skills` service.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
