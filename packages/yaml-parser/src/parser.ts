/**
 * YAML 解析服务：把 YAML 文本解析为普通 JS 值。
 *
 * YAML parser service: turns YAML text into plain JavaScript values.
 *
 * 服务本身不感知 Cordis：它只是一个可替换的纯解析器，
 * 由 ./index.ts 的 Provider 装配进上下文。
 *
 * The service itself is Cordis-agnostic: it is a swappable pure parser,
 * wired into the context by the provider in ./index.ts.
 */

import { parse as parseYamlDocument, type ParseOptions } from 'yaml';
import type { YamlParser } from './tokens.js';

/**
 * 创建基于 `yaml` 包的解析服务；options 作为每次 parse 的默认选项。
 * Creates the `yaml`-backed parser service; options become the defaults of
 * every parse call.
 */
export function createYamlParser(options: ParseOptions = {}): YamlParser {
  return {
    parse<T = unknown>(text: string): T {
      return parseYamlDocument(text, options) as T;
    },
  };
}
