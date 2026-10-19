/**
 * `pnpm cli` 兼容入口：刷新 commander profile 后，用 `dsh --profile commander`
 * 启动真正的命令树。
 *
 * The `pnpm cli` compatibility entry: refreshes the commander profile, then
 * launches the real command tree through `dsh --profile commander`.
 *
 * 这不是第二套运行时：argv 解析、命令注册与服务组合全部由 DSH Loader 和
 * profile bundle 完成；本脚本只负责选 DSH_HOME、刷新 profile、转发退出码。
 *
 * This is not a second runtime: argv parsing, command registration, and service
 * composition all happen in the DSH Loader and profile bundle. This script only
 * selects DSH_HOME, refreshes the profile, and forwards the exit code.
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCommanderProfile, PROFILE_NAME } from '../packages/commander/profile/install.mjs';

/** 仓库根目录 / the repository root */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 训练用 DSH_HOME；可用 DSH_HOME 覆盖 / the training DSH home; override with DSH_HOME */
const HOME = process.env.DSH_HOME?.trim() || join(REPO_ROOT, 'deepseek', '.dsh', 'test');

/** DSH 源码入口 / the DSH source entry */
const ENTRY = join(REPO_ROOT, 'deepseek', 'deepseek-harness', 'apps', 'cli', 'src', 'bin.ts');

/** 清洗环境：剥掉 DSH_* 与疑似密钥，再显式设置 DSH_HOME / clean the environment: strip DSH_* and secret-looking names, then set DSH_HOME */
function cleanEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^DSH_/i.test(key) || /(KEY|PASSWORD|SECRET|TOKEN)/i.test(key)) delete environment[key];
  }
  environment.DSH_HOME = HOME;
  return environment;
}

/** 启动 dsh profile 并转发退出码 / start the dsh profile and forward the exit code */
async function main() {
  await installCommanderProfile({ home: HOME, quiet: true });
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', ENTRY, '--profile', PROFILE_NAME, ...process.argv.slice(2)],
    { cwd: REPO_ROOT, env: cleanEnvironment(), stdio: 'inherit', windowsHide: true },
  );
  const code = await new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolveExit(exitCode ?? (signal === null ? 0 : 1)));
  });
  process.exitCode = code;
}

await main();
