// 页面级 runtime skill 的装载：renhua（人话写作技能）。skill 正文与元数据
// 仍在包内 skills/renhua/SKILL.md（人类可读、可单独维护）；本模块把它解析成
// 页面 meta 的 PageSkill 声明——挂载动作归 app-host（ctx.skills.register 挂
// 会话 agent 作用域），这里只读文件、不注册。
// The page-scope runtime skill loader: renhua (the plain-Chinese writing
// skill). The body and metadata still live in the packaged
// skills/renhua/SKILL.md (human-readable, independently maintainable); this
// module parses it into the PageSkill declaration for the page metas — the
// mounting belongs to app-host (ctx.skills.register into the session's agent
// scope); this module only reads the file, it never registers.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PageSkill } from '@veren/prompt-page'

/** 包内 skills/ 目录（打包形态：dist/skills.js 的上一级）。The packaged skills/ directory (the parent of dist/skills.js in the packed shape). */
const SKILL_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

/**
 * 解析 SKILL.md 的 frontmatter（`---` 包围的 `key: value` 行，只认 name /
 * description / whenToUse 三个键）并剥出 Markdown 正文。字段缺失或正文为空
 * 一律抛错：技能声明是页面对模型的承诺，缺字段就是 broken，fail loud。
 * Parse a SKILL.md's frontmatter (the `---`-wrapped `key: value` lines; only
 * name / description / whenToUse are recognized) and strip the Markdown body.
 * A missing field or an empty body throws: a skill declaration is a promise to
 * the model, so a missing field is broken — fail loud.
 * @param source - SKILL.md 原文。The raw SKILL.md text.
 * @returns name/description/whenToUse 与正文。The fields plus the body.
 */
export function parseSkillFile(source: string): { name: string; description: string; whenToUse?: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (match === null) throw new Error('skill file has no frontmatter block')
  const fields = new Map<string, string>()
  for (const line of match[1]?.split(/\r?\n/) ?? []) {
    const pair = /^(\w+):\s*(.+)$/.exec(line)
    if (pair !== undefined && pair !== null) fields.set(pair[1] ?? '', pair[2] ?? '')
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  const whenToUse = fields.get('whenToUse')
  const content = source.slice(match[0].length).trim()
  if (name === '' || description === '' || content === '') {
    throw new Error(`skill file "${name}" is missing name, description, or body`)
  }
  return { name, description, ...(whenToUse === undefined ? {} : { whenToUse }), content }
}

/**
 * 装载 renhua 技能为页面级 PageSkill 声明。每次调用都重新读文件：meta 在模块
 * 顶层声明一次，所以这里用惰性缓存——同一进程只读一次，测试可 reset。
 * Load the renhua skill as a page-scope PageSkill declaration. Each call
 * re-reads the file; the metas declare it once at module scope, so a lazy
 * cache keeps it to one read per process (tests may reset it).
 */
let cached: PageSkill | undefined
export function loadRenhuaSkill(): PageSkill {
  cached ??= parseSkillFile(readFileSync(`${SKILL_DIR}renhua/SKILL.md`, 'utf8'))
  return cached
}
