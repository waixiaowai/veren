---
title: 名词与术语
description: "| 中文名 | 统一标识 | 解释 | 易混淆边界 |"
sidebar:
  order: 29
  label: 名词与术语
draft: false
lastUpdated: 2026-11-04
---

## 29. Glossary

### 29.1 Domain Terms

| 中文名 | 统一标识 | 解释 | 易混淆边界 |
| --- | --- | --- | --- |
| 项目 | `project` | 一次运行绑定的根目录及其配置、源码、内容与产物 | 不是"仓库"；一个仓库可含多个项目 |
| 页面 | `page` | 产出 HTML 的路由 | 与"端点"相对：端点产出任意响应 |
| 端点 | `endpoint` | 产出 `Response` 的路由，不经过页面模板 | 端点不是 API 的同义词，API 指对外契约 |
| 路由 | `route` | 路径模式与处理单元的绑定 | "路由表"是有序集合；"路由记录"是其中一项 |
| 预渲染 | `prerender` | 构建期把页面渲染成静态文件 | 与"静态输出"不同：静态输出下仍可有按需路由（受适配器支持） |
| 按需渲染 | `on-demand` | 请求到达时渲染 | 不叫"SSR 模式"，避免与整页水合混淆 |
| 岛屿 | `island` | 页面中声明了客户端指令、需要下水合脚本的边界 | 岛屿不是组件：一个组件可产生零个或多个岛屿 |
| 客户端指令 | `client directive` | 声明何时/如何加载客户端脚本的标记 | 不是运行时函数调用 |
| 集成 | `integration` | 通过钩子参与构建/开发的第三方包 | 集成不等于插件：集成作用于构建期，插件可作用于任意阶段（本项目只讨论集成） |
| 适配器 | `adapter` | 把产物接到具体宿主的实现 | 适配器是集成的一种特例，但拥有独立能力声明 |
| 内容集合 | `collection` | 一组同构内容条目的声明 | 与"目录"不同：集合可有非文件来源 |
| 条目 | `entry` | 集合中的一条数据 | 条目 ID 在集合内唯一 |
| 动作 | `action` | 可从浏览器调用的服务端函数 | 不是 REST 资源；只有单一入口 |
| 会话 | `session` | 与访客关联、由 cookie 标识的服务端状态 | 与"缓存"不同：会话随主体变化，缓存随响应变化 |
| 缓存规则 | `route rule` | 路由级缓存参数（`maxAge`/`swr`/`tags`） | 不是缓存实现；实现由提供方决定 |
| 构建运行 | `build run` | 一次从设定到产物的完整执行 | 与"构建缓存"不同：后者跨运行存在 |
| 产物 | `artifact` | 构建写出的文件、清单与入口 | 产物不含源码 |
| 清单 | `manifest` | 路由、资源、会话驱动等运行期元数据 | 不是构建日志 |
| 开发工具栏 | `dev toolbar` | 注入开发页面的应用宿主 | 不是浏览器扩展 |
| 覆盖层 | `overlay` | 开发期错误的全屏提示 | 与"错误页"不同：后者是生产期响应 |
| 审计 | `audit` | 对当前页面做的可访问性/性能规则检查 | 不是完整审计报告，只在开发期存在 |
| 岛检查 | `xray` / inspect | 高亮页面岛屿并展示其指令与属性 | 不是 DOM 检查器的替代 |
| 降级 | `degraded` | 服务器可服务但部分模块编译失败的状态 | 不是"失败"；失败意味着不可服务 |
| 回退 | `fallback` | 国际化中缺失语言的替代来源 | 与"降级"无关 |
| 重写 | `rewrite` | 用另一条路由渲染同一 URL | 与"重定向"相对：地址栏不变 |
| 重定向 | `redirect` | 让浏览器换地址重新请求 | 必须给状态码与目标 |
| 设定指纹 | `fingerprint` | 关键配置规范化后的哈希 | 与文件哈希不同，用于判定是否需要全量重建 |
| 诊断 | `diagnostic` | 带位置与级别的单条问题 | 不是错误码；多条诊断可共享一个码 |

### 29.2 Technical Terms

| 术语 | 解释 | 在本方案中的用途 |
| --- | --- | --- |
| 编译 | 把源文件转换为可执行模块 | 5 章；组件与内容文档的统一入口 |
| 水合（hydration） | 浏览器为服务端 HTML 附加交互能力 | 5 章岛屿边界 |
| 序列化 | 把运行期值转成可跨进程/跨语言传输的形式 | 岛屿属性、动作结果、会话数据 |
| Source Map | 编译产物到源码的行列映射 | 覆盖层与编辑器定位 |
| HMR | 热模块替换，不刷新页面替换模块 | 8 章；开发期状态 |
| 流式响应 | 响应体分块到达 | 6 章；`ResponseSentError` 的边界 |
| CSP | 内容安全策略，限制脚本/样式来源 | 6 章；`security.csp` |
| CSRF | 跨站请求伪造 | 6 章；`checkOrigin` 的 403 |
| ETag | 内容指纹式缓存校验 | 17 章图片端点 |
| SWR | 过期后先返回旧值再后台刷新 | 12 章缓存规则 |
| 幂等 | 同一请求重复执行结果一致 | 17、19 章重试约定 |
| LSP | 语言服务器协议 | 16 章编辑器集成 |
| Web Component | 浏览器原生自定义元素 | 24–26 章工具栏组件 |
| Shadow DOM | 隔离样式与 DOM 的边界 | 工具栏与覆盖层的样式隔离 |
| Serverless | 按请求计费的函数宿主 | 14 章适配器形态 |
| Edge | 靠近用户的运行时 | 14 章适配器形态；中间件模式 |
| MIME | 媒体类型标识 | 图片端点与资源响应 |
| 交付产物 | 可部署的静态文件/服务入口 | 7 章；与"产物"同义，强调可交付性 |
| 基线测试 | 不依赖网络的本地测试 | 验收与 `review.md` 的证据来源 |

### 29.3 Naming Rules

- 状态名与 20 章枚举逐字一致：`idle`、`resolving`、`discovering`、`syncing`、`bundling`、`prerendering`、`emitting`、`succeeded`、`failed`、`starting`、`ready`、`rebuilding`、`degraded`、`stopping`、`stopped`、`received`、`matched`、`inMiddleware`、`rendering`、`responded`、`redirected`、`errored`、`notFound`、`rejected`、`completed`、`active`、`inactive`、`initialized`、`registered`、`destroyed`、`pending`、`expired`、`validating`、`executing`、`serializing`、`scanning`、`writing`、`synced`。
- 页面 ID 与 22 章、27 章一致：`P-T01`…`P-T07`、`P-B01`…`P-B06`、`S-E01`…`S-E03`。
- 组件名与 24–27 章一致；不得出现"工具栏按钮组件"这类中文代称作为标识。
