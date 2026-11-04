import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanEnv } from './env.mjs';
import { CliError, EXIT } from './errors.mjs';

const ASTRO_BIN = ['node_modules', 'astro', 'bin', 'astro.mjs'];

export function spawnAstro(siteDir, args, stdio = 'inherit') {
  const bin = path.join(siteDir, ...ASTRO_BIN);
  if (!existsSync(bin)) {
    throw new CliError(`找不到 astro / astro not found: ${bin}`, EXIT.ENV);
  }
  return spawn(process.execPath, [bin, ...args], {
    cwd: siteDir,
    stdio,
    env: cleanEnv(),
  });
}

export async function runAstro(siteDir, args) {
  const child = spawnAstro(siteDir, args);
  const code = await waitForExit(child);
  if (code !== 0) {
    throw new CliError(`astro ${args[0]} 失败 / failed with exit ${code}`, EXIT.ASTRO);
  }
}

export async function runBuild(siteDir, outDir) {
  await runAstro(siteDir, ['build', '--outDir', outDir]);
}

export async function runCheck(siteDir) {
  if (!hasAstroCheck(siteDir)) return { skipped: true };
  await runAstro(siteDir, ['check']);
  return { skipped: false };
}

export function startDev(siteDir, { port, host }) {
  const args = ['dev', '--port', String(port)];
  if (host) args.push('--host');
  return spawnAstro(siteDir, args);
}

export function hasAstroCheck(siteDir) {
  return existsSync(path.join(siteDir, 'node_modules', '@astrojs', 'check', 'package.json'));
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
