---
title: 编辑器与脚手架
description: "一句话职责边界：Tooling 把项目投影成编辑器与命令行的可用形态——语言服务器拥有诊断/补全/悬停等只读投影，脚手架拥有 项目创建那一刻 的磁盘写入权；两者都不拥有自绘页面（editor 端只计 S-E01 诊断列表、S-E02 命令面板、S-E03 状态栏三个表面），也不拥有路由、构建与运行时"
sidebar:
  order: 16
  label: 编辑器与脚手架
draft: false
lastUpdated: 2026-11-04
---

## 16. Tooling

一句话职责边界：Tooling 把项目投影成**编辑器与命令行的可用形态**——语言服务器拥有诊断/补全/悬停等只读投影，脚手架拥有"项目创建那一刻"的磁盘写入权；两者都不拥有自绘页面（`editor` 端只计 `S-E01` 诊断列表、`S-E02` 命令面板、`S-E03` 状态栏三个表面），也不拥有路由、构建与运行时。

### 16.1 Duties

编辑器侧是**投影层，不是执行层**：它读源码、读 `astro sync` 生成的类型、跑用户自己的 TypeScript 配置，然后把结果以 LSP 协议交给编辑器渲染——诊断是只读投影，格式化与重命名以 LSP 编辑（`WorkspaceEdit`）交回编辑器落盘；它不注入任何 Astro 自有 UI，也不执行用户页面。

| 关注点 | 拥有者 | 决策者 | 交接点 |
| --- | --- | --- | --- |
| 诊断内容与范围 | `@astrojs/language-server`（Volar 架构，`astro2tsx` 生成虚拟 TSX） | 编辑器渲染成 `S-E01` | `provideDiagnostics` |
| 补全 / 悬停 / 代码操作 / 重命名 | 语言服务器的 TypeScript 与 YAML 插件 | 编辑器触发时机 | `provideCompletionItems` 等 |
| 类型真源 | `astro sync` + 集成 `injectTypes`，见[集成协议](/design/modules/integrations/#132-capabilities) | 核心 | `.astro/types.d.ts` 等生成文件 |
| 类型检查报告 | `astro check`（依赖 `@astrojs/check` 与 `typescript`） | 终端 / CI | 退出码与诊断列表 |
| 项目骨架 | `create-astro` | 模板仓库（GitHub）+ CLI 参数 | 首次写盘 |
| 版本迁移 | `@astrojs/upgrade` | 包管理器 + 用户确认 | 重写依赖版本 |
| 诊断信息收集 | `astro info` | 终端（`P-T06`） | 版本 / 适配器 / 集成清单 |
| 格式化 | `@astrojs/language-server`（`volar-service-prettier`） | 项目内的 Prettier 配置 | 需项目装 `prettier`（≥3）与 `prettier-plugin-astro`，否则弹一次提示且不可用 |

### 16.2 Capabilities

七件工具、三条互不重叠的职责：**读**（语言服务器、TS 插件、`astro info`）、**写**（`create-astro`、`@astrojs/upgrade`）、**生成与检查**（`astro sync`、`astro check`）。

| 工具 | 包 | 形态 | 能力 | 明确不做 |
| --- | --- | --- | --- | --- |
| 语言服务器 | `@astrojs/language-server` | LSP（stdio / node） | 诊断、补全、悬停、代码操作、文件重命名编辑、格式化（转发 Prettier）；内嵌 HTML/CSS/Emmet/YAML/TS 服务 | 不渲染页面、不执行项目代码 |
| TS 插件 | `@astrojs/ts-plugin` | tsserver plugin | 在 `.ts` 中导入 `.astro` 时给出类型与智能提示 | 不替代 tsserver、不做诊断聚合 |
| VS Code 扩展 | `astro-vscode` | 编辑器宿主 | 启动语言服务器、暴露命令面板与状态栏 | 不自绘页面、不内置语言能力 |
| 脚手架 | `create-astro` | CLI | 拉模板、装依赖、初始化 git、可选生成 AI 代理文件 | 不管后续 dev/build |
| 升级器 | `@astrojs/upgrade` | CLI | 探测包管理器、比对版本、按 major 给 changelog 提示 | 不改写用户代码 |
| 类型同步 | `astro sync` | CLI | 生成所有 Astro 模块的 TS 类型；`--force` 清内容层缓存 | 不做类型检查 |
| 类型检查 | `astro check` | CLI | 先 `sync` 再跑诊断并输出报告（`--no-sync` 可跳过） | 不支持 TypeScript 7.0（源码明确报错） |

| `create-astro` 参数 | 作用 | 非交互语义 |
| --- | --- | --- |
| `[dir]` | 目标目录（位置参数） | 非空时交互模式要求重填；`--yes` 下改用自动生成的新名字另建目录，不写入原目录 |
| `--template <name>` / `--ref <ref>` | 指定模板与分支 | 模板来自 GitHub，缺省用官方示例 |
| `--install` / `--no-install` | 是否安装依赖 | `--add` 与 `--no-install` 互斥，冲突即报错退出 |
| `--git` / `--no-git` | 是否初始化仓库 | 在文件写入步骤之后执行 |
| `--add <integrations...>` | 追加集成 | 依赖安装为前提 |
| `--yes` / `-y`、`--no` / `-n` | 全部接受 / 全部拒绝默认值 | 非交互执行的主开关 |
| `--dry-run` | 走流程不落盘 | 用于校验参数与模板可达性 |
| `--no-ai`、`--skip-houston`、`--fancy` | 跳过 AI 文件、跳过动画、Windows 全 Unicode | 仅影响输出与附带文件 |

| `astro info` 字段 | 取值来源 |
| --- | --- |
| `Astro` / `Vite` / `Node` | 运行时版本，Vite 由包管理器解析后插入第二行 |
| `System` / `Package Manager` | 操作系统显示名、当前包管理器 |
| `Output` / `Adapter` / `Integrations` | 解析后的配置；适配器与集成都带版本，空则显示 `none` |

### 16.3 Contracts

```ts
interface DiagnosticDescriptor {
  code: string;  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  file: string;  range: Range;                  // 已映射回 .astro 原文位置
  source: 'ts' | 'astro' | 'css' | 'yaml';
}
interface LanguageServerProjection {          // 只读投影，无写回 Astro
  diagnostics(uri: string): Promise<DiagnosticDescriptor[]>;
  completions(uri: string, position: Position): Promise<CompletionItem[]>;
  hover(uri: string, position: Position): Promise<Hover | null>;
  codeActions(uri: string, range: Range, context: CodeActionContext): Promise<CodeAction[]>;
  renameFile(oldUri: string, newUri: string): Promise<WorkspaceEdit | null>;
}
interface ScaffoldOptions {
  dir: string; template?: string; ref?: string;
  install: boolean; git: boolean; add: string[];
  yes: boolean; no: boolean; dryRun: boolean; ai: boolean;
}
interface UpgradePlan {
  packages: PackageInfo[];                    // currentVersion / targetVersion / isMajor / changelogURL
  packageManager: string; target: string; dryRun: boolean;
}
interface DebugInfoRow { label: string; value: string | string[] }
```

语言服务器不定义新的错误码：诊断沿用 TypeScript 与各插件的原始码；CLI 侧的兜底码 `UnknownCLIError` 在源码中只见定义、未见抛出点，实际使用场景**待确认**。

### 16.4 Flow

**用途：一次"打开 `.astro` 文件"如何变成编辑器里的一行诊断**——映射是双向的，写回位置必须落回原文。

```ts
async function onDocumentDiagnostics(uri: string, doc: TextDocument): Promise<Diagnostic[]> {
  const tsx = astro2tsx(doc.getText());                 // 生成虚拟 TSX + 位置映射表
  const raw = await typescriptPlugin.provideDiagnostics(doc, token);   // 各插件按能力聚合
  return raw.map((d) => mapToOriginal(d, tsx.mappings)); // 失败分支：映射缺失 → 丢弃该条并记 verbose 日志
  // 前置失败：项目未 sync / 无 tsconfig → 返回空诊断，不报错（避免误伤）
}
```

**用途：脚手架的非交互路径**，参数齐全时不发任何提示，失败点全部前置到写盘之前。

```ts
async function scaffold(opts: ScaffoldOptions) {
  if (opts.add.length > 0 && !opts.install) throw new Error('--add 需要安装依赖');   // 参数冲突，退出
  const dir = await verifyDirectory(opts.dir);          // 已存在且非空 → 拒绝，不覆盖
  const tpl = await fetchTemplate(opts.template, opts.ref);   // 取不到（网络/模板不存在）→ 失败退出
  if (opts.dryRun) return;                              // 走完校验但不动磁盘
  await writeFiles(dir, tpl);                           // 顺序固定：写文件 → 装依赖 → 初始化 git
  if (opts.install) await installDependencies(dir, opts.add);
  if (opts.git) await initGit(dir);
}
```

**用途：`astro check` 的编排**——它是"先补类型、再跑诊断"的两段式，且对不支持的 TypeScript 版本提前失败。

```ts
async function runCheck(flags: Flags): Promise<number> {
  const tsVersion = await getPackageVersion('typescript', flags.root);
  if (tsVersion && major(tsVersion) >= 7) { printTs7Unsupported(); return 1; }   // 明确失败，不静默降级
  const [checker, ts] = await Promise.all([getPackage('@astrojs/check'), getPackage('typescript')]);
  if (!checker || !ts) { printMissingDeps(); return 1; }        // 提示手动安装两个包
  if (!flags.noSync) await sync(flagsToAstroInlineConfig(flags));  // 保证类型是最新的
  return checker(parseArgsAsCheckConfig(process.argv));            // 退出码即诊断结果
}
```

### 16.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-16-01 | 项目已 `astro sync`，`.astro` 文件 frontmatter 引用不存在的变量 | 在 VS Code 打开该文件 | `S-E01` 诊断列表出现该错误，位置落在 `.astro` 原文对应行而非虚拟 TSX |
| A-16-02 | 未安装 `@astrojs/check` 或 `typescript` | `astro check` | 打印需手动安装两个包的错误，退出码非 0，不执行检查 |
| A-16-03 | 项目安装了 TypeScript 7.0 | `astro check` | 明确提示当前不支持 TS 7.0（并指出 `@astrojs/ts-content-mapper` 实验路径），不启动检查 |
| A-16-04 | 空目录 | `create-astro my-app --template minimal --yes --no-install` | 模板文件完整落盘（含 `src/` 与配置），无依赖目录，全程无交互提示 |
| A-16-05 | 目录已存在且含文件 | `create-astro existing-dir --yes` | 不写入原目录，改为在自动生成的新目录下创建项目，原文件未被修改 |
| A-16-06 | `--add react --no-install` 组合 | 执行 `create-astro` | 立即报错退出（`--add` 依赖安装），不写入任何文件 |
| A-16-07 | 离线，或 `--template` 指向不存在的模板 | 执行 `create-astro` | verify 阶段即失败退出（提示连不上网 / 模板不存在），不产生任何目录 |
| A-16-08 | 任意可运行项目 | `astro info` | 依次输出 Astro/Vite/Node/System/Package Manager/Output/Adapter/Integrations，适配器与集成带版本号 |
| A-16-09 | 项目未安装 `prettier` 或 `prettier-plugin-astro` | 在 `.astro` 文件中执行"格式化文档" | 语言服务器给出一条"无法加载 prettier / prettier-plugin-astro，格式化不可用"的提示，文档内容不变 |
| A-16-10 | 项目已装 `prettier`（≥3）与 `prettier-plugin-astro` | 对同一文件执行"格式化文档" | 文档按项目 Prettier 配置格式化，frontmatter 与模板同时生效 |
