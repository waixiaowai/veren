import GithubSlugger from 'github-slugger';
import { diagnostic } from '../diagnostics.mjs';

const FORBIDDEN = /[\\&/：:?!)("'【】<>]/;
const slugger = new GithubSlugger();

export function checkHeadings(entry) {
  const state = { errors: [], anchors: [], seen: new Set(), previous: null };
  slugger.reset();
  for (const heading of entry.scan.headings) checkHeading(entry, heading, state);
  entry.anchors = state.anchors;
  return state.errors;
}

function checkHeading(entry, heading, state) {
  const { depth, text, line } = heading;
  if (depth === 1) {
    state.errors.push(diagnostic('DOC-HEAD-001', 'error', entry, line, '正文不能写 H1', '标题交给 frontmatter title'));
  }
  if (state.previous === null && depth !== 2) {
    state.errors.push(diagnostic('DOC-HEAD-002', 'error', entry, line, '正文第一个标题必须是 H2', '改为 ##'));
  }
  if (state.previous !== null && depth > state.previous + 1) {
    state.errors.push(diagnostic('DOC-HEAD-002', 'error', entry, line, `标题层级跳跃: H${state.previous} → H${depth}`, '补中间层级'));
  }
  if (FORBIDDEN.test(text)) {
    state.errors.push(diagnostic('DOC-HEAD-003', 'error', entry, line, `标题含禁用字符: ${text}`, '删除标点或改写标题'));
  }
  if (state.seen.has(text)) {
    state.errors.push(diagnostic('DOC-HEAD-004', 'error', entry, line, `同文件标题重复: ${text}`, '改写标题'));
  }
  state.seen.add(text);
  state.anchors.push({ depth, text, line, slug: slugger.slug(text) });
  state.previous = depth;
}
