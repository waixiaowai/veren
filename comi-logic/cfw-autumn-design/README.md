# cfw-autumn 设计方案

对 `comi-logic/cfw-autumn` 的完整项目设计方案，内容在 `design/`，可直接作为 Astro/Starlight 内容集合导入。

## 目录

| 路径 | 内容 |
| --- | --- |
| `design/index.md` | 封面、核心架构、内容目录与交付目录树 |
| `design/chapters/` | 总体架构、接口、权限、错误码、状态、数据、产品、界面、四层组件、验收、术语、校验记录 |
| `design/modules/` | 12 个模块（定价目录、额度账本、结算引擎三个核心域 + 9 个支撑域） |
| `design/assets/` | 预渲染 SVG 与页面线框 |
| `site/` | 随方案交付的 Starlight 站点配置 |
| `diagrams-src/` | Mermaid 源码，用于重绘图 |
| `verify-links.mjs` | 构建产物站内链接核对 |

## 构建与预览

```bash
# 校验内容与站点类型 / check content and site types
node ../../.agents/skills/project-design-doc/scripts/cli.mjs check design --site site

# 构建 / build (首次加 --install / add --install on first run)
node ../../.agents/skills/project-design-doc/scripts/cli.mjs build design --site site

# 本地预览 / preview
node ../../.agents/skills/project-design-doc/scripts/cli.mjs dev design --site site --port 4321
```

产物在 `design/.design-doc/dist/`，入口是 `/design/`。链接核对：

```bash
node verify-links.mjs design/.design-doc/dist
```

## 重绘图表

```bash
mmdc -c mermaid-config.json -p puppeteer-config.json -i diagrams-src/architecture-overview.mmd -o design/assets/diagrams/architecture-overview.svg -b white
```

`mermaid-config.json` 关闭 HTML 标签以保证 SVG 内只有原生文本，`puppeteer-config.json` 指定本机 Chrome 路径。
