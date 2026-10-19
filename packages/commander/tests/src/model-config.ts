/**
 * 模型配置补丁的读取、抽取与合并。
 *
 * Reading, extracting and merging model configuration patch entries.
 *
 * DSH 把模型提供商与默认模型写在 profile 的 cordis.patch.yml 顶层数组里
 * （如 llm-pi-ai、agent-default-model）。训练场需要把这部分配置从源
 * DSH_HOME 复制到新 profile，同时保留目标 profile 已有的其它补丁项。
 *
 * DSH stores model providers and the default model as top-level entries in a
 * profile's cordis.patch.yml (for example llm-pi-ai and agent-default-model).
 * A training ground copies those entries from the source DSH home into the new
 * profile while keeping the target profile's other patch entries.
 */

import { parse, stringify } from 'yaml';

/** 一个补丁项（顶层数组的普通对象）/ one patch entry (a plain object in the top-level array) */
export type PatchEntry = Record<string, unknown>;

/** 写回训练场补丁时的文件头 / the header written into a training-ground patch */
const PATCH_HEADER = [
  '# veren training ground: model configuration copied from the source DSH home.',
  '# DSH 训练场：从源 DSH_HOME 复制的模型配置。',
  '',
].join('\n');

/** 判断普通对象 / whether the value is a plain object */
export function isRecord(value: unknown): value is PatchEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析 JSON 或 YAML 文本为补丁项数组；空文档返回空数组。
 * Parses text into a patch-entry array; an empty document becomes an empty array.
 */
export function parsePatchEntries(text: string): PatchEntry[] {
  const parsed: unknown = parse(text);
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecord);
}

/**
 * 解析补丁文本并要求顶层是数组；目标补丁格式非法时立即失败。
 * Parses patch text and requires a top-level array; a malformed target patch
 * fails immediately instead of being silently overwritten.
 */
export function parsePatchArray(text: string): PatchEntry[] {
  const parsed: unknown = parse(text);
  if (!Array.isArray(parsed)) throw new Error('patch root must be a YAML array');
  return parsed.filter(isRecord);
}

/** 补丁项的稳定身份：优先 id，其次 name / the stable identity of an entry: id first, then name */
export function entryKey(entry: PatchEntry): string | undefined {
  if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id;
  if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name;
  return undefined;
}

/** 判断补丁项是否描述模型提供商或默认模型 / whether an entry describes a model provider or the default model */
export function isModelEntry(entry: PatchEntry): boolean {
  const id = typeof entry.id === 'string' ? entry.id : '';
  const name = typeof entry.name === 'string' ? entry.name : '';
  return id.startsWith('llm-')
    || id === 'agent-default-model'
    || name.startsWith('@deepseek-ai/dsh-llm-')
    || name === '@deepseek-ai/dsh-agent-default-model';
}

/** 从源补丁中抽取模型相关项 / extract model-related entries from a source patch */
export function extractModelEntries(entries: readonly PatchEntry[]): PatchEntry[] {
  return entries.filter(isModelEntry);
}

/**
 * 把模型项合并进目标补丁：同 id/name 覆盖，其余追加，顺序保持稳定。
 * Merges model entries into the target patch: same id/name replaces, the rest
 * appends, and the order stays stable.
 */
export function mergeModelEntries(
  target: readonly PatchEntry[],
  models: readonly PatchEntry[],
): PatchEntry[] {
  const merged = [...target];
  for (const model of models) {
    const key = entryKey(model);
    const index = key === undefined ? -1 : merged.findIndex((entry) => entryKey(entry) === key);
    if (index >= 0) merged[index] = model;
    else merged.push(model);
  }
  return merged;
}

/** 渲染补丁文本（覆盖写回，注释按生成内容重建）/ render patch text (overwritten; comments regenerated) */
export function renderPatch(entries: readonly PatchEntry[]): string {
  return `${PATCH_HEADER}${stringify(entries, { lineWidth: 0 })}`;
}
