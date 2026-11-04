import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, EXIT } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SCRIPTS_ROOT = path.resolve(HERE, '..');
export const SKILL_ROOT = path.resolve(SCRIPTS_ROOT, '..');
export const TEMPLATES_ROOT = path.resolve(SKILL_ROOT, 'templates');

export function resolvePaths(options, cwd = process.cwd()) {
  const designDir = resolveDesign(options.designDir, cwd);
  const workDir = path.join(designDir, '.design-doc');
  const siteDir = options.siteDir
    ? path.resolve(cwd, options.siteDir)
    : path.join(workDir, 'site');
  const outDir = options.outDir
    ? path.resolve(cwd, options.outDir)
    : path.join(workDir, 'dist');
  return {
    designDir,
    workDir,
    siteDir,
    outDir,
    contentDir: path.join(siteDir, 'src', 'content', 'docs', 'design'),
    checkDir: path.join(workDir, 'check-dist'),
  };
}

function resolveDesign(explicit, cwd) {
  const candidate = explicit
    ? path.resolve(cwd, explicit)
    : path.join(cwd, 'design');
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    return candidate;
  }
  if (!explicit && existsSync(path.join(cwd, 'index.md'))) {
    return cwd;
  }
  throw new CliError(
    `方案目录不存在 / design directory not found: ${candidate}`,
    EXIT.ENV,
  );
}

export function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
