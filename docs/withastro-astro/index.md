---
title: Astro 站点框架设计方案
description: "把组件、内容与配置编译成可静态部署或按需渲染的站点，并在本地提供可调试的开发环境。"
sidebar:
  order: 0
  label: 封面与目录
draft: false
lastUpdated: 2026-11-04
---

## Summary

把组件、内容与配置编译成可静态部署或按需渲染的站点，并在本地提供可调试的开发环境。

## Problem

站点作者面对的是三方拉扯：想要组件化与交互，又不想为每个组件付出整页水合的脚本成本；想要静态托管的速度，又需要一部分页面在请求时才能确定内容；想要一套代码同时面向 CDN、长驻服务器与边缘运行时，却不愿为每种宿主重写路由与渲染。围绕这三组矛盾，框架把"什么时候编译""哪些边界需要交互""由谁承接请求"拆成三个可独立回答的问题，并为每个问题给出确定的失败语义：配置错了立即失败，路由不唯一立即失败，编译失败不拖垮整个开发服务器。目标用户是需要长期维护内容站、文档站、营销站与轻量应用的团队；痛点不在于"能不能做出来"，而在于"改一次配置能不能预测影响范围、出一次错能不能在十秒内定位"。

## Core Architecture

整套系统按两个阶段、三层所有权组织。两个阶段是构建期与运行期：构建期把项目声明的组件、内容与规则收敛为一份不可变设定和一张有序路由表，再据此产出静态文件或一个标准请求入口；运行期只做一件事，把一个已匹配的请求推进为响应，沿途经过中间件、会话、动作与缓存，任一环节失败都收敛为稳定错误码而不是未捕获异常。三层所有权是：设定只由配置层写，路由只由路由层裁定，产物只由构建编排落盘。开发期不是第三套实现，而是把同一套编译与渲染挂到本地端口上，额外提供热更新、错误覆盖层与一个可扩展的开发者界面；这三个附加能力都只读运行期事实，不改变构建与请求的语义。扩展通过两条窄接口进入：集成在构建生命周期的固定钩子上注入路由、脚本、渲染器与指令，适配器把产物接到具体宿主并声明自己支持哪些能力；两者都不能改写路由裁定，也不能读取机密设定。由此，同一份项目可以在静态托管、长驻服务器与边缘运行时之间迁移，而失败路径、错误语义与调试界面保持一致。

## Contents

| 章节 | 内容 | 读者关注点 |
| --- | --- | --- |
| [1 总体方案与架构](/design/architecture/) | 边界、核心域判定、15 个模块、依赖与控制流、时序图 | 先读这章建立全局图 |
| [2 CLI](/design/modules/cli/) | 命令、参数、退出码与终端交互 | 日常入口 |
| [3 Config](/design/modules/config/) | 配置合并、校验、环境变量与输出形态 | 出问题时最先怀疑的地方 |
| [4 Routing](/design/modules/routing/) | 路由发现、优先级、国际化、重写 | 路径不符合预期时读 |
| [5 Compile](/design/modules/compile/) | 组件编译、样式作用域、岛屿边界 | 交互不生效时读 |
| [6 Render](/design/modules/render/) | 中间件、Cookie、CSP、动作与错误兜底 | 请求级行为 |
| [7 Build](/design/modules/build/) | 预渲染、打包、落盘、增量 | 产物与 CI |
| [8 Server](/design/modules/server/) | 开发与预览服务器、热更新、覆盖层 | 本地开发 |
| [9 Assets](/design/modules/assets/) | 图片、字体、静态资源与端点 | 性能与资源 |
| [10 Content](/design/modules/content/) | 集合、加载器、数据存储 | 内容建模 |
| [11 Actions](/design/modules/actions/) | 类型安全 RPC 与校验 | 表单与写操作 |
| [12 Storage](/design/modules/storage/) | 会话与运行时缓存 | 状态与失效 |
| [13 Integrations](/design/modules/integrations/) | 钩子、渲染器、指令、工具栏扩展 | 扩展框架 |
| [14 Adapters](/design/modules/adapters/) | 宿主契约与能力声明 | 部署 |
| [15 Navigation](/design/modules/navigation/) | 视图过渡与预取 | 站内跳转体验 |
| [16 Tooling](/design/modules/tooling/) | 语言服务器、检查、脚手架、升级 | 编辑器与新建项目 |
| [17 Server API](/design/api/) | 7 个接口：动作、图片、岛屿、开发通道、适配器入口 | 对接与安全评审 |
| [18 Permissions](/design/permissions/) | 主体、权限矩阵、数据隔离 | 安全评审 |
| [19 Error Codes](/design/errors/) | 48 个稳定码、呈现契约、重试规则 | 排障 |
| [20 State Models](/design/states/) | 3 张状态图与 4 个状态表 | 实现与测试 |
| [21 Data Dictionary](/design/data/) | 各实体字段、默认值、可见性 | 契约对齐 |
| [22 Product Surfaces](/design/product/) | 3 个产品端、13 个页面、3 个编辑器表面 | 体验评审 |
| [23 UI Specification](/design/ui/) | 色彩、间距、字体、动效、微文案、无障碍、国际化 | 视觉与交互 |
| [24 Basic Components](/design/components/basic/) | 基础原子组件 | 实现盘点 |
| [25 Composite Components](/design/components/composite/) | 组合组件 | 布局评审 |
| [26 Business Components](/design/components/business/) | 业务组件 | 数据绑定 |
| [27 Page Components](/design/components/pages/) | 13 个页面与 3 个表面 | 页面级状态 |
| [28 System Acceptance](/design/acceptance/) | 20 条端到端验收与追溯表 | 交付判据 |
| [29 Glossary](/design/glossary/) | 名词与术语，两者分列 | 统一用语 |
| [30 Review](/design/review/) | 假设、待确认、实测结果与核心域核对 | 已知缺口 |

## Deliverables

```text
design/withastro-astro/
  index.md                  封面与目录
  architecture.md           1 总体架构与核心域判定
  modules/                  2 到 16 逐模块设计
    cli.md config.md routing.md compile.md render.md build.md server.md
    assets.md content.md actions.md storage.md integrations.md adapters.md
    navigation.md tooling.md
  api.md                    17 服务端接口
  permissions.md            18 权限与多主体
  errors.md                 19 错误码
  states.md                 20 状态模型
  data.md                   21 数据字典
  product.md                22 产品端与页面
  ui.md                     23 界面规范
  components/               24 到 27 四层组件
    basic.md composite.md business.md pages.md
  acceptance.md             28 系统验收与追溯
  glossary.md               29 名词与术语
  review.md                 30 假设、待确认与校验记录
  assets/diagrams/          构建期预渲染的 7 张 SVG
```

独立交互原型不在内容目录内，位置为 `design/prototype/prototype.html`；它是静态演示，不接入真实请求，也不参与 Astro 构建。

## Build and Preview

本方案是纯 Markdown 内容集合，渲染交给 Astro 与 Starlight：

```bash
node .agents/skills/project-design-doc/scripts/cli.mjs check design/withastro-astro
node .agents/skills/project-design-doc/scripts/cli.mjs build design/withastro-astro --install
node .agents/skills/project-design-doc/scripts/cli.mjs dev design/withastro-astro --port 4321
```

- 检查：frontmatter、文件名、标题层级与字符、自定义锚点语法、站内链接与锚点、图片、Mermaid 围栏、禁用 HTML。
- 构建：同步到 `design/withastro-astro/.design-doc/site` 并执行 `astro build`，产物在 `.design-doc/dist`。
- 预览：默认地址 `http://localhost:4321/design/`；产品原型单独打开。
- 文件为唯一内容来源，不要手改生成目录；改动后重跑检查与构建。

## Baseline

| 项 | 值 |
| --- | --- |
| 核心包版本 | `astro@7.4.5` |
| 提交 | `e71c038f31194280b44515bf53cf449a5313baf9`（2026-11-03） |
| 方案站渲染 | Astro 7.4.5 与 Starlight 0.42.8（模板 `site-starlight`） |
| 部署路径 | 站点根部署，正文链接统一写 `/design/...` |
| 覆盖范围 | 核心包、`@astrojs/*` 官方集成与适配器、语言工具、脚手架 |
| 明确排除 | 托管平台内部行为、站点作者的业务页面、第三方集成的私有实现 |
