import { diagnostic } from '../diagnostics.mjs';

const EXTERNAL = /^https:\/\//i;
const LOCAL_HTTP = /^http:\/\/localhost(?::\d+)?(?:\/|$)/i;
const CONTACT = /^(mailto|tel):/i;
// 相对路由链接必须以 ./ 或 ../ 开头 / relative route links must start with ./ or ../
const RELATIVE = /^(?:\.\.?\/)/;
// 禁止链接 .md 文件 / linking to .md files is forbidden
const MD_SUFFIX = /\.md(?:#[^#]*)?$/;
const BARE_DOT = /^\.{1,2}$/;

export function checkLinks(entry) {
  const errors = [];
  // 相对路由链接：{ target 原文, line }；目标解析在 checkLinkTargets 阶段做
  // relative route links: resolved against the file location in checkLinkTargets
  entry.relLinks = [];
  entry.localFragments = [];
  for (const link of entry.scan.links) {
    if (!link.image) checkLink(entry, link, errors);
  }
  return errors;
}

function checkLink(entry, link, errors) {
  const target = link.target;
  if (EXTERNAL.test(target) || LOCAL_HTTP.test(target) || CONTACT.test(target)) return;
  if (/^http:\/\//i.test(target)) {
    errors.push(diagnostic('DOC-LINK-004', 'error', entry, link.line, `非 https 外链: ${target}`, '改为 https'));
    return;
  }
  if (target.startsWith('#')) {
    entry.localFragments.push({ target, line: link.line });
    return;
  }
  // 根绝对链接在子路径部署后失效，统一改为相对路由
  // root-absolute links break after subpath deployment; require relative routes
  if (target.startsWith('/')) {
    errors.push(
      diagnostic(
        'DOC-LINK-001',
        'error',
        entry,
        link.line,
        `站内链接不能用根绝对路由（部署到子路径后失效）: ${target}`,
        '改成相对路由，如 ./<id>/、../<id>/#<锚点>',
      ),
    );
    return;
  }
  if (RELATIVE.test(target)) {
    checkRelativeLink(entry, target, link.line, errors);
    return;
  }
  const reason = MD_SUFFIX.test(target) ? '不能链接到 .md 文件' : `非法链接: ${target}`;
  errors.push(diagnostic('DOC-LINK-001', 'error', entry, link.line, reason, '改成相对路由 ./<id>/ 或 ../<id>/'));
}

function checkRelativeLink(entry, target, line, errors) {
  if (MD_SUFFIX.test(target)) {
    errors.push(
      diagnostic('DOC-LINK-001', 'error', entry, line, `不能链接到 .md 文件: ${target}`, '改成不带 .md 的相对目录路由'),
    );
    return;
  }
  const [routePart] = target.split('#');
  // ./ 或 ../ 指向内容根（index），不带尾斜杠也合法
  // bare ./ or ../ points at the content root (index) and needs no trailing slash
  if (!BARE_DOT.test(routePart) && !routePart.endsWith('/')) {
    errors.push(
      diagnostic('DOC-LINK-001', 'error', entry, line, `路由缺少尾斜杠: ${target}`, '改成 ./<id>/ 或 ../<id>/'),
    );
    return;
  }
  entry.relLinks.push({ target, line });
}

export function checkLinkTargets(entries) {
  const errors = [];
  // 按相对内容根的路径（去掉 .md）建索引 / index entries by root-relative path without .md
  const byPath = new Map(entries.map((entry) => [entry.rel.replace(/\.md$/, ''), entry]));
  for (const entry of entries) {
    checkLocalFragments(entry, errors);
    for (const link of entry.relLinks) checkRelTarget(entry, link, byPath, errors);
  }
  return errors;
}

function checkRelTarget(entry, link, byPath, errors) {
  const [routePart, fragment] = splitTarget(link.target);
  const fromDir = posixDirname(entry.rel);
  const resolved = resolveRoute(fromDir, routePart);
  if (resolved === null) {
    errors.push(
      diagnostic('DOC-LINK-002', 'error', entry, link.line, `相对链接越出内容根: ${link.target}`, '修正 ../ 层级'),
    );
    return;
  }
  const target = byPath.get(resolved);
  if (!target) {
    errors.push(diagnostic('DOC-LINK-002', 'error', entry, link.line, `目标页面不存在: ${link.target}`, '补页面或改链接'));
    return;
  }
  if (fragment && !hasAnchor(target, fragment)) {
    errors.push(diagnostic('DOC-LINK-003', 'error', entry, link.line, `目标锚点不存在: ${link.target}`, '改锚点'));
  }
}

function checkLocalFragments(entry, errors) {
  for (const link of entry.localFragments) {
    const fragment = link.target.slice(1);
    if (fragment && !hasAnchor(entry, fragment)) {
      errors.push(diagnostic('DOC-LINK-003', 'error', entry, link.line, `本页锚点不存在: ${link.target}`, '改锚点'));
    }
  }
}

// 以 POSIX 语义解析相对路由到内容根内路径；越出根返回 null
// resolve a relative route to a root-relative path (POSIX); null when it escapes the root
function resolveRoute(fromDir, routePart) {
  const segments =
    routePart === './' || routePart === '../' || routePart === '.' || routePart === '..'
      ? []
      : routePart.split('/').filter((segment) => segment !== '' && segment !== '.');
  const stack = fromDir ? fromDir.split('/').filter(Boolean) : [];
  for (const segment of segments) {
    if (segment === '..') {
      if (!stack.length) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.length ? stack.join('/') : 'index';
}

function posixDirname(rel) {
  const index = rel.lastIndexOf('/');
  return index === -1 ? '' : rel.slice(0, index);
}

function splitTarget(target) {
  const index = target.indexOf('#');
  if (index === -1) return [target, ''];
  return [target.slice(0, index), target.slice(index + 1)];
}

function hasAnchor(entry, fragment) {
  return entry.anchors.some((anchor) => anchor.slug === fragment);
}
