#!/usr/bin/env node
// The gitea CLI: a minimal, dependency-free command line for Gitea's `/api/v1`, shaped for dsh-superagent.
// gitea CLI：面向 Gitea `/api/v1` 的最小零依赖命令行，形状为 dsh-superagent 而设。
//
// Usage / 用法:
//   gitea api <path> [--method M] [-f k=v]... [-H 'H: v']...   one API call / 一次 API 调用
//   gitea auth status                                          print the acting identity / 打印行事身份
//   gitea auth git-credential <get|store|erase>                git credential helper / git 凭据 helper
//
// Configuration / 配置: --config <path>, or $GITEA_CLI_CONFIG, or ~/.config/gitea-cli/config.json
//   {"url": "https://gitea.example.com", "token": "...", "login": "agent-account"}
// The token never travels in an environment variable: DSH strips credential-shaped variable names
// (KEY, PASSWORD, SECRET, TOKEN) from child environments, so the file is the only carrier.
// 令牌绝不走环境变量：DSH 会从子环境剥掉凭据形状的变量名（KEY、PASSWORD、SECRET、TOKEN），
// 因此文件是唯一载体。

import { loadConfig, GiteaCliError } from './config.mjs'
import { api } from './api.mjs'
import { authStatus, credential } from './credential.mjs'

/** Parses `--config`, `--method`, repeated `-f/--field` and `-H` flags out of argv. */
/** 从 argv 解析 `--config`、`--method`、可重复的 `-f/--field` 与 `-H`。 */
function parseArgv(argv) {
  const options = { method: 'GET', fields: [], headers: [] }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--config') options.config = argv[++i]
    else if (arg === '--method') options.method = (argv[++i] ?? 'GET').toUpperCase()
    else if (arg === '-f' || arg === '--field') options.fields.push(argv[++i] ?? '')
    else if (arg === '-H' || arg === '--header') options.headers.push(argv[++i] ?? '')
    else rest.push(arg)
  }
  return { options, rest }
}

async function main() {
  const { options, rest } = parseArgv(process.argv.slice(2))
  const [command, sub, ...tail] = rest
  if (command === 'api') {
    const path = sub
    if (!path) throw new GiteaCliError('gitea api needs a path, such as repos/owner/name/issues/1. / gitea api 需要路径，如 repos/owner/name/issues/1。', 2)
    process.stdout.write(await api(loadConfig(options.config), path, options))
    return
  }
  if (command === 'auth' && sub === 'status') {
    await authStatus(loadConfig(options.config))
    return
  }
  if (command === 'auth' && sub === 'git-credential') {
    await credential(loadConfig(options.config), tail[0])
    return
  }
  throw new GiteaCliError('Usage / 用法: gitea api <path> [--method M] [-f k=v]... | gitea auth status | gitea auth git-credential <get|store|erase>', 2)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(error instanceof GiteaCliError ? error.exitCode : 1)
})
