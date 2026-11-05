/**
 * 内置 `baidu-pan` 技能提供者：一条面向模型的技能，把设计方案行为层的
 * 决策纪律带进 DSH——触发判定、风险分级与确认次序、显示规则（显示路径、
 * 链接透传、不裁剪字段）与失败处理（错误码→下一步）。转存他人分享与
 * 文档正文解析不在本版本能力面内，技能里明说不绕。
 * The bundled `baidu-pan` skill provider: one model-facing skill carrying the
 * design's behavior-layer discipline into dsh — trigger judgement, the risk
 * tiers and confirmation ordering, display rules (display paths, link
 * pass-through, no field trimming), and failure handling (code → next step).
 * Third-party share saving and document text extraction are out of this
 * version's face; the skill says so instead of improvising.
 *
 * @module @veren/baidu-pan
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'

/** 技能名（kebab-case 语法）。The skill name (kebab-case grammar). */
export const SKILL_NAME = 'baidu-pan'

/** 正文 asset 的加载地址。The body asset's load URL. */
const SKILL_BODY_URL = new URL('../assets/baidu-pan.md', import.meta.url)
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)
/** 正文所在目录（渐进披露的取材根）。The directory holding the body (the progressive-disclosure resource root). */
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('../assets/', import.meta.url)) } as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** 路由文字：写明该加载与不该加载的请求，留在目录 500 字符预算内。Routing text: names the requests that should and should not load this skill, inside the catalog's 500-character budget. */
const DESCRIPTION = 'Use when the request touches the signed-in Baidu Netdisk: browse/list/search files, upload between workspace and disk, download to workspace, organize (mkdir/copy/move/rename), share links, quota or account checks. Carries the risk discipline — destructive actions need prior user confirmation, display paths and link pass-through rules. Skip it for third-party share saving, document text extraction, local-only file work, or other cloud drives.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'baidu-pan-skill',
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: 'baidu-pan-skill',
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
 * 在调用作用域注册技能提供者；返回值即注销器，随作用域卸载清理。
 * Registers the skill provider on the calling scope; the return value is the
 * disposer, cleaned up when the scope unloads.
 */
export function registerBaiduPanSkill(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => provider)
}
