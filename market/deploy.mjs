/**
 * 把 market/site 发布到索引源站点 / Publish market/site to the index-source host.
 *
 * 只做两件事 / Two steps: 清掉远端旧的 icons/，再把 index.json 与 icons/ 传上去；随后用 HTTPS 自检。
 * Remove the remote icons/ directory, upload index.json and icons/, then verify over HTTPS.
 *
 * 用法 / Usage:
 *   node market/deploy.mjs            # 部署到默认主机 / deploy to the default host
 *   node market/deploy.mjs --dry-run  # 只打印将执行的命令 / print the commands only
 *   MARKET_DEPLOY_HOST=138 node market/deploy.mjs
 */
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PUBLIC_INDEX_URL, SITE_DIR } from './lib/paths.mjs'

const run = promisify(execFile)

/** 远端主机与目录 / Remote host and directory. */
const HOST = process.env.MARKET_DEPLOY_HOST ?? '138'
const REMOTE_DIR = process.env.MARKET_DEPLOY_DIR ?? '/var/www/market'
const DRY_RUN = process.argv.includes('--dry-run')

/**
 * 执行一条命令，dry-run 时只打印 / Run one command, printing it alone in dry-run mode.
 * @param {string} command - 可执行文件 / Executable.
 * @param {string[]} args - 参数 / Arguments.
 * @returns {Promise<string>} 标准输出 / Standard output.
 */
async function step(command, args) {
  const line = [command, ...args].join(' ')
  if (DRY_RUN) {
    console.log(`dry-run: ${line}`)
    return ''
  }
  console.log(`$ ${line}`)
  const { stdout } = await run(command, args, { maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * 部署并自检 / Deploy and verify.
 * @returns {Promise<void>} 自检通过后 resolve / Resolves after verification passes.
 */
async function main() {
  await access(`${SITE_DIR}/index.json`)
  await step('ssh', [HOST, `mkdir -p ${REMOTE_DIR} && rm -rf ${REMOTE_DIR}/icons`])
  await step('scp', [`${SITE_DIR}/index.json`, `${HOST}:${REMOTE_DIR}/index.json`])
  await step('scp', ['-r', `${SITE_DIR}/icons`, `${HOST}:${REMOTE_DIR}/`]).catch(error => {
    // 全部图标都内联时没有 icons/ 目录，这不是失败 / No icons/ directory when every icon is inlined; not a failure.
    if (!String(error).includes('No such file')) throw error
  })
  const status = await verify()
  if (DRY_RUN) return
  if (status !== 200) throw new Error(`${PUBLIC_INDEX_URL} 返回 ${status} / returned ${status}`)
  console.log(`deployed: ${PUBLIC_INDEX_URL} -> ${HOST}:${REMOTE_DIR} (HTTP ${status})`)
}

/**
 * 用 Node 的 fetch 自检，避免依赖平台上的 curl / 用 Node's fetch for the check, so no platform curl is needed.
 * @returns {Promise<number>} HTTP 状态码 / HTTP status code.
 */
async function verify() {
  if (DRY_RUN) return 200
  const response = await fetch(PUBLIC_INDEX_URL, { method: 'GET' })
  await response.arrayBuffer()
  return response.status
}

await main()
