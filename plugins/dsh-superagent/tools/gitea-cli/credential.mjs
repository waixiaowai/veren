// The git credential helper: `gitea auth git-credential get` answers git's credential protocol from the config file.
// git 凭据 helper：`gitea auth git-credential get` 从配置文件应答 git 的凭据协议。
//
// git invokes the helper configured in worker-gitconfig as `<cli> auth git-credential get`, feeding
// `protocol=https\nhost=gitea.example.com\n` on stdin and reading `username=`/`password=` lines from stdout.
// git 以 `<cli> auth git-credential get` 调用本 helper（worker-gitconfig 里配置的形状），在 stdin 传入
// `protocol=https\nhost=gitea.example.com\n`，从 stdout 读取 `username=`/`password=` 行。
//
// store/erase are no-ops: the config file is the only store, and nothing here ever writes to it.
// store/erase 是空操作：配置文件是唯一的存储，这里绝不写它。

import { GiteaCliError } from './config.mjs'

/** Reads git's stdin key=value lines into a record. */
/** 把 git 传到 stdin 的 key=value 行读成对象。 */
async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const input = {}
  for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
    if (!line) continue
    const at = line.indexOf('=')
    if (at > 0) input[line.slice(0, at)] = line.slice(at + 1)
  }
  return input
}

/** Answers `get` when the requested host matches the configuration; prints nothing (a miss) otherwise. */
/** 请求的站点与配置匹配时应答 `get`；否则不输出（视为未命中）。 */
export async function credential(config, operation) {
  if (operation !== 'get') return
  const input = await readInput()
  const host = config.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (input.host && input.host !== host) return
  process.stdout.write(`username=${config.login || input.username || 'token'}\npassword=${config.token}\n`)
}

/** `auth status`: prints the identity the CLI would act as, as JSON, for people and setup logs. */
/** `auth status`：以 JSON 打印本 CLI 将以哪个身份行事，供人与 setup 日志查看。 */
export async function authStatus(config) {
  const response = await fetch(`${config.url}/api/v1/user`, { headers: { Authorization: `token ${config.token}` } })
  if (!response.ok) throw new GiteaCliError(`gitea: cannot read the account (HTTP ${response.status}). / gitea: 读不到账号（HTTP ${response.status}）。`, 1)
  const user = await response.json()
  process.stdout.write(`${JSON.stringify({ host: config.url, login: user.login, id: user.id }, null, 2)}\n`)
}
