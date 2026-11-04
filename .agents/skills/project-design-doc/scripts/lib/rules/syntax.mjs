import { diagnostic } from '../diagnostics.mjs';

const FORBIDDEN_TAG = /<(script|style|iframe|form|img|h[1-6])\b/i;
const HANDLER = /\son[a-z]+\s*=/i;
const COMPONENT = /<[A-Z][A-Za-z0-9]*\b/;

export function checkSyntax(entry) {
  const errors = [];
  checkBraces(entry, errors);
  for (const item of entry.scan.htmlLines) checkHtmlLine(entry, item, errors);
  checkFences(entry, errors);
  checkEncoding(entry, errors);
  return errors;
}

function checkBraces(entry, errors) {
  for (const line of entry.scan.braceLines) {
    errors.push(diagnostic('DOC-HEAD-003', 'error', entry, line, '禁止 {#id} 自定义锚点', '删除，改用 github-slugger 自动锚点'));
  }
}

function checkFences(entry, errors) {
  for (const fence of entry.scan.fences) {
    if (!fence.lang) {
      errors.push(diagnostic('DOC-CODE-001', 'error', entry, fence.line, '代码围栏缺少语言', '补 ts/tsx/text'));
    }
  }
  if (entry.scan.unclosedFence) {
    errors.push(diagnostic('DOC-CODE-001', 'error', entry, entry.scan.unclosedFence.line, '代码围栏未闭合', '补结束围栏'));
  }
}

function checkEncoding(entry, errors) {
  if (entry.raw.startsWith('\uFEFF')) {
    errors.push(diagnostic('DOC-ENC-001', 'error', entry, 1, '文件含 BOM', '改为 UTF-8 无 BOM'));
  }
  if (entry.raw.includes('\r\n')) {
    errors.push(diagnostic('DOC-ENC-001', 'error', entry, 1, '文件使用 CRLF', '改为 LF'));
  }
}

function checkHtmlLine(entry, item, errors) {
  const text = item.text;
  if (
    FORBIDDEN_TAG.test(text) ||
    HANDLER.test(text) ||
    /javascript:/i.test(text) ||
    /<!--/.test(text) ||
    COMPONENT.test(text)
  ) {
    errors.push(diagnostic('DOC-HTML-001', 'error', entry, item.line, '包含禁用 HTML/组件', '改用白名单标签或引用块'));
  }
}
