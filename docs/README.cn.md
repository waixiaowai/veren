# docs —— 面向读者的手册与教程

[English](./README.md)

本目录存放**对外**的文档：面向不同读者群的手册、教程与指南。与包内的 `README.md` /
`README.cn.md`（每个包“怎么用”的开发文档，遵循 `AGENTS.md` 约定）不同，这里的文档按
读者组织，讲解跨包的主题。

## 读者群与文档分工

| 读者 | 内容 | 命名建议 |
| --- | --- | --- |
| 用户 | 安装、上手、常见问题 | `user-*.md` |
| 应用开发者 | 在产品中使用 veren 包的教程 | `guide-*.md` |
| 包开发者 | 架构、流水线设计、扩展方式 | `design-*.md` |
| AI 代理 | 结构化、可机器消费的项目说明 | `agent-*.md` |

## 写作规范

- 面向谁的文档就用该读者熟悉的语言与术语，避免把实现细节塞进用户文档。
- 每篇文档开头写明目标读者与前置知识。
- 涉及具体包的用法时链接到该包的 `README.md` / `README.cn.md`，不要复制内容。

## 当前文档清单

- [Agent 小黑板插件设计（草案）](./agent-blackboard-design.cn.md)：面向 DSH 插件开发者；预备知识：Cordis、Preset、Agent Teams。
- [DSH 通用 AI 后台管理平台设计方案（草案）](./admin-system-design.cn.md)：面向 DSH 插件开发者与后台平台架构师；预备知识：DSH profile/bundle、Cordis Service、Agent/Session、HTTP、RBAC、前端插件化、数据库/ORM 与常用后端中间件。
- [场景预设设计（草案）](./scene-preset-design.cn.md)：面向 DSH 插件开发者与 Agent 产品设计者；预备知识：Cordis、Agent Preset、系统提示词、工具注册。
