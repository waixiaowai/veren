#!/usr/bin/env node
/**
 * 把 @deepseek-ai/* 依赖链进本包自己的 node_modules。
 * Link the @deepseek-ai/* dependencies into this package's own node_modules.
 *
 * 为什么需要：本包不在 veren 工作区的 packages|plugins 通配里，pnpm 不会为它建
 * node_modules。而 TypeScript 与 Node 的模块解析都按“真实路径”向上查找，于是本包
 * 会解析到 `cursour/node_modules/@deepseek-ai/*`（pnpm 的提升副本），而
 * `@deepseek-ai/dsh-api-session-controller` 的声明文件解析到的是 `.pnpm` 存储里的
 * 另一份 `@deepseek-ai/cordis` —— 两份 cordis 实例，`declare module '@deepseek-ai/cordis'`
 * 的 Context 合并就会落到另一个模块上，`ctx.sessionController` 便不存在。
 *
 * Why: this package is outside the veren workspace globs, so pnpm creates no
 * node_modules for it. Node and TypeScript resolve by real path, so the package
 * would pick up the hoisted `cursour/node_modules/@deepseek-ai/*` copies while
 * `@deepseek-ai/dsh-api-session-controller`'s declarations resolve a different
 * `@deepseek-ai/cordis` inside the pnpm store. Two cordis instances mean the
 * `declare module '@deepseek-ai/cordis'` Context merge lands on the other module
 * and `ctx.sessionController` is missing.
 *
 * 本脚本把每个依赖指向 pnpm 提升层 `.pnpm/node_modules/@deepseek-ai/<name>` 的真实目标，
 * 使本包与工作区其余部分共用同一份实例。幂等，可重复执行。
 * This script points each dependency at the real target of the pnpm hoisted entry
 * `.pnpm/node_modules/@deepseek-ai/<name>`, so this package shares one set of
 * instances with the rest of the workspace. Idempotent and safe to re-run.
 *
 * 用法 / Usage: node link-deps.mjs
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = resolve(PACKAGE_DIR, '..')
const HOISTED = join(WORKSPACE_ROOT, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai')
const LINK_ROOT = join(PACKAGE_DIR, 'node_modules', '@deepseek-ai')

/** 运行期与类型期都要解析到的包 / Packages resolved at both runtime and type time. */
const PACKAGES = [
  'cordis',
  'schemastery',
  'dsh-agent',
  'dsh-session',
  'dsh-llm',
  'dsh-tools',
  'dsh-api-session-controller',
  'dsh-scope',
]

/**
 * 解析一个依赖在 pnpm 提升层里的真实目录。
 * Resolve one dependency's real directory in the pnpm hoisted layer.
 * @param name - 包名。/ The package name.
 * @returns 真实目录，缺失时 undefined。/ Its real directory, or undefined.
 */
function resolveHoisted(name) {
  const entry = join(HOISTED, name)
  // pnpm 的提升层条目本身是符号联接；联接到它的真实目标才能与工作区共用实例。
  // The hoisted entry is itself a symlink; linking to its real target is what
  // makes this package share instances with the rest of the workspace.
  if (!existsSync(entry)) return undefined
  return realpathSync(entry)
}

mkdirSync(LINK_ROOT, { recursive: true })
let linked = 0
let missing = 0
for (const name of PACKAGES) {
  const target = resolveHoisted(name)
  if (target === undefined) {
    console.error(`缺失 / missing: ${name}`)
    missing += 1
    continue
  }
  const link = join(LINK_ROOT, name)
  if (isLinkTo(link, target)) {
    console.log(`已就位 / in place: ${name}`)
    continue
  }
  if (existsSync(link) || isBrokenLink(link)) {
    console.error(`已存在但不是指向 ${target} 的联接，请手工处理 / exists but points elsewhere: ${link}`)
    missing += 1
    continue
  }
  symlinkSync(target, link, 'junction')
  console.log(`junction: ${name} -> ${target}`)
  linked += 1
}
console.log(`\n完成 / done：新建 ${linked} 个，缺失或冲突 ${missing} 个。`)
if (missing > 0) process.exitCode = 1

/**
 * 判断路径是否是指向 target 的联接。/ Whether a path is a link to target.
 * @param path - 候选联接路径。/ The candidate link path.
 * @param target - 期望目标。/ The expected target.
 * @returns 是否匹配。/ Whether it matches.
 */
function isLinkTo(path, target) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false
    return realpathSync(path).toLowerCase() === target.toLowerCase()
  } catch {
    return false
  }
}

/**
 * 判断路径是否是断掉的联接。/ Whether a path is a broken link.
 * @param path - 候选路径。/ The candidate path.
 * @returns 是否存在目录项但解析失败。/ Whether a directory entry exists but does not resolve.
 */
function isBrokenLink(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
