import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnostic } from './diagnostics.mjs';
import { scanMarkdown, splitFrontmatter } from './scan.mjs';
import { checkAssets } from './rules/assets.mjs';
import { checkFrontmatter } from './rules/frontmatter.mjs';
import { checkHeadings } from './rules/headings.mjs';
import { checkLinks, checkLinkTargets } from './rules/links.mjs';
import { checkSyntax } from './rules/syntax.mjs';

const SKIP = new Set(['node_modules', '.git', '.design-doc', 'dist', 'web', 'scripts', '.astro', '.cache']);

export async function validateDesign(paths) {
  const files = await walk(paths.designDir);
  const entries = [];
  const errors = [];
  for (const abs of files) {
    const result = await readEntry(abs, paths.designDir);
    entries.push(result.entry);
    errors.push(...result.errors);
  }
  errors.push(...duplicateRoutes(entries));
  errors.push(...checkLinkTargets(entries));
  errors.sort(compareDiagnostic);
  return {
    errors,
    warnings: [],
    files: entries,
    stats: { files: entries.length, errors: errors.length, warnings: 0 },
  };
}

async function readEntry(abs, designDir) {
  const raw = await readFile(abs, 'utf8');
  const { frontmatterRaw, body, lineOffset } = splitFrontmatter(raw);
  const entry = {
    abs,
    rel: toPosix(path.relative(designDir, abs)),
    raw,
    frontmatterRaw,
    body,
    lineOffset,
    scan: scanMarkdown(body, lineOffset),
    data: {},
    anchors: [],
    route: '',
  };
  entry.route = routeFor(entry.rel);
  const errors = [];
  const frontmatter = checkFrontmatter(entry);
  entry.data = frontmatter.data;
  errors.push(...frontmatter.errors);
  errors.push(...checkHeadings(entry));
  errors.push(...checkLinks(entry));
  errors.push(...checkAssets(entry, designDir));
  errors.push(...checkSyntax(entry));
  return { entry, errors };
}

function duplicateRoutes(entries) {
  const errors = [];
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.route)) {
      seen.set(entry.route, entry);
      continue;
    }
    errors.push(diagnostic('DOC-PATH-002', 'error', entry, 1, `路由重复: ${entry.route}`, '重命名文件或目录'));
  }
  return errors;
}

function routeFor(rel) {
  const id = rel.replace(/\.md$/, '');
  return id === 'index' ? '/design/' : `/design/${id}/`;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walk(full)));
    } else if (entry.name.endsWith('.md')) {
      result.push(full);
    }
  }
  return result;
}

function compareDiagnostic(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.code.localeCompare(right.code)
  );
}
