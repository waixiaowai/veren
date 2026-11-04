# 设计辅助脚本

Astro 编排与内容校验，不实现 Markdown 渲染器。渲染、路由、目录与搜索全部交给 Astro/Starlight。

## 首次安装

```bash
node .agents/skills/project-design-doc/scripts/cli.mjs setup
```

安装 `yaml` 与 `github-slugger` 到本目录的 `node_modules/`。站点依赖在首次 `build`/`dev` 时按需安装（`--install`）。

## 命令

```bash
# 校验内容（不构建）
node scripts/cli.mjs check design

# 校验 + 构建
node scripts/cli.mjs build design

# 本地预览（astro dev）
node scripts/cli.mjs dev design --port 4321
```

默认值：

| 项 | 默认 |
| --- | --- |
| 方案目录 | `./design`；不存在且 cwd 有 `index.md` 时用 `.` |
| 生成站点 | `<design>/.design-doc/site` |
| 构建输出 | `<design>/.design-doc/dist` |
| 模板 | `templates/site-starlight`；`--minimal` 用最小集合 |
| 预览地址 | `http://localhost:4321/design/` |

## 选项

| 选项 | 说明 |
| --- | --- |
| `--design <dir>` | 方案目录 |
| `--site <dir>` | 已有 Astro 项目；不传则用生成站点 |
| `--minimal` | 用 `templates/site-minimal` |
| `--out <dir>` | 构建输出目录 |
| `--port <n>` / `--host` | `dev` 端口 / 监听所有地址 |
| `--install` | 允许安装缺失的站点依赖 |
| `--no-install` | 禁止任何安装 |
| `--skip-check` | `build` 跳过内容校验 |
| `--content-only` | `check` 只跑内容规则 |
| `--build` | `check` 额外跑一次 Astro 构建 |
| `--json` / `--strict` | JSON 报告 / warning 视为 error；`--json` 只跑内容规则 |

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 内容或 `astro check` 错误 |
| 2 | 环境、依赖或安装问题 |
| 3 | `astro build` / `astro dev` 失败 |
| 4 | 参数用法错误 |

## 生成物

- `.design-doc/site/`：从 `templates/` 复制的 Astro 站点，内容从 `design/` 同步。
- `.design-doc/dist/`：`astro build` 产物。
- `.design-doc/.gitignore`：忽略整个生成目录。

不要手改 `.design-doc/`；改正文后重新运行命令。

## 接入已有站点

```bash
node scripts/cli.mjs build design --site ../my-astro-site
```

脚本只同步 `design/` 到 `<site>/src/content/docs/design/`，不覆盖站点的 `astro.config` 与 `content.config`。站点需自行声明 `design` 集合与页面路由（见 `references/astro.md`）。

注意：同步会重建 `<site>/src/content/docs/design/`，不要把其他内容放在该目录。

## 校验范围

- frontmatter 字段、类型、日期与未知字段；
- 文件名、路由重复、正文 H1、标题层级/字符/重复；
- `{#id}`、`.md` 链接、非法外链、路由与锚点可达性；
- 图片 alt、相对路径、存在性、远程图；
- Mermaid 围栏必须在 `<details>` 内且有 SVG；
- 禁用 HTML/组件、代码围栏语言、BOM/CRLF。
