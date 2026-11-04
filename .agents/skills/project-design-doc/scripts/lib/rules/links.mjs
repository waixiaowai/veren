import { diagnostic } from '../diagnostics.mjs';

const EXTERNAL = /^https:\/\//i;
const LOCAL_HTTP = /^http:\/\/localhost(?::\d+)?(?:\/|$)/i;
const CONTACT = /^(mailto|tel):/i;

export function checkLinks(entry) {
  const errors = [];
  entry.routeLinks = [];
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
  if (target.startsWith('/design/')) {
    checkRouteForm(entry, target, link.line, errors);
    entry.routeLinks.push({ target, line: link.line });
    return;
  }
  const reason = /\.md(?:#|$)/.test(target) ? '不能链接到 .md 文件' : `非法链接: ${target}`;
  errors.push(diagnostic('DOC-LINK-001', 'error', entry, link.line, reason, '改成 /design/<id>/#<锚点>'));
}

function checkRouteForm(entry, target, line, errors) {
  const [routePart] = target.split('#');
  if (routePart !== '/design/' && !routePart.endsWith('/')) {
    errors.push(diagnostic('DOC-LINK-001', 'error', entry, line, `路由缺少尾斜杠: ${target}`, '改为 /design/<id>/'));
  }
}

export function checkLinkTargets(entries) {
  const errors = [];
  const byRoute = new Map(entries.map((entry) => [entry.route, entry]));
  for (const entry of entries) {
    checkLocalFragments(entry, errors);
    for (const link of entry.routeLinks) checkRouteTarget(entry, link, byRoute, errors);
  }
  return errors;
}

function checkRouteTarget(entry, link, byRoute, errors) {
  const [routePart, fragment] = splitTarget(link.target);
  const target = byRoute.get(routePart) ?? byRoute.get(normalizeRoute(routePart));
  if (!target) {
    errors.push(diagnostic('DOC-LINK-002', 'error', entry, link.line, `目标路由不存在: ${routePart}`, '补页面或改链接'));
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

function splitTarget(target) {
  const index = target.indexOf('#');
  if (index === -1) return [target, ''];
  return [target.slice(0, index), target.slice(index + 1)];
}

function normalizeRoute(route) {
  return route.endsWith('/') ? route : `${route}/`;
}

function hasAnchor(entry, fragment) {
  return entry.anchors.some((anchor) => anchor.slug === fragment);
}
