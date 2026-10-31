/**
 * Cargo.toml [package] 段字段解析测试：零依赖解析器的边界行为。
 *
 * Cargo.toml [package] field-parsing tests: edge behavior of the
 * dependency-free parser.
 */

import { describe, expect, it } from 'vitest';
import { parseCargoPackageFields } from '../src/discovery';

describe('parseCargoPackageFields', () => {
  it('提取 [package] 段的 name 与 description / extracts name and description from [package]', () => {
    const text = ['[package]', 'name = "veren-core"', 'description = "Core Veren library."', '', '[dependencies]'].join('\n');
    expect(parseCargoPackageFields(text)).toEqual({ name: 'veren-core', description: 'Core Veren library.' });
  });

  it('容忍行尾注释与转义引号 / tolerates trailing comments and escaped quotes', () => {
    const text = '[package]\nname = "a" # trailing comment\ndescription = "say \\"hi\\" now"\n';
    expect(parseCargoPackageFields(text)).toEqual({ name: 'a', description: 'say "hi" now' });
  });

  it('支持单引号字面量串：原样保留，不处理转义 / supports single-quoted literal strings verbatim, without escape processing', () => {
    const text = "[package]\nname = 'x-literal'\ndescription = 'keep \\n as-is' # comment\n";
    expect(parseCargoPackageFields(text)).toEqual({ name: 'x-literal', description: 'keep \\n as-is' });
  });

  it('忽略 [package] 之外的同名字段 / ignores same-named fields outside [package]', () => {
    const text = '[dependencies]\nname = "wrong"\n\n[package]\nname = "right"\n';
    expect(parseCargoPackageFields(text).name).toBe('right');
  });
});
