---
title: 命令行域
description: 为开发者提供脚手架、模型生成、迁移与自检命令的离线工具面设计。
sidebar:
  order: 13
  label: 命令行域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 11. Command Line

命令行域是**外围域**。它为开发者提供项目脚手架、数据模型生成、数据库迁移、结构自检与辅助运维命令；**它不参与运行时请求**——CLI 进程在开发机上运行，与服务端运行时完全解耦，产出的只是配置与模型文件。

命令行域与相邻模块的分界是：**CLI 只读写开发态产物，不改变运行时语义**。它可以加载服务端的认证配置来推断模型，但它不修改 [上下文装配域](./01-context/) 的装配逻辑，也不替代 [存储域](./08-storage/) 的迁移执行——迁移最终仍由服务端配置指向的适配器完成。在 [总体方案与架构](../architecture/) 中，命令行域完全位于系统边界之外：它不参与任何一次运行时请求，只在开发机上与 [数据字典](../data/) 中的表结构保持一致。

### 11.1 Responsibility Boundary

**命令行域负责：**

- 提供 `better-auth` 命令行程序（commander），统一注册全部子命令与版本号。
- 提供 `init`：交互式脚手架，产出服务端认证配置、客户端配置、`.env`，可选产出 ORM 模型文件，并安装依赖。
- 提供 `generate`：按适配器生成数据模型文件，支持 `--adapter` / `--dialect` 在没有配置好的适配器时离线生成。
- 提供 `migrate`：以 Kysely 适配器执行数据库迁移，非 Kysely 适配器明确报错并给出替代指引。
- 提供 `check`：结构自检（含 `check schema` 子命令），以退出码区分「通过 / 不匹配 / 环境不可用」。
- 提供 `info`：输出系统与配置信息，支持 `--json` 与 `--copy`。
- 提供 `secret`：生成 32 字节随机十六进制密钥。
- 提供 `login` / `logout`：对 demo 站点做设备码登录，令牌存放在 `~/.better-auth/token.json`。
- 提供 `mcp`：把官方 MCP 服务器写进各 MCP 客户端配置。
- 提供 `upgrade`：按 changeset 的 fixed 组同步升级 better-auth 系列包。
- 提供 `create-admin`：创建初始管理员账号。
- 提供 `ai`：智能体认证（Agent Auth）的交互式配置——客户端接入或服务端脚手架。
- 提供命令共用的基础设施工具：包管理器探测、配置文件路径候选集、认证配置加载。

**命令行域不负责（明确拒绝承担的职责）：**

- 不参与运行时请求：CLI 不注册端点、不签发会话、不裁决权限。
- 不改变运行时语义：CLI 生成的配置与模型由宿主在运行时加载后才生效。
- 不实现适配器：CLI 只调用适配器暴露的 `createSchema` 或内建生成器，不自己连数据库造表（`migrate` 例外，它经 Kysely 适配器执行）。
- 不管理凭据：CLI 只生成密钥文本与 demo 令牌，不读取、不打印宿主的服务端密钥。
- 不定义状态迁移：CLI 只反映结构是否匹配，不解释状态机语义（见 [状态模型](../states/)）。

**失败语义的统一约定：**

| 情形 | 退出码 | 语义 |
|---|---|---|
| 目标达成 | 0 | 成功；或「无需变更」这类正常终态 |
| 目标未达成但可判定 | 1 | 结构不匹配、迁移被拒、用户取消写入 |
| 环境不可用 | 2 | 目录不存在、配置加载失败、适配器不支持结构校验 |

### 11.2 Capability Inventory

| 命令 | 导出符号 | 一句话职责 |
|---|---|---|
| `init` | `init` | 交互式脚手架：产出服务端配置、客户端配置、`.env`、可选 ORM 模型并安装依赖。 |
| `generate` | `generate` | 按适配器生成模型文件；`--adapter` / `--dialect` 可离线生成。 |
| `migrate` | `migrate` | Kysely 迁移；非 Kysely 适配器明确报错并指引改用 `generate` + 适配器自带迁移。 |
| `check` | `check` | 结构自检；`check schema` 子命令检查数据库结构能否承载框架写入。 |
| `info` | `info` | 输出系统与配置信息；`--json` 输出机器可读格式，`--copy` 复制到剪贴板。 |
| `secret` | `generateSecret` | 生成 32 字节随机十六进制密钥并打印 `BETTER_AUTH_SECRET=`。 |
| `login` | `login` | 对 demo 站点做设备码登录，令牌存 `~/.better-auth/token.json`。 |
| `logout` | `logout` | 吊销 demo 站点会话并删除本地令牌。 |
| `mcp` | `mcp` | 把官方 MCP 服务器写进 Cursor / Codex / Claude Code / Open Code / 手工配置。 |
| `upgrade` | `upgrade` | 按 changeset fixed 组把 better-auth 系列包同步升级到 CLI 版本。 |
| `create-admin` | `createAdmin` | 创建初始管理员账号（需已启用 admin 插件与持久化数据库）。 |
| `ai` | `ai` | 智能体认证的交互式配置：客户端接入（MCP / CLI）或服务端脚手架。 |

除上述命令外，程序还提供 `--version`（`.version(cliVersion)`）与根命令的 `--help`（`packages/cli/src/index.ts:39-41`）。

**基础设施工具：**

- `detectPackageManager`（`packages/cli/src/utils/check-package-managers.ts:24-50`）：按 **环境变量 → package.json 的 `packageManager` 字段 → 锁文件 → 配置文件 → 已安装的 CLI** 五级策略探测，全部落空时回退 `npm`。
- `possibleAuthConfigPaths`（`packages/cli/src/utils/config-paths.ts:31`）：认证配置的候选路径集——12 个基础文件名（`auth.ts`、`auth.tsx`、`auth.js`、`auth.jsx`、`auth.server.js`、`auth.server.ts`、`auth/index.ts`、`auth/index.tsx`、`auth/index.js`、`auth/index.jsx`、`auth/index.server.js`、`auth/index.server.ts`）× 9 组目录前缀（根目录、`lib/server/`、`server/auth/`、`server/`、`auth/`、`lib/`、`utils/`、`src/`、`app/`），共 108 个候选。
- `getConfig` / `getAuth`（`packages/cli/src/utils/get-config.ts:474-485`）：经 `c12` + `jiti` 加载认证配置，支持 tsconfig `paths` 别名重写、虚拟模块（Cloudflare / SvelteKit）与 `.env` / `.env.local`。
- `generateSchema`（`packages/cli/src/generators/index.ts:14-43`）：适配器自带 `createSchema` 时优先，否则按适配器 id 分派到 prisma / drizzle / kysely 生成器，未知适配器报错。

### 11.3 Contract

#### 11.3.1 Program Contract

```ts
/** 包管理器枚举 / Package manager enum */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * CLI 程序契约 / CLI program contract
 * 取证：packages/cli/src/index.ts:24-44
 */
export interface CliProgram {
	/** 程序名 / Program name */
	name: "better-auth";
	/** 程序描述 / Program description */
	description: "Better Auth CLI";
	/** 注册的子命令 / Registered subcommands */
	commands: CliCommand[];
	/** 版本号来源 / Version source */
	version: string;
	/** 顶层动作：打印帮助 / Root action: print help */
	rootAction: () => void;
}

/** 命令契约 / Command contract */
export interface CliCommand {
	/** 命令名（用户输入的部分）/ Command name as typed by the user */
	name: string;
	/** 导出的符号名 / Exported symbol name */
	exportName: string;
	/** 命令说明 / Description */
	description: string;
	/** 选项 / Options */
	options: CliOption[];
	/** 子命令 / Subcommands */
	subcommands?: CliCommand[];
}

/** 选项契约 / Option contract */
export interface CliOption {
	/** 短旗标 / Short flag */
	short?: string;
	/** 长旗标 / Long flag */
	long: string;
	/** 参数名（无值时省略）/ Argument name (omitted for boolean flags) */
	argument?: string;
	/** 说明 / Description */
	description: string;
	/** 默认值 / Default value */
	default?: string | boolean;
	/** 是否已废弃 / Whether deprecated */
	deprecated?: boolean;
}
```

#### 11.3.2 Generator Contract

```ts
/**
 * 模型生成结果契约 / Schema generation result contract
 * 取证：packages/cli/src/generators/types.ts:4-19
 */
export interface SchemaGeneratorResult {
	/** 生成的代码；为空表示无需变更 / Generated code; empty means no change */
	code?: string;
	/** 目标文件名 / Target file name */
	fileName: string;
	/** 目标已存在时是否覆盖 / Overwrite when the target exists */
	overwrite?: boolean;
	/** 目标已存在时是否追加 / Append when the target exists */
	append?: boolean;
	/** 会破坏既有数据的变更 / Changes that corrupt populated data */
	unsafeChanges?: string[];
	/** 框架从不写入、任何迁移也删不掉的列 / Columns Better Auth never writes */
	schemaProblems?: string[];
}

/**
 * 生成器契约 / Generator contract
 */
export interface SchemaGenerator {
	<Options extends BetterAuthOptions>(opts: {
		file?: string;
		adapter: DBAdapter;
		options: Options;
	}): Promise<SchemaGeneratorResult>;
}

/**
 * 生成器分派契约 / Generator dispatch contract
 * 取证：packages/cli/src/generators/index.ts:8-43
 */
export interface GenerateSchemaInput {
	/** 目标适配器 / Target adapter */
	adapter: DBAdapter;
	/** 目标文件路径 / Target file path */
	file?: string;
	/** 服务端配置（用于推导表结构）/ Server options used to derive the schema */
	options: BetterAuthOptions;
}

/** 内建生成器按适配器 id 索引 / Built-in generators indexed by adapter id */
export const adapters: {
	prisma: SchemaGenerator;
	drizzle: SchemaGenerator;
	kysely: SchemaGenerator;
};
```

#### 11.3.3 Command Option Contracts

```ts
/** generate 命令选项 / generate options */
export interface GenerateOptions {
	/** 工作目录，默认当前目录 / Working directory, defaults to cwd */
	cwd: string;
	/** 配置文件路径 / Config file path */
	config?: string;
	/** 输出路径（文件或目录）/ Output path (file or directory) */
	output?: string;
	/** 适配器类型；给出后无需已配置的适配器 / Adapter type; bypasses the configured adapter */
	adapter?: string;
	/** 数据库方言；drizzle 下 postgresql 映射为 pg / Dialect; drizzle maps postgresql to pg */
	dialect?: string;
	/** 自动确认 / Auto confirm */
	yes?: boolean;
}

/** migrate 命令选项 / migrate options */
export interface MigrateOptions {
	/** 工作目录，默认当前目录 / Working directory, defaults to cwd */
	cwd: string;
	/** 配置文件路径 / Config file path */
	config?: string;
	/** 自动确认并执行 / Auto confirm and run */
	yes?: boolean;
}

/** check 命令选项 / check options */
export interface CheckOptions {
	/** 工作目录，默认当前目录 / Working directory, defaults to cwd */
	cwd: string;
	/** 配置文件路径 / Config file path */
	config?: string;
}

/** info 命令选项 / info options */
export interface InfoOptions {
	/** 工作目录 / Working directory */
	cwd: string;
	/** 配置文件路径 / Config file path */
	config?: string;
	/** 以 JSON 输出 / Emit JSON */
	json?: boolean;
	/** 复制到剪贴板（需 pbcopy / xclip / clip）/ Copy to clipboard */
	copy?: boolean;
}

/** create-admin 命令选项 / create-admin options */
export interface CreateAdminOptions {
	/** 工作目录，默认当前目录 / Working directory, defaults to cwd */
	cwd: string;
	/** 配置文件路径 / Config file path */
	config?: string;
	/** 管理员邮箱 / Admin email */
	email?: string;
	/** 管理员口令 / Admin password */
	password?: string;
	/** 显示名，默认 "Admin" / Display name, default "Admin" */
	name: string;
	/** 角色，默认 "admin" / Role, default "admin" */
	role: string;
	/** 附加字段的 JSON 对象 / Additional fields as a JSON object */
	data?: string;
	/** 是否标记邮箱已验证，默认 true / Whether the email is verified, default true */
	emailVerified: boolean;
	/** 即使已有用户也创建 / Create even when users already exist */
	force?: boolean;
	/** 自动确认 / Auto confirm */
	yes?: boolean;
}

/** login 命令选项 / login options */
export interface LoginOptions {
	/** 目标服务地址，默认 demo 站点 / Target server URL, defaults to the demo site */
	serverUrl: string;
	/** OAuth 客户端 id，默认 "better-auth-cli" / OAuth client id, default "better-auth-cli" */
	clientId: string;
}

/** mcp 命令选项 / mcp options */
export interface McpOptions {
	/** 安装到 Cursor / Add to Cursor */
	cursor?: boolean;
	/** 安装到 Codex / Add to Codex */
	codex?: boolean;
	/** 写入 Claude Code / Write to Claude Code */
	claudeCode?: boolean;
	/** 写入 Open Code / Write to Open Code */
	openCode?: boolean;
	/** 手工配置 / Manual configuration */
	manual?: boolean;
}
```

#### 11.3.4 Configuration Loading Contract

```ts
/** 包管理器探测结果 / Package manager detection result */
export interface PackageManagerDetection {
	/** 探测到的包管理器 / Detected package manager */
	packageManager: PackageManager;
	/** 版本号（若可得）/ Version, when known */
	version?: string;
}

/** 配置加载输入 / Config loading input */
export interface ConfigInput {
	/** 工作目录 / Working directory */
	cwd: string;
	/** 显式配置文件路径 / Explicit config file path */
	configPath?: string;
	/** 本次将生成的模型文件路径（用于自引用恢复）/ Schema output path, used for self-import recovery */
	outputPath?: string;
	/** 加载失败时抛错而非退出进程 / Throw instead of exiting the process */
	shouldThrowOnError?: boolean;
}

/** 加载到的认证配置 / Loaded auth configuration */
export interface LoadedAuth {
	/** 服务端配置 / Server options */
	options?: BetterAuthOptions;
	/** 上下文Promise / Context promise */
	$context?: Promise<AuthContext>;
}
```

### 11.4 Flow

以下伪代码表达命令行域两条主链路的**契约与失败分支**，括号内为源码取证位置。

#### 11.4.1 Schema Generation

```ts
// generate 命令的完整链路
// 取证：packages/cli/src/commands/generate.ts:116-369, packages/cli/src/generators/index.ts:14-43
async function generateAction(opts: GenerateOptions): Promise<void> {
	const options = z.object({
		cwd: z.string(),
		config: z.string().optional(),
		output: z.string().optional(),
		adapter: z.string().optional(),
		dialect: z.string().optional(),
		y: z.boolean().optional(),
		yes: z.boolean().optional(),
	}).parse(opts);

	const cwd = path.resolve(options.cwd);
	// 失败分支：目录不存在 → 打印错误并 exit(1)
	if (!existsSync(cwd)) {
		console.error(`The directory "${cwd}" does not exist.`);
		process.exit(1);
	}

	// 输出路径：已存在的目录 → 追加默认文件名；否则视为文件路径
	options.output = await resolveSchemaOutputPath({ cwd, output: options.output, adapterId: adapter.id });

	// 1) 加载配置
	const config = await getConfig({ cwd, configPath: options.config, outputPath: configOutputPath });
	// 失败分支：找不到配置 → 清理生成物、打印提示、返回（不生成任何文件）
	if (!config) {
		await removeGeneratedStub();
		console.error("No configuration file found. Add a `auth.ts` file to your project or pass the path to the configuration file using the `--config` flag.");
		return;
	}
	await removeGeneratedStub();

	// 2) 确定适配器
	let adapter: DBAdapter;
	if (options.adapter) {
		// 离线模式：用 mock 适配器，只提供 id 与 provider，不触碰数据库
		adapter = createMockAdapter(options.adapter, options.dialect);
	} else {
		// 失败分支：无法从配置解析适配器 → 打印错误、清理、exit(1)
		adapter = await getAdapter(config).catch((e) => {
			console.error(e.message);
			await removeGeneratedStub();
			process.exit(1);
		});
	}

	// 3) 生成模型
	const schema = await generateSchema({ adapter, file: resolvedOutputPath ?? options.output, options: config });

	// 4) 风险告警（不阻断）
	//    schemaProblems：框架从不写入这些列，任何迁移都删不掉
	if (schema.schemaProblems?.length) { console.warn(/* 逐条列出 */); }
	//    unsafeChanges：这些变更会破坏既有数据
	if (schema.unsafeChanges?.length) { console.warn(/* 逐条列出 */); }

	// 5) 无变更 → 正常终态，exit(0)
	if (!schema.code) {
		await removeGeneratedStub();
		console.log("Your schema is already up to date.");
		process.exit(0);
	}

	// 6) 目标已存在 → 询问覆盖还是追加
	if (schema.overwrite) {
		let confirm = options.y || options.yes;
		if (!confirm) confirm = (await prompts({ type: "confirm", ... })).confirm;
		if (confirm) {
			// 失败分支：写入失败 → 抛出，由顶层捕获并 exit(1)
			if (schema.overwrite) await fs.writeFile(schemaPath, schema.code);
			else await fs.appendFile(schemaPath, schema.code);
			process.exit(0);
		}
		// 用户取消 → 清理生成物、exit(1)
		console.error("Schema generation aborted.");
		await removeGeneratedStub();
		process.exit(1);
	}

	// 7) 确认写入目标
	let confirm = options.yes;
	if (!confirm) confirm = (await prompts({ type: "confirm", ... })).confirm;
	// 失败分支：用户取消 → 清理生成物、exit(1)
	if (!confirm) {
		console.error("Schema generation aborted.");
		await removeGeneratedStub();
		process.exit(1);
	}

	// 8) 落盘：目录不存在则递归创建
	await fs.writeFile(writePath, schema.code);
	process.exit(0);
}

/**
 * 生成器分派
 * 取证：packages/cli/src/generators/index.ts:14-43
 */
async function generateSchema(opts: GenerateSchemaInput): Promise<SchemaGeneratorResult> {
	// 优先级 1：适配器自带 createSchema（如 relations-v2 版 drizzle 适配器，id 同为 "drizzle"）
	if (opts.adapter.createSchema) {
		const { code, path: fileName, overwrite } = await opts.adapter.createSchema(opts.options, opts.file);
		return { code, fileName, overwrite };
	}
	// 优先级 2：按适配器 id 分派到内建生成器
	const generator = adapters[opts.adapter.id as keyof typeof adapters] ?? null;
	if (generator) return await generator(opts);
	// 失败分支：未知适配器 → 抛错，提示维护者实现 createSchema
	throw new Error(`${opts.adapter.id} is not supported. If it is a custom adapter, please request the maintainer to implement the "createSchema" method on the adapter.`);
}
```

失败分支清单：工作目录不存在 → 提示并退出码 1；找不到配置文件 → 提示「加 `auth.ts` 或用 `--config`」并清理生成物，不产生文件；适配器解析失败 → 退出码 1；生成结果为空 → 提示「已是最新」并以退出码 0 正常结束；用户拒绝写入 → 清理生成物并以退出码 1 结束；写入路径的父目录不存在 → 递归创建；未知适配器 → 抛错，由顶层捕获为退出码 1。

#### 11.4.2 Schema Check

```ts
// check / check schema 命令的完整链路
// 取证：packages/cli/src/commands/check.ts:14-120
async function checkSchemaAction(input: CheckOptions): Promise<void> {
	const options = z.object({ cwd: z.string(), config: z.string().optional() }).parse(input);
	const cwd = path.resolve(options.cwd);

	// 1) 目录可用性
	let cwdStat: Stats;
	try {
		cwdStat = await stat(cwd);
	} catch (error) {
		// 失败分支：ENOENT → 目录不存在；其它 errno → 无法访问
		console.error(/* 目录不存在或不可访问 */);
		process.exitCode = 2; // 环境不可用
		return;
	}
	// 失败分支：路径不是目录 → exitCode 2
	if (!cwdStat.isDirectory()) {
		console.error(`The path "${cwd}" is not a directory.`);
		process.exitCode = 2;
		return;
	}

	// 2) 加载认证配置
	let auth: Awaited<ReturnType<typeof getAuth>>;
	try {
		auth = await getAuth({ cwd, configPath: options.config, shouldThrowOnError: true });
	} catch {
		// 失败分支：配置加载抛错 → exitCode 2
		console.error("Could not load the Better Auth configuration.");
		process.exitCode = 2;
		return;
	}
	// 失败分支：未找到配置 → 提示用 --config 指定 → exitCode 2
	if (!auth) {
		console.error("No Better Auth configuration found. Pass --config to select one.");
		process.exitCode = 2;
		return;
	}

	// 3) 执行结构校验
	try {
		const context = await auth.$context;
		const check = context.explicitSchemaCheck;
		// 失败分支：适配器不支持结构校验 → exitCode 2
		if (!check) {
			console.error(`Schema validation is not available for adapter "${context.adapter.id}".`);
			process.exitCode = 2;
			return;
		}
		await check();
		// 通过：打印校验来源并置 exitCode 0
		const source = check.source ? sourceLabels[check.source] : `adapter "${context.adapter.id}"`;
		console.log(`Schema check passed against ${source}.`);
		process.exitCode = 0;
	} catch (error) {
		// 失败分支一：结构不匹配（错误码 SCHEMA_MISMATCH）→ 打印详情，exitCode 1
		if (error instanceof Error && "code" in error && error.code === "SCHEMA_MISMATCH") {
			console.error(error.message);
			process.exitCode = 1;
			return;
		}
		// 失败分支二：其它异常 → 提示检查配置与数据库连接，exitCode 2
		console.error("Could not validate the schema. Check the auth configuration and database connection.");
		process.exitCode = 2;
	}
}
```

失败分支清单：目录不存在或不是目录 → 退出码 2；配置加载失败或未找到配置 → 退出码 2；适配器不支持结构校验 → 退出码 2；结构不匹配（`SCHEMA_MISMATCH`）→ 打印不匹配详情，退出码 1；其它异常（如数据库连不上）→ 退出码 2；校验通过 → 退出码 0。

#### 11.4.3 Migration

```ts
// migrate 命令的完整链路
// 取证：packages/cli/src/commands/migrate.ts:17-238
async function migrateAction(opts: MigrateOptions): Promise<void> {
	const options = z.object({ cwd: z.string(), config: z.string().optional(), y: z.boolean().optional(), yes: z.boolean().optional() }).parse(opts);
	const cwd = path.resolve(options.cwd);
	// 失败分支：目录不存在 → exit(1)
	if (!existsSync(cwd)) { console.error(`The directory "${cwd}" does not exist.`); process.exit(1); }

	// 1) 加载配置
	const config = await getConfig({ cwd, configPath: options.config });
	// 失败分支：无配置 → 打印提示并返回
	if (!config) { console.error("No configuration file found. ..."); return; }

	// 2) 取适配器
	const db = await getAdapter(config);
	// 失败分支：拿不到适配器 → 提示 migrate 仅支持内建 Kysely 适配器 → exit(1)
	if (!db) { console.error("Invalid database configuration. ..."); process.exit(1); }

	// 3) 适配器白名单
	if (db.id !== "kysely") {
		if (db.id === "prisma") {
			// 失败分支：Prisma → 指引改用 generate + Prisma 自带迁移，exit(0)
			console.error("The migrate command only works with the built-in Kysely adapter. For Prisma, run `npx auth generate` to create the schema, then use Prisma's migrate or push to apply it.");
			process.exit(0);
		}
		if (db.id === "drizzle") {
			// 失败分支：Drizzle → 同上，exit(0)
			console.error("The migrate command only works with the built-in Kysely adapter. For Drizzle, run `npx auth generate` to create the schema, then use Drizzle's migrate or push to apply it.");
			process.exit(0);
		}
		// 失败分支：其它适配器 → 不支持，exit(1)
		console.error("Migrate command isn't supported for this adapter.");
		process.exit(1);
	}

	// 4) 生成迁移计划
	let plan: Awaited<ReturnType<typeof getMigrations>>;
	try {
		plan = await getMigrations(config);
	} catch (error) {
		// 失败分支：UnsafeMigrationError → 迁移被拒，什么都没跑，exit(1)
		if (!(error instanceof UnsafeMigrationError)) throw error;
		console.error("The migration was refused, and nothing ran.");
		console.error(error.message);
		console.error(`Run npx auth@latest generate to read the statements without executing them.`);
		process.exit(1);
	}

	// 失败分支：存在框架写不进去的列 → 什么都不跑，exit(1)
	if (plan.schemaProblems.length) {
		console.error(`The database has ${plan.schemaProblems.length} columns Better Auth cannot write to. Nothing ran.`);
		process.exit(1);
	}

	// 5) 无变更 → exit(0)
	if (!plan.toBeAdded.length && !plan.toBeAddedIndexes.length && !plan.toBeCreated.length) {
		console.log("🚀 No migrations needed.");
		process.exit(0);
	}

	// 6) 打印影响面
	//    新建表 / 新增字段 / 新增索引逐条列出

	// 7) 确认
	let migrate = options.yes;
	if (!migrate) migrate = (await prompts({ type: "confirm", name: "migrate", message: "Are you sure you want to run these migrations?", initial: false })).migrate;
	// 失败分支：用户取消 → 提示已取消，exit(0)（未做任何变更）
	if (!migrate) { console.log("Migration cancelled."); process.exit(0); }

	// 8) 执行
	await plan.runMigrations();
	process.exit(0);
}
```

失败分支清单：目录不存在 → 退出码 1；无配置 → 打印提示后返回（不退出码非零，但也不执行任何迁移）；非 Kysely 适配器 → Prisma / Drizzle 给出明确指引并以退出码 0 结束，其它适配器以退出码 1 结束；迁移被判定不安全（`UnsafeMigrationError`）→ 什么都不跑并提示改用 `generate` 预览，退出码 1；存在框架写不进去的列 → 什么都不跑，退出码 1；无变更 → 提示「无需迁移」，退出码 0；用户取消 → 未做任何变更，退出码 0。

#### 11.4.4 Package Manager Detection And Config Loading

```ts
// 包管理器探测与配置加载
// 取证：packages/cli/src/utils/check-package-managers.ts:24-50, packages/cli/src/utils/get-config.ts:434-485
async function detectPackageManager(cwd: string, packageJson: PackageJson): Promise<PackageManagerDetection> {
	const monorepoRoot = await findMonorepoRoot(cwd);
	// 五级策略依次尝试，命中即返回
	for (const strategy of [envStrategy, packageJsonStrategy, lockFileStrategy, configStrategy, cliStrategy]) {
		const result = await strategy({ cwd: monorepoRoot ?? cwd, packageJson });
		if (result !== null && PACKAGE_MANAGER.includes(result.packageManager.toLowerCase() as PackageManager)) {
			return result as PackageManagerDetection;
		}
	}
	// 失败分支：全部落空 → 回退 npm
	return { packageManager: "npm" };
}

async function getLoadedConfig(input: ConfigInput): Promise<LoadedAuth | null> {
	// 显式指定路径
	if (input.configPath) {
		const resolvedPath = existsSync(input.configPath) ? input.configPath : path.join(input.cwd, input.configPath);
		const { config } = await load(resolvedPath);
		// 失败分支：拿不到 options → 提示必须 default export 或 export const auth
		if (!config?.options) return fail("Couldn't read your auth config. Make sure to default export your auth instance or to export as a variable named auth.");
		return config;
	}

	// 候选路径遍历
	for (const possiblePath of possibleAuthConfigPaths) {
		try {
			({ config } = await load(possiblePath));
		} catch (e) {
			// 失败分支一：配置里 import 了 "server-only" → 给出明确提示（CLI 无法解析）
			if (isServerOnlyError(e)) return fail(SERVER_ONLY_HINT);
			return fail("Couldn't read your auth config.", e);
		}
		// 失败分支二：该路径没有配置文件 → 继续找下一个
		if (Object.keys(config).length === 0) continue;
		if (!config.options) return fail("Couldn't read your auth config. Make sure to default export your auth instance or to export as a variable named auth.");
		return config;
	}
	// 失败分支：全部候选都找不到 → 返回 null
	return null;
}
```

失败分支清单：包管理器探测全部落空 → 回退 `npm`（安装仍可继续，但可能与项目实际不符）；显式配置路径下模块无 `options` 导出 → 提示必须 `export const auth` 或默认导出；候选路径遍历中遇到 `server-only` 导入错误 → 给出专门提示（CLI 暂时无法解析，请先移除 `server-only`）；候选路径命中但无 `options` → 同「显式配置路径」的提示；全部候选落空 → 返回 `null`，调用方按「找不到配置」处理。

### 11.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| ACC-11-01 | 项目已有 `auth.ts`，配置了 drizzle 适配器；数据库为空 | 运行 `better-auth generate` | 生成模型文件并打印成功提示；模型字段与框架实际写入的列一致；重复运行提示「schema 已是最新」且不改动文件 |
| ACC-11-02 | 项目未配置适配器 | 运行 `better-auth generate --adapter prisma --dialect postgresql` | 离线生成 `schema.prisma`，全程不连接数据库；输出路径为目录时自动追加默认文件名（prisma 为 `schema.prisma`，kysely 为带时间戳的 `.sql`，其余为 `auth-schema.ts`） |
| ACC-11-03 | 使用非 Kysely 适配器（drizzle 或 prisma） | 运行 `better-auth migrate` | 不执行任何迁移；打印「migrate 仅支持内建 Kysely 适配器，请改用 `npx auth generate` + 适配器自带迁移」的指引；退出码 0 |
| ACC-11-04 | 使用其它适配器（如 mongo），或数据库缺少框架所需列 | 分别运行 `better-auth migrate` 与 `better-auth check schema` | 前者打印「该适配器不支持 migrate」并以退出码 1 结束；后者打印结构不匹配详情并以退出码 1 结束，且**不执行任何写操作** |
| ACC-11-05 | 项目目录不存在，或配置文件无法加载 | 运行 `better-auth check schema` | 打印对应错误信息，退出码为 2（环境不可用），与「结构不匹配」的退出码 1 明确区分 |
| ACC-11-06 | 项目中已有用户记录 | 运行 `better-auth create-admin --email a@b.c --password <pwd>` | 创建管理员成功并打印用户 ID、邮箱与角色；因已存在用户而未加 `--force` 时先询问确认；未启用 admin 插件时明确报错并退出 |
| ACC-11-07 | 任意项目 | 运行 `better-auth secret` | 打印 `BETTER_AUTH_SECRET=<64 位十六进制>`（32 字节随机），两次运行结果不同 |
| ACC-11-08 | 项目中 `better-auth` 及同 fixed 组包版本低于 CLI 版本 | 运行 `better-auth upgrade` | 列出可升级的包与目标版本，确认后按探测到的包管理器安装；全部已是最新时提示「已是最新」且不做任何改动 |

### 11.6 Known Caveats

- 命令名与导出符号名不完全一致：用户输入的是 `secret`（导出符号 `generateSecret`）与 `create-admin`（导出符号 `createAdmin`）（`packages/cli/src/index.ts:5-15`、`packages/cli/src/commands/secret.ts:5`、`packages/cli/src/commands/create-admin.ts:200`）。
- `check` 命令本体与 `check schema` 子命令执行的是同一段结构校验逻辑（`packages/cli/src/commands/check.ts:101-120`）。
- `migrate` 对 Prisma / Drizzle 适配器以**退出码 0** 结束（只是指引用户改用别的路径），对其它适配器以**退出码 1** 结束——两者都表示「没有执行迁移」，但退出码不同，脚本需区分。
- `generate` 的 `--y` 已被标记为废弃，`-y` / `--yes` 为推荐写法（`packages/cli/src/commands/generate.ts:313-316`）。
- `upgrade` 的升级目标集合取自仓库 `.changeset/config.json` 的 `fixed` 组中匹配 `better-auth` 的那一组，并排除 `auth` 本身；`workspace:` 前缀的版本会被跳过，因为它们不能被 semver 比较（`packages/cli/src/commands/upgrade.ts:18-35`、`:78-93`）。
- `mcp` 命令的远端服务器地址为 `https://mcp.better-auth.com/mcp`；Cursor / Codex / Claude Code 分支通过调用外部命令写入配置，Open Code 与手工分支直接改写 `opencode.json` / `mcp.json`（`packages/cli/src/commands/mcp.ts:17`、`:146-244`）。
- `login` / `logout` 只针对 demo 站点（`https://demo.better-auth.com`），令牌落在 `~/.better-auth/token.json`（目录 0700、文件 0600），并用 `Bearer` 头吊销服务端会话（`packages/cli/src/commands/login.ts:13-14`、`:65-76`、`:113-122`）。
