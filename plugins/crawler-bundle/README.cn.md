# @veren/crawler-bundle

仅配置的组合包：一步装好多平台内容采集插件——patch 插入唯一的 `crawler` 行，成员插件（`@veren/crawler`）作为普通依赖随行。

## 何时使用

- 想通过一次安装让采集插件在 DSH profile 生效（profile 层加载，插件管理页作为一个开关整体启停）。
- 想在自己的 patch 里逐行组装时请跳过本组合包。

## 插入内容

- `crawler` → `@veren/crawler`：采集管线（平台爬取器 → 强制脱敏的存储适配 → json/jsonl/csv 介质）、采集任务管理器、日志环形缓冲、数据文件服务、可选 HTTP 控制服务（`enableApi` 配置，默认关）。

无应用框架行：采集插件今天是普通插件；客户端面板以应用形态落地后，其框架依赖并入本组合包。

## 文档

- 英文文档：[README.md](./README.md)
- 设计方案：`plugins/crawler/design/`
