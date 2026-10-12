# docs —— 面向读者的手册与教程 / Manuals and tutorials for readers

本目录存放**对外**的文档：面向不同读者群的手册、教程与指南。与包内的 `README.md` /
`README.cn.md`（每个包"怎么用"的开发文档，遵循 `AGENTS.md` 约定）不同，这里的文档按
读者组织，讲解跨包的主题。

This directory holds **outward-facing** documentation: manuals, tutorials and guides for
specific audiences. Unlike the per-package `README.md` / `README.cn.md` pairs (how to use
each package, per the `AGENTS.md` conventions), documents here are organized by audience
and cover cross-package topics.

## 读者群与文档分工 / Audiences and what belongs here

| 读者 / Audience | 内容 / Content | 命名建议 / Suggested naming |
| --- | --- | --- |
| 用户 / Users | 安装、上手、常见问题 / installation, getting started, FAQ | `user-*.md` |
| 应用开发者 / App developers | 在产品中使用 veren 包的教程 / tutorials for using veren packages in products | `guide-*.md` |
| 包开发者 / Package developers | 架构、流水线设计、扩展方式 / architecture, pipeline design, extension points | `design-*.md` |
| AI 代理 / AI agents | 结构化、可机器消费的项目说明 / structured, machine-consumable project briefs | `agent-*.md` |

## 写作规范 / Writing conventions

- 面向谁的文档就用该读者熟悉的语言与术语，避免把实现细节塞进用户文档。
  Use the language and vocabulary of the target audience; keep implementation details out
  of user-facing documents.
- 每篇文档开头写明目标读者与前置知识。
  State the target audience and required background at the top of every document.
- 涉及具体包的用法时链接到该包的 `README.md` / `README.cn.md`，不要复制内容。
  Link to the package's README pair instead of duplicating it.

当前文档清单 / Current documents: （空 / empty —— 欢迎按上表补充 / contributions welcome following the table above）
