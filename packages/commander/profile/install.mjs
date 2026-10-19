/**
 * 安装 commander profile 到指定 DSH_HOME。
 *
 * Installs the commander profile into a DSH home.
 *
 * DSH 的 profile 只能从 `$DSH_HOME/profiles/<name>` 启动；本脚本把
 * `packages/commander/profile` 的清单写到目标目录，并把 @veren 包复制到
 * profile 的 node_modules，把 Cordis/Schemastery 链接到 DSH 源码自带的
 * vendor 副本，确保插件与宿主共享同一个 Cordis 实例。
 *
 * DSH starts a profile only from `$DSH_HOME/profiles/<name>`. This script
 * writes the manifest from `packages/commander/profile`, copies the @veren
 * packages into the profile's node_modules, and links Cordis/Schemastery to
 * the DSH checkout's vendor copies so plugins and host share one instance.
 */

import { cp, lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根目录 / the repository root */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** DSH 源码目录 / the DSH source checkout */
const HARNESS_ROOT = join(REPO_ROOT, 'deepseek', 'deepseek-harness');

/** profile 名 / the profile name */
export const PROFILE_NAME = 'commander';

/** 需要复制进 profile 的 @veren 包 / the @veren packages copied into the profile */
const VEREN_PACKAGES = [
  { name: '@veren/commander-bundle', dir: 'packages/commander/bundle', bundle: true },
  { name: '@veren/commander-startup', dir: 'packages/commander/startup' },
  { name: '@veren/commander-core', dir: 'packages/commander/core' },
  { name: '@veren/commander-project', dir: 'packages/commander/project' },
  { name: '@veren/commander-discovery', dir: 'packages/commander/discovery' },
  { name: '@veren/commander-list', dir: 'packages/commander/list' },
  { name: '@veren/commander-build', dir: 'packages/commander/build' },
  { name: '@veren/commander-doc', dir: 'packages/commander/doc' },
  { name: '@veren/commander-help', dir: 'packages/commander/help' },
  { name: '@veren/commander-tests', dir: 'packages/commander/tests' },
  { name: '@veren/core', dir: 'packages/core' },
  { name: '@veren/yaml-parser', dir: 'packages/yaml-parser' },
];

/** 需要与宿主共享单实例的运行时包 / runtime packages shared with the host as one instance */
const RUNTIME_LINKS = [
  { name: '@deepseek-ai/cordis', target: join(HARNESS_ROOT, 'vendor', 'cordis') },
  { name: '@deepseek-ai/schemastery', target: join(HARNESS_ROOT, 'vendor', 'schemastery') },
  { name: 'yaml', target: join(REPO_ROOT, 'node_modules', 'yaml') },
];

/**
 * 安装或刷新 commander profile。
 * Installs or refreshes the commander profile.
 * @param {object} [options] - 安装选项 / installation options.
 * @param {string} [options.home] - DSH_HOME；缺省取 DSH_HOME 或 <repo>/deepseek/.dsh/test.
 * @param {boolean} [options.quiet] - 不输出安装摘要 / suppress the summary.
 * @returns {Promise<{home: string, profileDir: string, copied: string[]}>} 安装结果 / the result.
 */
export async function installCommanderProfile(options = {}) {
  const home = resolve(options.home?.trim() || process.env.DSH_HOME?.trim() || join(REPO_ROOT, 'deepseek', '.dsh', 'test'));
  const profileDir = join(home, 'profiles', PROFILE_NAME);
  await mkdir(join(profileDir, 'node_modules'), { recursive: true });
  await writeProfileFiles(profileDir);
  const copied = await copyVerenPackages(profileDir);
  await linkRuntimePackages(profileDir);
  if (!options.quiet) {
    process.stdout.write(`commander profile 已安装 / installed at ${profileDir}\n`);
    process.stdout.write(`启动 / run: dsh --profile ${PROFILE_NAME} <command>\n`);
  }
  return { home, profileDir, copied };
}

/** 写 profile 的清单、根配置与用户 patch（已有用户 patch 不覆盖）/ write the manifest, root config and user patch (never overwrite a user patch) */
async function writeProfileFiles(profileDir) {
  const manifestPath = join(profileDir, 'package.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : { name: 'dsh-profile-commander', private: true, dependencies: {} };
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : [];
  for (const bundle of ['@deepseek-ai/dsh-base', '@veren/commander-bundle']) {
    if (!bundles.includes(bundle)) bundles.push(bundle);
  }
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  for (const file of ['cordis.yml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
    const target = join(profileDir, file);
    if (!existsSync(target)) await cp(join(REPO_ROOT, 'packages', 'commander', 'profile', file), target);
  }
}

/** 复制 @veren 包（package.json + dist；bundle 额外复制 patch）/ copy @veren packages (package.json + dist; bundles also copy the patch) */
async function copyVerenPackages(profileDir) {
  const copied = [];
  for (const item of VEREN_PACKAGES) {
    const source = join(REPO_ROOT, item.dir);
    const target = join(profileDir, 'node_modules', item.name);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await cp(join(source, 'package.json'), join(target, 'package.json'));
    if (item.bundle === true) {
      await cp(join(source, 'cordis.patch.yml'), join(target, 'cordis.patch.yml'));
    } else {
      const dist = join(source, 'dist');
      if (!existsSync(dist)) {
        throw new Error(`缺少构建产物 / missing build output: ${dist}（先运行 / run pnpm build）`);
      }
      await cp(dist, join(target, 'dist'), { recursive: true });
    }
    copied.push(item.name);
  }
  return copied;
}

/** 链接宿主运行时，避免第二份 Cordis/Schemastery / link host runtime packages to avoid a second Cordis/Schemastery */
async function linkRuntimePackages(profileDir) {
  for (const item of RUNTIME_LINKS) {
    if (!existsSync(item.target)) {
      throw new Error(`缺少宿主运行时包 / missing host runtime package: ${item.target}`);
    }
    const link = join(profileDir, 'node_modules', item.name);
    await mkdir(dirname(link), { recursive: true });
    await replaceLink(item.target, link);
  }
}

/** 只替换符号链接，拒绝删除真实目录 / replace only symlinks; refuse to delete a real directory */
async function replaceLink(target, link) {
  try {
    const info = await lstat(link);
    if (!info.isSymbolicLink()) {
      throw new Error(`拒绝覆盖真实目录 / refusing to replace a real directory: ${link}`);
    }
    await unlink(link);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/** 解析 --home / parse --home */
function homeArgument(argv) {
  const index = argv.indexOf('--home');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error('--home requires a directory');
  return value;
}

/** 直接执行时运行 / run when executed directly */
async function main() {
  await installCommanderProfile({ home: homeArgument(process.argv.slice(2)) });
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
