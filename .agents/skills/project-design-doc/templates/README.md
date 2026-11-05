# 站点模板

两套 Astro 站点骨架，供 `scripts/cli.mjs` 复制使用：

| 模板 | 用途 | 内容根 | 路由 |
| --- | --- | --- | --- |
| `site-starlight` | 默认；独立文档站 | `src/content/docs/design/` | `/design/<id>/` |
| `site-minimal` | 嵌入已有 Astro 站点，或不想用 Starlight | 同上 | 同上 |

脚本把 `design/` 同步到模板的 `src/content/docs/design/`；模板本身不包含方案正文。

## 版本

| 包 | 版本 |
| --- | --- |
| `astro` | `7.4.5` |
| `@astrojs/starlight` | `0.42.8` |
| `@astrojs/markdown-remark` | `7.3.0` |
| `@astrojs/check` | `0.9.12` |
| `typescript` | `5.9.3` |

升级时同步更新两套 `package.json`，并按 `references/astro.md` 的验收清单复验。

## 占位符

- `astro.config.mjs` 的 `site` 是 `https://example.com`，部署前替换为真实域名。
- `starlight({ title: '设计方案' })` 的标题按项目替换。
- `templates/page.md`、`templates/review.md` 与 `templates/usability.md` 只是骨架，复制后填入真实内容。

## 不要手工编辑生成物

脚本在 `<design>/.design-doc/site/` 生成站点并同步内容；`.design-doc/` 整个目录是生成物，不提交。修改正文只改 `design/` 下的 Markdown，重新运行 `scripts` 命令。
