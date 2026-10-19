# @veren/commander-tests

[English](./README.md)

veren CLI 的 `tests` 命令组，用来管理隔离的 DSH 训练场。一个训练场就是仓库 `deepseek/.dsh` 目录下的一个独立 `DSH_HOME`；密钥与模型配置从全局 `~/.dsh` 复制而来，因此插件开发永远不会写入机器级的 harness home。

## 何时使用

- 你在开发 DSH 插件，需要为每个插件准备一个可丢弃的 harness home。
- 你希望复用全局配置里的模型提供商与 API 密钥，但不共享它的 profile、会话与 pnpm store。
- 你需要一份可审计的测试节点清单，以及显式授权的清理步骤。

如果已有自己的 `DSH_HOME` 管理脚本，请跳过本包。

## 命令

```bash
pnpm cli tests create demo
pnpm cli tests list
pnpm cli tests show demo
pnpm cli tests path demo
pnpm cli tests start demo --port 3080 --no-open
pnpm cli tests remove demo --yes
```

打包后的 `veren` 可执行文件在 `PATH` 上时，同样的命令也可以写成 `veren tests ...`。

| 子命令 | 行为 |
| --- | --- |
| `create <name>` | 创建 `<root>/<name>`，复制密钥与模型配置，写隔离的 profile `.npmrc`，通过 `dsh plugin --profile web version-exemptions` 初始化 profile，最后写入 `.veren-tests.json`。 |
| `list` | 以 JSON 输出根目录下的全部目录，包括未托管目录（`managed: false`）。 |
| `show <name>` | 以 JSON 输出单个训练场摘要。 |
| `path <name>` | 只输出绝对 `DSH_HOME`，可用于 `cd "$(pnpm cli tests path demo)"`。 |
| `remove <name> --yes` | 删除托管的训练场；没有 `--yes` 时拒绝执行。未托管目录还需要 `--force`。 |
| `start <name>` | 以 `DSH_HOME=<训练场>` 运行 `dsh web`，继承 stdio。 |

## `create` 复制什么

从源 DSH home（`--from`，缺省 `~/.dsh`）复制：

- `.credentials.yaml` —— 必需；缺失时创建直接失败。
- `.env` 与 `settings.yaml` —— 存在时复制。
- `profiles/<source>/cordis.patch.yml` 中的模型项：`id` 以 `llm-` 开头的项，以及 `agent-default-model`。源 profile 的探测顺序是：显式 `--from-profile`，否则目标 profile，然后 `desktop`，最后 `web`（取第一个含模型项的 profile）。
- `profiles/<source>/.npmrc` 的 registry 与认证行；`store-dir` 与 `package-import-method` 会被替换为隔离 store 与 `copy` 安装。

目标 profile 的其它补丁项保持不变，同 id 的模型项被覆盖。源 home 永远不会被写入。

## 安全约束

- 训练场根不能与源 `DSH_HOME` 重叠；命令会在写盘前拒绝这种配置。
- 名字必须是单层路径段（字母、数字、点、下划线、连字符，长度 1–64），Windows 保留设备名会被拒绝。
- `remove` 必须显式传 `--yes`；没有 `.veren-tests.json` 的目录还需要 `--force`。
- 当前运行的 `DSH_HOME` 永远不可删除，即使带 `--force`。
- `create` 失败时只删除本次创建的目录。

## 配置

插件配置由 `@deepseek-ai/schemastery` 定义；所有字段缺省为空串，按以下规则解析。

| 字段 | 缺省值 |
| --- | --- |
| `root` | `<repo>/deepseek/.dsh`，可用 `VEREN_TESTS_ROOT` 覆盖 |
| `sourceHome` | `~/.dsh`，可用 `VEREN_TESTS_SOURCE_HOME` 覆盖 |
| `harnessRoot` | `<repo>/deepseek/deepseek-harness`，可用 `VEREN_DSH_HARNESS` 覆盖 |
| `profile` | `web` |

每个子命令都接受 `--root <dir>`；`create` 额外接受 `--from <home>`、`--profile <name>` 与 `--from-profile <name>`。

## 开发

```bash
pnpm --filter @veren/commander-tests build
pnpm --filter @veren/commander-tests test
```

```text
packages/commander/tests
├── src/
│   ├── ground.ts         # 创建/列表/详情/删除 + 路径安全
│   ├── model-config.ts   # 模型项抽取与补丁合并
│   ├── dsh.ts            # dsh 子进程 + 清洗后的环境
│   ├── commands.ts       # 子命令解析与 JSON 输出
│   └── index.ts          # 插件模块：name/inject/Config/apply
└── test/index.test.ts
```

## 注意事项与约束

- `create` 通过 DSH 源码目录初始化 profile，因此该目录必须已构建或能通过 `tsx` 运行；命令不复制 DSH 的 profile 模板。
- 子进程会剥掉 `DSH_*` 与疑似密钥的环境变量，再注入训练场自己的 `DSH_HOME`。
- 命令不安装插件。请显式执行：`DSH_HOME=<训练场> pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add <package>`。
- 训练场的 `.pnpm-store` 位于训练场目录内，删除训练场时会一并删除。
