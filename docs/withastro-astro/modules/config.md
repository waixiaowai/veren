---
title: 配置解析
description: "config 把三路输入——配置文件、命令行内联配置、与运行环境——合并成一份不可变设定快照，并在任何非法取值上立即失败。它不决定构建做什么，只决定 允许做什么 ；与 cli 的分界是：cli 只把参数折成 AstroInlineConfig，config 才拥有默认值、迁移、校验与最终快照"
sidebar:
  order: 3
  label: 配置解析
draft: false
lastUpdated: 2026-11-04
---

## 3. Config

`config` 把三路输入——配置文件、命令行内联配置、与运行环境——合并成一份**不可变设定快照**，并在任何非法取值上立即失败。它不决定构建做什么，只决定"允许做什么"；与 `cli` 的分界是：`cli` 只把参数折成 `AstroInlineConfig`，`config` 才拥有默认值、迁移、校验与最终快照。

### 3.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 定位并加载配置文件（可为 `false` 关闭） | 读写业务文件、页面与内容 |
| 默认值填充、内联配置深合并、区段校验 | 启动服务器、执行构建（委托 `server`/`build`） |
| 环境变量 schema 的类型化与可见性划分 | 注入第三方集成内部逻辑（只调用其钩子） |
| 输出模式推导（`static`/`server`）与适配器装配顺序 | 路由裁定（设定中的路由参数交给 `routing` 解释） |
| 把设定编码为运行期可读的只读模块 | 生成产物文件 |

设定快照的生命周期是"一次命令一次"：`dev` 重启（配置文件变化）会重新解析，`build`/`sync`/`check` 各自解析一次。解析结果包含三部分：用户可读配置（供集成读取）、内部设定（路由表、路径、注入项）、以及**构建输出形态**（决定是否需要适配器）。

### 3.2 Capabilities

加载阶段支持 ESM/TS 配置文件、`--config` 指定路径、`--root` 改变根目录；加载失败给出 `ConfigNotFound` 或 `UnknownConfigError`（含文件路径与语法位置）。合并阶段按"默认值 → 配置文件 → 内联配置 → 集成 `updateConfig`（按注册顺序）"分层，数组型配置默认替换而非拼接。校验阶段分两层：结构校验（字段类型、枚举、互斥项）与语义校验（如 `output: 'server'` 必须配 `adapter`、`i18n.locales` 必须含 `defaultLocale`、`security.csp` 与特定高亮源冲突时告警）。环境变量区段把变量划成四象限：客户端/服务端 × 公开/机密；机密变量只允许服务端读取，客户端前缀冲突立即失败（`EnvPrefixConflictsWithSecret`）。输出形态由 `output` 与 `prerenderConflictBehavior` 共同决定；`buildOutput` 一经确定即写入设定，后续任何钩子只能读取。解析结果同时生成"设定指纹"（关键字段规范化后的哈希），供构建缓存判断是否需要全量重建。

### 3.3 Contracts

```ts
interface AstroInlineConfig {
  root?: string;                  // 绝对或相对 cwd，缺省为 cwd
  configFile?: string | false;    // false 表示不加载配置文件
  mode?: string;                  // 影响 import.meta.env.MODE
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  force?: boolean;                // 忽略构建缓存
  site?: string;                  // 绝对 URL，参与 sitemap/规范链接
  base?: string;                  // 以 '/' 开头与结尾的路径前缀，默认 '/'
  outDir?: string;
  server?: { port?: number; host?: string | boolean; open?: string | boolean };
}

interface EnvField<T> {
  context: 'client' | 'server';
  access: 'public' | 'secret';
  optional?: boolean;
  default?: T;
  validate?: (value: string) => T; // 失败必须抛出，不得静默回退
}

interface ProjectConfig {
  readonly root: URL;
  readonly srcDir: URL;
  readonly publicDir: URL;
  readonly outDir: URL;
  readonly cacheDir: URL;
  readonly site?: URL;
  readonly base: string;
  readonly trailingSlash: 'always' | 'never' | 'ignore';
  readonly output: 'static' | 'server';
  readonly adapter?: AstroAdapter;
  readonly integrations: readonly AstroIntegration[];
  readonly redirects: Readonly<Record<string, RedirectConfig>>;
  readonly security: { checkOrigin: boolean; allowedDomains: RemotePattern[]; csp?: CspConfig };
  readonly session: SessionConfig | false;
  readonly cache: { provider?: CacheProviderConfig };
  readonly routeRules: RouteRules;
  readonly i18n?: I18nConfig;
  readonly image: { endpoint: { route: string }; service: ImageServiceConfig; remotePatterns: RemotePattern[] };
  readonly env: { schema: Record<string, EnvField<unknown>>; validateSecrets: boolean };
}

interface ResolvedSettings {
  config: ProjectConfig;
  buildOutput: 'static' | 'server';   // 由 output 与默认预渲染规则推导
  routes: RouteRecord[];              // 由 routing 填充
  injected: InjectedItems;            // 集成注入的路由、脚本、中间件、工具栏应用
  fingerprint: string;                // 关键字段规范化后的哈希
}

abstract class ConfigResolver {
  abstract resolve(inline: AstroInlineConfig, command: 'dev' | 'build' | 'preview' | 'sync'): Promise<ResolvedSettings>;
  abstract reload(reason: 'file-change' | 'restart'): Promise<ResolvedSettings>;
}
```

非法配置一律抛出结构化错误，字段路径与期望值必须出现在消息中；不得以空值或默认值掩盖。`configFile: false` 时不得回退读取默认文件，避免 CI 与本地行为不一致（待确认：是否需要在日志中显式提示已禁用配置文件）。

### 3.4 Flow

下面伪代码说明一次解析如何决定输出形态与是否需要适配器，并覆盖三类失败：文件不存在、字段非法、缺适配器。

```ts
async function resolveConfig(inline: AstroInlineConfig, command: Command): Promise<ResolvedSettings> {
  const fileConfig = await loadConfigFile(inline.configFile, inline.root);
  const defaults = applyDefaults(command);
  const merged = mergeDeep(defaults, fileConfig, inline);          // 数组替换，对象深合并
  const validated = validateSchema(merged);                        // 字段类型与互斥项
  const withIntegrations = await runConfigSetup(validated);        // 集成可 updateConfig
  const finalConfig = validateSemantics(withIntegrations);         // 如 i18n、session、cache 组合
  const buildOutput = finalConfig.output === 'server' ? 'server' : 'static';
  if (buildOutput === 'server' && !finalConfig.adapter && command === 'build') {
    throw new AstroError(AstroErrorData.NoAdapterInstalled);
  }
  return {
    config: finalConfig,
    buildOutput,
    routes: [],
    injected: collectInjectedItems(withIntegrations),
    fingerprint: fingerprintOf(finalConfig),
  };
}
```

失败处理：文件存在但解析失败 → `UnknownConfigError`（含行列）；字段越界 → 同码但消息指向字段路径与允许值；`output: 'server'` 缺适配器 → `NoAdapterInstalled`（构建期失败，开发期只告警并降级为静态行为）。集成改写配置导致的二次非法值在 `validateSemantics` 重新校验，不能被第一次校验"放行"。

### 3.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-3-01 | 无配置文件 | `astro dev` | 使用默认值启动，端口 4321，`base` 为 `/`，不报错 |
| A-3-02 | 配置文件含非法字段类型 | `astro build` | 失败退出，错误指出字段路径与期望类型，退出码 1 |
| A-3-03 | `output: 'server'`、无适配器 | `astro build` | `NoAdapterInstalled`，且不产生半成品产物 |
| A-3-04 | 集成在 `astro:config:setup` 中 `updateConfig` 注入路由 | 构建 | 注入路由出现在最终路由表；集成注册顺序决定覆盖优先级 |
| A-3-05 | 客户端前缀与机密变量同名 | `astro dev` | `EnvPrefixConflictsWithSecret`，服务器不启动，提示改名 |
| A-3-06 | 修改 `site` 或 `base` | 连续两次构建 | 产物中的规范链接与资源前缀随之变化；设定指纹变化触发全量重建 |
