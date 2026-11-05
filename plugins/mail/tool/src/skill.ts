/**
 * The bundled skill: what the agent should know before it sends anything.
 *
 * The skill carries the discipline the tools cannot enforce. A tool refuses an
 * unknown recipient and reports a skipped step's reason; what the skill
 * teaches is the judgement around them — when a notification is the right
 * instrument at all, and what to read afterwards.
 *
 * 内置技能：发送任何东西之前，智能体应当知道的事。
 *
 * 技能承载工具无法强制的纪律。工具会拒绝不存在的收件人、会报告步骤被跳过的原因；技能教的是
 * 它们周围的判断——通知究竟是不是该用的手段，以及事后该读什么。
 *
 * @module @veren/mail-tool/skill
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

/** The skill's name (kebab-case grammar). / 技能名（kebab-case 语法）。 */
export const SKILL_NAME = 'mail-notifications'

/** The body asset's load URL. / 正文资源的加载地址。 */
const SKILL_BODY_URL = new URL('../assets/mail-notifications.md', import.meta.url)

/** The body asset's path. / 正文资源的路径。 */
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)

/** The directory holding the body (the progressive-disclosure resource root). / 正文所在目录（渐进披露的取材根）。 */
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('../assets/', import.meta.url)) } as const

/** The invocation policy. / 调用策略。 */
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * The routing description. It is the only part of the skill the host shows
 * before loading it, so it says when the skill is the right answer and when
 * it is not.
 *
 * 路由说明。它是宿主在加载技能前唯一展示的部分，因此既说明何时该用此技能，也说明何时不该。
 */
const DESCRIPTION = 'Use when a request is about reaching people through notifications rather than '
  + 'about talking to the user directly: sending an order receipt, an alert, a report, or a '
  + 'reminder to a customer or a teammate; checking whether a notification was delivered; managing '
  + 'who can be notified and in which groups; or reading the station inbox. Carries the discipline '
  + 'that matters: one workflow per kind of notice, the trigger identifier read from mail_workflows '
  + 'rather than guessed, the difference between an accepted trigger and a delivered message, and '
  + 'the preference and quiet-hour rules that can skip a send. Skip it for sending to the user in '
  + 'this conversation, for email over the host\'s own mail facility, and for anything that is a '
  + 'one-off message with no workflow behind it.'

/** The one fixed candidate. / 唯一的固定候选。 */
const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'mail-skill',
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

/** The provider that serves the one bundled skill. / 提供那个内置技能的提供方。 */
const provider: SkillProvider = {
  name: 'mail-skill',
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      path: CANDIDATE.path,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/**
 * Register the bundled skill on the calling scope.
 *
 * 在调用作用域注册内置技能。
 *
 * @param ctx - context carrying the skill registry / 携带技能注册表的上下文
 * @returns the disposer that unregisters it / 注销它的 disposer
 */
export function registerMailSkill(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => provider)
}
