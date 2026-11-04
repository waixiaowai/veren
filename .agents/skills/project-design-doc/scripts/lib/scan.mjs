/** 拆分 frontmatter 与正文 / Split frontmatter and body. */
export function splitFrontmatter(text) {
  const source = text.replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!match) {
    return { frontmatterRaw: null, body: source, lineOffset: 0 };
  }
  const consumed = match[0].split('\n').length - 1;
  return {
    frontmatterRaw: match[1],
    body: source.slice(match[0].length),
    lineOffset: consumed,
  };
}

/** 扫描 ATX 标题、链接、围栏与 HTML 行 / Scan headings, links, fences and HTML lines. */
export function scanMarkdown(body, lineOffset = 0) {
  const state = {
    lines: body.split('\n'),
    lineOffset,
    fence: null,
    detailsDepth: 0,
    result: { headings: [], links: [], fences: [], braceLines: [], htmlLines: [], unclosedFence: null },
  };
  for (let index = 0; index < state.lines.length; index += 1) scanLine(state, index);
  if (state.fence) state.result.unclosedFence = state.fence;
  return state.result;
}

function scanLine(state, index) {
  const line = state.lines[index];
  const lineNo = index + state.lineOffset + 1;
  if (handleFence(state, line, lineNo)) return;
  if (state.fence) return;
  scanContent(state, line, lineNo);
}

function handleFence(state, line, lineNo) {
  const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!marker) return false;
  if (!state.fence) {
    state.fence = {
      marker: marker[1],
      lang: marker[2].trim().split(/\s+/)[0] ?? '',
      line: lineNo,
    };
    state.result.fences.push({ ...state.fence, detailsDepth: state.detailsDepth, closed: false });
  } else if (line.trim().startsWith(state.fence.marker)) {
    state.result.fences[state.result.fences.length - 1].closed = true;
    state.fence = null;
  }
  return true;
}

function scanContent(state, line, lineNo) {
  state.detailsDepth += countTag(line, '<details');
  state.detailsDepth -= countTag(line, '</details');
  if (line.includes('{#')) state.result.braceLines.push(lineNo);
  if (line.includes('<')) state.result.htmlLines.push({ line: lineNo, text: line });
  const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (heading) {
    state.result.headings.push({ depth: heading[1].length, text: heading[2].trim(), line: lineNo });
  }
  collectLinks(line, lineNo, state.result.links);
}

function countTag(line, needle) {
  return line.split(needle).length - 1;
}

function collectLinks(line, lineNo, links) {
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of line.matchAll(pattern)) {
    links.push({ image: match[1] === '!', alt: match[2], target: match[3], line: lineNo });
  }
}
