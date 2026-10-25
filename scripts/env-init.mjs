#!/usr/bin/env node
/**
 * Bootstrap a new DSH environment home (one home = one environment).
 * 初始化一套 DSH 环境 home（一套 home = 一套环境）。
 *
 * Creates / 创建:
 *   <home>/profiles/<profile>/   profile skeleton (empty; `dsh web` fills it on first boot)
 *   <home>/storages/             the environment's own storage domain root
 *   <home>/.credentials.yaml     read-only copy from ~/.dsh (never the reverse)
 *   <home>/profiles/<profile>/.npmrc
 *     store-dir inside THIS home (isolation rule 2: pnpm stores never cross),
 *     package-import-method=copy (no hard links to the desktop),
 *     @veren registry = https://npm.veren.top/,
 *     authToken read-only copied from ~/.dsh/profiles/desktop/.npmrc
 *
 * The script only ever READS ~/.dsh (credentials + the desktop token) — the
 * AGENTS.md iron direction. It never writes there.
 * 本脚本对 ~/.dsh 只有读取（凭据与 token 的复制源）——AGENTS.md 铁律方向；
 * 绝不写入。
 *
 * Usage / 用法:
 *   node scripts/env-init.mjs --home deepseek/.dsh-staging [--profile web] [--port 3100]
 *
 * After init it prints the first-boot and install commands; the canonical
 * environment definitions live in docs/environments.cn.md.
 * 初始化后打印首启与安装命令；环境的权威定义见 docs/environments.cn.md。
 *
 * @module @veren/scripts/env-init
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
function argOf(name) {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

const homeArg = argOf('--home')
const profile = argOf('--profile') ?? 'web'
const port = argOf('--port') ?? '3080'
if (homeArg === undefined) {
  console.error('usage: node scripts/env-init.mjs --home <relative-or-absolute-home> [--profile web] [--port 3080]')
  process.exit(1)
}
const home = resolve(homeArg)
const profileDir = join(home, 'profiles', profile)
const storagesDir = join(home, 'storages')
const dshUserHome = join(homedir(), '.dsh')
const desktopNpmrc = join(dshUserHome, 'profiles', 'desktop', '.npmrc')
const credentialsSource = join(dshUserHome, '.credentials.yaml')

// 幂等：已存在的文件一律跳过，不覆盖 / idempotent: existing files are skipped, never overwritten
const made = []
for (const dir of [profileDir, storagesDir]) {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); made.push(dir) }
}

const credentialsTarget = join(home, '.credentials.yaml')
if (!existsSync(credentialsTarget) && existsSync(credentialsSource)) {
  copyFileSync(credentialsSource, credentialsTarget)
  made.push(credentialsTarget)
}

const npmrcTarget = join(profileDir, '.npmrc')
if (!existsSync(npmrcTarget)) {
  const lines = [
    `store-dir=${home.replace(/\\/g, '/')}/.pnpm-store`,
    'package-import-method=copy',
    '@veren:registry=https://npm.veren.top/',
  ]
  if (existsSync(desktopNpmrc)) {
    const tokenLine = readFileSync(desktopNpmrc, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.includes('_authToken'))
    if (tokenLine !== undefined) lines.push(tokenLine.trim())
    else console.warn(`warn: ${desktopNpmrc} carries no authToken line; registry installs will need one`)
  } else {
    console.warn(`warn: desktop profile .npmrc not found at ${desktopNpmrc}; add //npm.veren.top/:_authToken=... by hand (read-only copy)`)
  }
  writeFileSync(npmrcTarget, lines.join('\n') + '\n')
  made.push(npmrcTarget)
}

console.log(`environment home ready: ${home}`)
for (const path of made) console.log(`  created: ${path}`)
console.log()
console.log('next steps / 后续步骤:')
console.log(`  1. first boot / 首次启动:`)
console.log(`     DSH_HOME='${home}' pnpm --dir deepseek/deepseek-harness dsh web --port ${port} --no-open`)
console.log(`  2. install pinned release-train versions / 安装精确 pin 的发布版本:`)
console.log(`     cd deepseek/deepseek-harness`)
console.log(`     DSH_HOME='${home}' node --import tsx/esm apps/cli/src/bin.ts plugin --profile ${profile} add @veren/app-host-bundle@<version> @veren/task-workbench@<version>`)
console.log(`  3. restart, then run the real-machine checklist; sign-off lives in`)
console.log(`     ${join(profileDir, 'RELEASE-NOTES.md')}`)
console.log(`  (the authoritative environment definitions: docs/environments.cn.md)`)
