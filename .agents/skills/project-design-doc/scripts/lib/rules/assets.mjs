import { existsSync } from 'node:fs';
import path from 'node:path';
import { diagnostic } from '../diagnostics.mjs';
import { isInside } from '../paths.mjs';

const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const REMOTE = /^(https?:)?\/\//i;

export function checkAssets(entry, designDir) {
  const errors = [];
  const images = entry.scan.links.filter((link) => link.image);
  for (const image of images) {
    checkImage(entry, image, designDir, errors);
  }
  checkMermaid(entry, images, errors);
  return errors;
}

function checkImage(entry, image, designDir, errors) {
  if (!image.alt.trim()) {
    errors.push(diagnostic('DOC-ASSET-002', 'error', entry, image.line, `图片缺少 alt: ${image.target}`, '补替代文本'));
  }
  const target = image.target.split(/[?#]/)[0];
  if (!target || REMOTE.test(target) || target.startsWith('/') || /^(file|data):/i.test(target)) {
    errors.push(diagnostic('DOC-ASSET-001', 'error', entry, image.line, `图片必须是内容目录内的相对路径: ${image.target}`, '改相对路径'));
    return;
  }
  const resolved = path.resolve(path.dirname(entry.abs), target);
  if (!isInside(resolved, designDir) || !existsSync(resolved)) {
    errors.push(diagnostic('DOC-ASSET-001', 'error', entry, image.line, `图片不存在或越界: ${image.target}`, '放到 design/assets/ 并改相对路径'));
    return;
  }
  if (!IMAGE_EXT.has(path.extname(resolved).toLowerCase())) {
    errors.push(diagnostic('DOC-ASSET-001', 'error', entry, image.line, `不支持的图片格式: ${image.target}`, '使用 svg/png/webp/avif'));
  }
}

function checkMermaid(entry, images, errors) {
  const fences = entry.scan.fences.filter((fence) => fence.lang === 'mermaid');
  for (const fence of fences) {
    if (fence.detailsDepth === 0) {
      errors.push(diagnostic('DOC-MERMAID-001', 'error', entry, fence.line, 'mermaid 围栏必须放在 <details> 里', '改为图片 + details 源码'));
    }
  }
  if (fences.length && !images.some((image) => image.target.toLowerCase().endsWith('.svg'))) {
    errors.push(diagnostic('DOC-MERMAID-001', 'error', entry, fences[0].line, '有 mermaid 源码但没有 SVG 图片', '先渲染为 SVG 再引用'));
  }
}
