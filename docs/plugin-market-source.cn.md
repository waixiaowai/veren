# DSH 插件市场索引源

[English](plugin-market-source.md) | 中文

**目标读者**：维护本项目插件发布与分发的开发者、部署运维人员。

**前置知识**：DSH profile 与 bundle（`dsh.bundle.patch`）、pnpm workspace、nginx 静态站点。

## 索引源是什么

DSH 的「插件 → 发现」页本身不带任何插件数据。它把一串**索引源 URL** 记录下来，每次打开时由 DSH Host 去抓取这些 URL，
得到一份 `index.json`，再在本地做筛选、排序和分页。所以「开发一个索引源」= 在一个稳定 HTTPS 地址上提供一份
**格式 1** 的 JSON，并让它的内容随发版更新。

格式由 DSH 的 `@deepseek-ai/dsh-plugin-market-index` 定义与校验，要点：

| 字段 | 作用 |
| --- | --- |
| `format` | 固定为 `1`，其他值整份索引被拒 |
| `title` / `description` | 市场名与简介，`LocalizedText`（字符串，或含 `en` 的对象） |
| `metadata.categories` / `labels` / `sortKeys` | 市场自定义的分类、标签、排序键声明；Discover 只读标题、不解释含义 |
| `plugins[]` | 一行一个插件，`name` 必须是 npm 包名且在本索引内唯一 |
| `plugins[].versions[]` | 每个可安装版本的精确版本号、发布时间戳、来源（npm 或 git 提交）、`engines.dsh` |

两条硬约束：

- 只有声明了 `dsh.bundle.patch` 的包才会被列进去，因为市场安装的就是 profile bundle。
- 客户端安装的是**索引里写死的那个版本**（或 Git 提交），不是 `name@latest`；所以索引不重新生成，就不会出现新版本。

## 本项目的索引源

| 项 | 值 |
| --- | --- |
| 索引地址 | `https://market.veren.top/index.json` |
| 托管 | 138 服务器（`43.240.223.138`）nginx 静态目录 `/var/www/market` |
| 证书 | Let's Encrypt `market.veren.top`，certbot webroot 模式，自动续期 |
| 站点配置 | `market/deploy/nginx/market-veren-http.conf`、`market-veren-https.conf` |
| 包来源 | `npm.veren.top`（verdaccio），版本里因此记录 `source.registry` |

站点**匿名只读**：Discover 由 DSH Host 直接抓取，不带任何用户凭据，所以这个域名不能加登录门禁。

## 仓库里的目录

```text
market/
  sources.txt            要上架的 bundle 清单，一行一个 npm 包名，顺序即索引默认顺序
  market.json            市场标题/简介、分类与标签声明、每个插件的分类、标签、关键词
  build.mjs              生成索引：调用 DSH 生成器 → 合并市场元数据 → 校验 → 写 site/index.json
  release.mjs            发布依赖闭包：按 workspace 依赖拓扑排序，跳过 registry 已有版本
  deploy.mjs             把 site/ 同步到 138 并做 HTTPS 自检
  lib/                   paths / generator / metadata / validate 四个小模块
  deploy/nginx/          dsh 站点用的两份 nginx 配置
  site/                  生成产物（不入库），部署的就是这个目录
```

`build.mjs` 复用 DSH 检出里的生成器（`apps/plugin-market-generator`）和校验器（`packages/util/plugin-market-index`），
本仓库不重复实现格式规则。

## 日常流程

### 1. 发版

改完插件、`pnpm check:plugins` 通过之后：

```bash
pnpm -r --filter "./plugins/**" build   # 需要 dist/ 与 lib/client.js 的包先构建
node market/release.mjs --dry-run       # 看发布顺序与将跳过的版本
node market/release.mjs                 # 真正发布到 npm.veren.top
```

`release.mjs` 从 `sources.txt` 出发，沿 `dependencies` 收集 workspace 依赖闭包，做拓扑排序（依赖先发），
并跳过 registry 里已存在的 `name@version`，因此重复执行是安全的。它不会自动改版本号——发新版前请自己 bump。

### 2. 生成索引

```bash
pnpm market:build
```

产物是 `market/site/index.json`（外加必要时的 `site/icons/`）。生成器会读 registry 的 packument、下载最高版本的
tarball 取标题/图标/作者等展示字段，并按 `engines.dsh`（缺省时回退 `@deepseek-ai/dsh-*` peer 范围）判断兼容性。

### 3. 部署

```bash
node market/deploy.mjs --dry-run   # 只打印命令
pnpm market:deploy                 # 上传并自检 HTTP 200
```

### 4. 在 Discover 里添加

打开 DSH 的「插件 → 发现」，添加索引源 `https://market.veren.top/index.json`。这一条目是用户级配置
（`pluginMarket.indexes`，volatile 字段），**不要**写进仓库或 profile 的 `cordis.yml`。添加后按 Ctrl+R 重载页面。

## 排错

| 现象 | 检查 |
| --- | --- |
| Discover 里该源显示无效 | `curl -s https://market.veren.top/index.json \| head`，看是否 200 且是 JSON；再看 DSH 日志里的 `plugin-market/invalid-index` 路径 |
| 插件列表里少了某个包 | registry 里该版本是否声明了 `dsh.bundle.patch`；`publishTimestamp` 是否存在；`engines.dsh` 是否有效 |
| 安装按钮报不兼容 | 安装时按运行时版本重新求值 `engines.dsh`，索引里的声明必须和 tarball 里的 `package.json` 一致 |
| 图标不显示 | 相对 `icon` 会按索引 URL 解析，必须落在 `https://market.veren.top/` 下，或使用 `data:` 内联 |
| 页面缓存了旧索引 | 站点已对 `index.json` 设 `no-store`；仍异常时看是否被中间代理缓存 |

## 安全边界

- 索引本身不签名。标题、作者、`official` 标签都是市场方的声明，不是 DSH 的验证。
- 索引可以指向任意同名包与任意 registry；安装前确认每一项的来源（Discover 的确认框会显示索引 URL 与来源）。
- 这个域名只放静态文件，不放任何脚本或凭据；证书私钥留在 138 的 `/etc/letsencrypt`。
