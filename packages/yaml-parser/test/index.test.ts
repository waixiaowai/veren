import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import * as YamlParser from '../src/index';
import { apply, Config, inject, name } from '../src/index';
import { createYamlParser } from '../src/parser';

/**
 * 每个用例使用独立的 cordis Context；apply / ctx.provide 返回的 disposer
 * 统一收进 disposers，并在 afterEach 中全部清理，避免服务跨用例泄漏
 * （复用同一个 Context 会报 "service already registered"）。
 *
 * Every test builds its own cordis Context. Disposers returned by apply /
 * ctx.provide are collected here and disposed in afterEach, so no service
 * leaks across cases (reusing one Context would fail with
 * "service already registered").
 */
const disposers: Array<() => unknown> = [];

afterEach(async () => {
  await Promise.allSettled(disposers.map((dispose) => dispose()));
  disposers.length = 0;
});

describe('yamlParser provider', () => {
  it('name 是带 veren 前缀的字符串令牌，inject 无依赖 / name is a veren-prefixed token and inject is empty', () => {
    // 令牌加 `veren` 前缀以避免跨包重名。
    // Tokens carry the `veren` prefix to avoid collisions between packages.
    expect(name).toBe('verenYamlParser');
    expect(inject).toEqual([]);
  });

  it('Config({}) 归一化为 yaml 文档缺省值 / Config({}) normalizes to the documented yaml defaults', () => {
    expect(Config({})).toEqual({
      intAsBigInt: false,
      keepSourceTokens: false,
      prettyErrors: true,
      strict: true,
      stringKeys: false,
      uniqueKeys: true,
    });
  });

  it('Config 覆盖部分字段时其余字段取默认值 / Config merges overrides with defaults', () => {
    expect(Config({ intAsBigInt: true, strict: false })).toEqual({
      intAsBigInt: true,
      keepSourceTokens: false,
      prettyErrors: true,
      strict: false,
      stringKeys: false,
      uniqueKeys: true,
    });
  });

  it('Config 校验失败（字段类型不合法）时抛错 / Config throws on a wrong-typed field', () => {
    expect(() => Config({ strict: 'yes' as unknown as boolean })).toThrow();
  });

  it('未知字段不报错且被透传（schemastery 约定）/ unknown fields pass through without error (the schemastery convention)', () => {
    // schemastery 的 object schema 不拒绝也不剔除未知字段，仅透传；
    // 类型不合法的字段才抛 ValidationError。
    // Schemastery's object schemas neither reject nor strip unknown fields;
    // only wrong-typed declared fields raise a ValidationError.
    expect(Config({ noSuchField: true } as never)).toMatchObject({ intAsBigInt: false, noSuchField: true });
  });

  it('apply 把解析服务提供到上下文 / apply provides the parser service to the context', () => {
    const ctx = new Context();
    disposers.push(apply(ctx, Config({})));

    const parser = ctx.get(name);
    expect(parser).toBeDefined();
    // 服务确实按令牌字符串 'verenYamlParser' 注册，字符串键也能取到同一实例。
    // The service is registered under the token string 'verenYamlParser', so
    // the plain string key resolves to the very same instance.
    expect(ctx.get('verenYamlParser')).toBe(parser);
    expect(parser!.parse).toBeTypeOf('function');
  });

  it('apply 返回 disposer，调用后取消提供 / apply returns a disposer that unregisters the service', async () => {
    const ctx = new Context();
    const disposer = apply(ctx, Config({}));
    expect(typeof disposer).toBe('function');

    // 这里手动清理，不再放进 disposers，避免 afterEach 重复 dispose。
    // Dispose manually here and keep it out of `disposers` so afterEach
    // does not dispose it a second time.
    await disposer();
    expect(ctx.get(name)).toBeUndefined();
  });

  it('经上下文消费：不传配置时 schema 填充默认值 / context consumption: the schema fills defaults when no config is given', async () => {
    const ctx = new Context();
    // 与 @veren/cli 的 createRuntime 一致：装载插件不传 config。
    // Same as @veren/cli's createRuntime: the plugin loads without a config.
    await ctx.plugin(YamlParser);

    const parser = ctx.get(name);
    expect(parser).toBeDefined();
    // 默认 intAsBigInt=false：整数解析为 number。
    // With the default intAsBigInt=false, integers parse to number.
    expect(parser!.parse('answer: 42')).toEqual({ answer: 42 });
  });

  it('经上下文消费：配置经 schema 归一化后生效 / context consumption: config goes through the schema before apply', async () => {
    const ctx = new Context();
    // fiber 异步激活：await 之后服务才可用；intAsBigInt 经 schema 透传到解析器。
    // The fiber activates asynchronously: the service is ready after the await;
    // intAsBigInt travels through the schema into the parser.
    await ctx.plugin(YamlParser, { intAsBigInt: true });
    expect(ctx.get(name)!.parse('answer: 42')).toEqual({ answer: 42n });
  });
});

describe('yamlParser service', () => {
  it('解析标量、序列与映射 / parses scalars, sequences and mappings', () => {
    const parser = createYamlParser();
    expect(parser.parse('answer: 42\npi: 3.14\nflag: true\n')).toEqual({ answer: 42, pi: 3.14, flag: true });
    expect(parser.parse('- a\n- b\n')).toEqual(['a', 'b']);
    expect(parser.parse('plain')).toBe('plain');
  });

  it('空文档解析为 null（与 .veren.yaml 空文件的回退逻辑衔接） / an empty document parses to null (feeding the .veren.yaml empty-file fallback)', () => {
    const parser = createYamlParser();
    expect(parser.parse('')).toBeNull();
    // 调用方（如 @veren/cli）用 `?? {}` 兜底 / callers (e.g. @veren/cli) fall back with `?? {}`
    expect((parser.parse('') ?? {}) as object).toEqual({});
  });

  it('intAsBigInt 选项生效 / the intAsBigInt option takes effect', () => {
    // 默认：整数解析为 number / default: integers parse to number
    expect(createYamlParser().parse('answer: 42')).toEqual({ answer: 42 });
    // 配置后：整数解析为 BigInt / configured: integers parse to BigInt
    expect(createYamlParser({ intAsBigInt: true }).parse('answer: 42')).toEqual({ answer: 42n });
  });

  it('uniqueKeys: true 时重复键报错，false 时放行 / duplicate keys error under uniqueKeys: true and pass under false', () => {
    expect(() => createYamlParser().parse('a: 1\na: 2')).toThrow();
    expect(createYamlParser({ uniqueKeys: false }).parse('a: 1\na: 2')).toEqual({ a: 2 });
  });

  it('解析失败时抛出错误 / a malformed document throws', () => {
    const parser = createYamlParser();
    expect(() => parser.parse('a: [unclosed')).toThrow();
  });
});
