import { parse as parseYaml } from 'yaml';
import { diagnostic } from '../diagnostics.mjs';

const ALLOWED = new Set(['title', 'description', 'sidebar', 'draft', 'lastUpdated']);
const SIDEBAR = new Set(['order', 'label', 'hidden']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkFrontmatter(entry) {
  const errors = [];
  if (!entry.frontmatterRaw) {
    errors.push(diagnostic('DOC-FM-001', 'error', entry, 1, '缺少 frontmatter', '在文件顶部写 YAML frontmatter'));
    return { data: {}, errors };
  }
  const data = parse(entry, errors);
  if (!data) return { data: {}, errors };
  checkFields(entry, data, errors);
  return { data, errors };
}

function parse(entry, errors) {
  try {
    const value = parseYaml(entry.frontmatterRaw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(diagnostic('DOC-FM-001', 'error', entry, 1, 'frontmatter 不是对象', '使用 key: value 形式'));
      return null;
    }
    return value;
  } catch (error) {
    errors.push(diagnostic('DOC-FM-001', 'error', entry, 1, `YAML 解析失败: ${error.message}`, '检查缩进与引号'));
    return null;
  }
}

function checkFields(entry, data, errors) {
  for (const key of Object.keys(data)) {
    if (!ALLOWED.has(key)) {
      errors.push(diagnostic('DOC-FM-002', 'error', entry, 2, `未知字段: ${key}`, '删除或改用允许字段'));
    }
  }
  if (typeof data.title !== 'string' || !data.title.trim()) {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'title 必填且为非空字符串', '补 title'));
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'description 必须是字符串', '改为单行字符串'));
  }
  checkSidebar(entry, data.sidebar, errors);
  if (data.draft !== undefined && typeof data.draft !== 'boolean') {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'draft 必须是布尔值', '改为 true/false'));
  }
  checkUpdated(entry, data.lastUpdated, errors);
}

function checkSidebar(entry, sidebar, errors) {
  if (sidebar === undefined) return;
  if (!sidebar || typeof sidebar !== 'object' || Array.isArray(sidebar)) {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'sidebar 必须是对象', '使用 sidebar.order/label/hidden'));
    return;
  }
  for (const key of Object.keys(sidebar)) {
    if (!SIDEBAR.has(key)) {
      errors.push(diagnostic('DOC-FM-002', 'error', entry, 2, `sidebar 未知字段: ${key}`, '删除该字段'));
    }
  }
  if (sidebar.order !== undefined && !Number.isInteger(sidebar.order)) {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'sidebar.order 必须是整数', '改为整数'));
  }
  if (sidebar.label !== undefined && typeof sidebar.label !== 'string') {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'sidebar.label 必须是字符串', '改为字符串'));
  }
  if (sidebar.hidden !== undefined && typeof sidebar.hidden !== 'boolean') {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'sidebar.hidden 必须是布尔值', '改为 true/false'));
  }
}

function checkUpdated(entry, value, errors) {
  if (value === undefined) return;
  const quoted = /["']/.test(rawLine(entry, 'lastUpdated'));
  const validDate = value instanceof Date || (typeof value === 'string' && ISO_DATE.test(value));
  if (quoted || !validDate) {
    errors.push(diagnostic('DOC-FM-003', 'error', entry, 2, 'lastUpdated 必须是不加引号的 YYYY-MM-DD', '去掉引号'));
  }
}

function rawLine(entry, key) {
  const line = entry.frontmatterRaw.split(/\r?\n/).find((item) => item.trimStart().startsWith(`${key}:`));
  return line ?? '';
}
