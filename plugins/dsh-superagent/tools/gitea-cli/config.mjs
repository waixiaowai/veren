// Configuration loading for the gitea CLI: one JSON file holding the host, token, and optional login.
// gitea CLI 的配置加载：一个 JSON 文件，保存站点地址、令牌与可选的登录名。
//
// The token lives in a file, never in an environment variable: DSH strips credential-shaped variables
// (names containing KEY, PASSWORD, SECRET, or TOKEN) from child process environments, so a token passed
// as `GITEA_TOKEN` would never reach workers or setup probes.
// 令牌放在文件里，绝不放环境变量：DSH 会从子进程环境剥掉凭据形状的变量（名字含 KEY、PASSWORD、SECRET、TOKEN），
// 因此以 `GITEA_TOKEN` 传入的令牌永远到不了执行器或 setup 探针。
//
// Resolution order: `--config <path>` flag, then `GITEA_CLI_CONFIG` (no forbidden substring), then
// `${XDG_CONFIG_HOME:-~/.config}/gitea-cli/config.json`.
// 解析顺序：`--config <path>` 参数，然后 `GITEA_CLI_CONFIG`（不含被禁子串），最后默认路径。

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Reads and validates the CLI configuration; throws a user-facing message when it is missing or malformed. */
/** 读取并校验 CLI 配置；缺失或损坏时抛出面向用户的消息。 */
export function loadConfig(explicit) {
  const path = explicit || process.env.GITEA_CLI_CONFIG
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'gitea-cli', 'config.json')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new GiteaCliError(`No gitea CLI configuration at ${path}. Write {"url": "https://gitea.example.com", "token": "..."} there, or pass --config. / ${path} 没有 gitea CLI 配置。写入 {"url": "https://gitea.example.com", "token": "..."}，或用 --config 指定。`, 2)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GiteaCliError(`The gitea CLI configuration at ${path} is not valid JSON. / ${path} 的 gitea CLI 配置不是合法 JSON。`, 2)
  }
  const url = typeof parsed.url === 'string' ? parsed.url.replace(/\/+$/, '') : ''
  const token = typeof parsed.token === 'string' ? parsed.token : ''
  if (!/^https?:\/\//.test(url) || !token) {
    throw new GiteaCliError(`The gitea CLI configuration at ${path} needs a "url" (https://host) and a "token". / ${path} 的配置需要 "url"（https://host）与 "token"。`, 2)
  }
  return { path, url, token, login: typeof parsed.login === 'string' ? parsed.login : '' }
}

/** Error carrying an exit status, so the entry can exit with the code the caller expects. */
/** 带退出状态的错误，入口据此以调用方期望的码退出。 */
export class GiteaCliError extends Error {
  constructor(message, exitCode) {
    super(message)
    this.exitCode = exitCode
  }
}

/** True when the given path looks absolute on either POSIX or Windows. */
/** 判断路径在 POSIX 或 Windows 上是否为绝对路径。 */
export const isAbsolutePath = (path) => isAbsolute(path)
