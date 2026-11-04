import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanEnv } from './env.mjs';
import { CliError, EXIT } from './errors.mjs';
import { isInside, TEMPLATES_ROOT } from './paths.mjs';

const CONFIG_FILES = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.cjs'];

export async function ensureSite(paths, options) {
  assertSafeSite(paths);
  if (options.siteDir) {
    await assertAstroSite(paths.siteDir);
    await ensureDeps(paths.siteDir, options);
    return { siteDir: paths.siteDir, scaffolded: false };
  }
  if (!existsSync(path.join(paths.siteDir, 'package.json'))) {
    await scaffold(paths, options);
  }
  await assertAstroSite(paths.siteDir);
  await ensureDeps(paths.siteDir, options);
  return { siteDir: paths.siteDir, scaffolded: true };
}

export async function assertAstroSite(siteDir) {
  const manifestPath = path.join(siteDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new CliError(`不是 Astro 项目 / not an Astro site: ${siteDir}`, EXIT.ENV);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  if (!deps.astro) {
    throw new CliError(`package.json 缺少 astro / missing astro dependency: ${siteDir}`, EXIT.ENV);
  }
  if (!CONFIG_FILES.some((file) => existsSync(path.join(siteDir, file)))) {
    throw new CliError(`缺少 astro.config / missing astro config: ${siteDir}`, EXIT.ENV);
  }
}

export async function ensureDeps(siteDir, options) {
  if (existsSync(path.join(siteDir, 'node_modules', 'astro', 'package.json'))) {
    return;
  }
  const hint = `cd "${siteDir}" && npm install`;
  if (options.noInstall) {
    throw new CliError(`缺少站点依赖 / site dependencies missing.\n  ${hint}`, EXIT.ENV);
  }
  if (!options.install) {
    throw new CliError(
      `缺少站点依赖 / site dependencies missing.\n  ${hint}\n  或加 --install / or pass --install`,
      EXIT.ENV,
    );
  }
  await installDependencies(siteDir);
}

export async function installDependencies(siteDir) {
  const command = npmCommand();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: siteDir,
      stdio: 'inherit',
      env: cleanEnv(),
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (value) => resolve(value ?? 1));
  });
  if (code !== 0) {
    throw new CliError(`依赖安装失败 / install failed: ${siteDir}`, EXIT.ENV);
  }
}

function npmCommand() {
  const args = ['install', '--no-audit', '--no-fund'];
  if (process.platform !== 'win32') return { file: 'npm', args };
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm install --no-audit --no-fund'] };
}

async function scaffold(paths, options) {
  const name = options.minimal ? 'site-minimal' : 'site-starlight';
  const templateDir = path.join(TEMPLATES_ROOT, name);
  if (!existsSync(templateDir)) {
    throw new CliError(`模板缺失 / template missing: ${templateDir}`, EXIT.ENV);
  }
  await mkdir(path.dirname(paths.siteDir), { recursive: true });
  await cp(templateDir, paths.siteDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  });
  await writeFile(path.join(paths.workDir, '.gitignore'), '*\n', 'utf8');
}

function assertSafeSite(paths) {
  const dshHome = path.join(os.homedir(), '.dsh');
  if (isInside(paths.siteDir, dshHome)) {
    throw new CliError('拒绝写入 ~/.dsh / refuse to write inside ~/.dsh', EXIT.ENV);
  }
  if (path.resolve(paths.siteDir) === path.resolve(paths.designDir)) {
    throw new CliError('--site 不能等于 design 目录 / --site must not equal design', EXIT.ENV);
  }
}
