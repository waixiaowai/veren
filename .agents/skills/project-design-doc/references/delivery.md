# 交付与一致性校验

## 文件组织

尊重用户指定输出目录；未指定时使用目标项目内明确命名的方案目录。先总后分，多文件且职责单一。以下为推荐结构，可随项目规模合并或拆分，但所有要求均须覆盖：

```text
design/
  index.md                 # 封面、内容目录、交付目录树
  architecture.md          # 总体方案、架构图、异步时序图
  modules/<module>.md      # 每模块职责、契约、业务流和验收
  api.md                   # 服务端接口
  permissions.md           # 主体定义、权限矩阵与数据隔离
  errors.md                # 全局错误码表
  states.md                # 状态模型与转移图
  data.md                  # 数据字典
  product.md               # 产品端、页面边界、页面流转与原型说明
  usability.md             # 核心任务、指标阈值、评估计划与记录位置
  ui.md                    # UI 规范：色彩、间距、字体、布局、动效、文案、无障碍、国际化
  components/basic.md
  components/composite.md
  components/business.md
  components/pages.md
  acceptance.md            # 系统最终验收及追溯表
  glossary.md              # 分开列业务名词与技术术语
  review.md                # 实际校验结果、假设与待确认项
  assets/                  # 图片与预渲染图；随内容入库
```

每个 `.md` 顶部写 frontmatter，正文不写 H1。导入 Astro 时把整个 `design/` 复制到 `src/content/docs/design/`；路由即 `/design/<id>/`，`index.md` 对应 `/design/`。文件名与目录层级不要改。

生成物在 `<design>/.design-doc/`（Astro 站点与 dist），整个目录不提交；不要手写 `web/` 或第二份正文。首次构建运行 `node scripts/cli.mjs build design`，细节见 [scripts 用法](../scripts/README.md)。

单个 Markdown 文件超过约四百行或出现新的职责域时拆分；模块多的项目按领域分目录，避免交付一个巨型 `modules.md`。

## frontmatter

每个文件以 YAML frontmatter 开头，只允许以下字段：

```yaml
---
title: 总体方案与架构
description: 系统边界、模块清单、依赖方向与控制流。
sidebar:
  order: 1
  label: 总体方案与架构
  hidden: false
draft: false
lastUpdated: 2026-11-04
---
```

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | string | 是 | — | 页面标题，由布局渲染为 H1 |
| `description` | string | 否 | 空 | meta description 与列表摘要 |
| `sidebar.order` | number | 否 | 按 `id` 排序 | 导航顺序；同一目录内唯一 |
| `sidebar.label` | string | 否 | 取 `title` | 导航短名 |
| `sidebar.hidden` | boolean | 否 | `false` | 不在导航显示，仍可直达 |
| `draft` | boolean | 否 | `false` | 生产构建排除 |
| `lastUpdated` | date | 否 | 空 | 不写引号；Starlight 期望 `Date` |

禁止 `slug` 与任何未列出的字段；Astro/Starlight 不会因未知字段失败，但会静默丢弃。字段的详细映射与两种站点配置见 [Astro 导入](astro.md)。

YAML 写法：frontmatter 用空格缩进，不用 Tab；字符串含 `:`、`#`、`{}`、`[]`、`&`、`*`、`|`、`>` 时加引号；日期不要加引号；`description` 保持单行。

## 内容来源与渲染

Markdown 是唯一内容来源。Astro 是唯一渲染器：`scripts` 负责校验、把 `design/` 同步到 Astro 内容根，并调用 `astro build/check/dev`。禁止自建 HTML 阅读页、`web/` 或第二份正文；渲染、路由、目录与搜索全部交给 Astro/Starlight。

生成物在 `<design>/.design-doc/`：`site/` 是 Astro 站点，`dist/` 是构建产物，整个目录不提交。需要本地阅读用 `scripts dev`；构建与检查见 [scripts 用法](../scripts/README.md)。

## 章节编号与锚点

章节编号与锚点一次定稿：标题采用“编号 + 英文”，如 `## 3.2 Permission Matrix`；小节如 `### 3.2.1 Permission Matrix`。不写中文、不写 `{#id}`。

锚点按 github-slugger 规则自动生成：

| 标题 | 锚点 |
| --- | --- |
| `## 1. Architecture` | `1-architecture` |
| `## 3.2 Permission Matrix` | `32-permission-matrix` |
| `### 3.2.1 Permission Matrix` | `321-permission-matrix` |
| `### 1.1 Boundary` | `11-boundary` |
| 同文件重复标题 | 依次加 `-1`、`-2` |

注意 `1.1` 的锚点是 `11-`，不是 `1-1-`；这是 github-slugger 的固定行为。已发布章节的编号与锚点不因措辞调整而变动；确需重命名时同步更新全部引用并在 `review.md` 记录影响范围。正文内部链接与 Astro 深链指向同一锚点。文件拆分后不要用“见其他章节”代替所有实质内容，引用必须精确且可访问。

## 站内链接

站内页间链接统一写**相对路由**（不含 `.md` 后缀）：路由结构与文件层级一一对应，相对链接在任意部署基路径（含子路径）下均有效；根绝对路由 `/design/…` 在子路径部署后失效，禁止使用。

| 形态 | 写法 | 例子 |
| --- | --- | --- |
| 页间（同目录） | `./<id>/#<锚点>` | `[权限矩阵](./permissions/#183-permission-matrix)` |
| 页间（跨目录） | `../<id>/#<锚点>` | `[CLI](../modules/cli/#12-command-line)` |
| 页间（章首） | `./<id>/` 或 `../<id>/` | `[架构](./architecture/)` |
| 链回封面 | `./`、`../`（按层级） | `[返回目录](../)` |
| 页内 | `#<锚点>` | `[见下文](#183-permission-matrix)` |
| 外链 | `https://…` | 仅 https；`http://localhost` 例外 |

禁止 `.md` 后缀、根绝对路由 `/design/…`、裸文件名（不带尾斜杠）、`file://`。Astro 不会把 Markdown 文件链接改写成路由；`./permissions.md` 会原样进入 `href`，发布后 404。目录路由必须带尾斜杠；`../` 层级必须与当前文件位置一致，不能越出内容根。

## 渲染与预览

- 导航、目录、折叠、深链与搜索由 Astro/Starlight 提供；不手写第二套 HTML。
- 构建：`node scripts/cli.mjs build <design>`；默认 `templates/site-starlight`，`--minimal` 用最小集合。
- 检查：`node scripts/cli.mjs check <design>`；内容规则 + `astro check`，构建前先通过。
- 预览：`node scripts/cli.mjs dev <design>`；默认 `http://localhost:4321/design/`。
- 产物按 HTTP 访问，不承诺 `file://`；需要分享时部署 `.design-doc/dist/` 或使用站点预览。
- 内容图放 `design/assets/`，Astro 构建时优化；禁止远程图、`<img>` 与 emoji 图标。
- 原型演示与阅读站点分离：原型是独立静态文件，不接入真实请求、鉴权或持久化。

## 假设与待确认

方案中每一条自行设定的假设与未确认事项都进入 `review.md`，统一格式：编号、内容、默认取值、影响章节、确认后需重做的部分。影响核心边界且尚未确认的，在正文对应位置就地标注待确认，不能只在附录提一句。核心业务判定的依据（每域命中判据的简证、比例核对结果、判定存疑的域）同样记录在 `review.md`。

Astro 相关假设至少记录：Astro 版本（实测 `7.4.5`）、Starlight 版本（实测 `0.42.8`）、站点是否子路径部署、使用 Starlight 还是最小集合、是否用 `--site` 接入已有站点。站内页间链接为相对路由，子路径部署无需改动正文。

## 交付前校验

按实际内容逐项核对并修复问题，在 `review.md` 记录已验证、未验证和待确认项，不将“设计已描述”当成“系统已通过验收”。

1. 覆盖性：每个模块、产品端、页面和组件都已展开；每项需求均有设计归属及最终验收项。四态、微文案、无障碍与国际化须落实到具体页面条目，不能只写在规范里；核心任务与指标阈值须落到可用性验收项，不能只写在方法说明里。不适用的规范条目已在对应章节写明不适用及依据，不是静默省略。核心业务已识别且经三判据裁决与比例核对，核心域清单与模块章一一对应，核心域深化达标（铁律级决策成文、伪代码含失败分支与恢复策略、验收 ≥4 条）。
2. 架构一致性：模块清单与图节点一致，依赖方向和数据归属一致，无重复职责或无来源的关键数据；异步推进与补偿流程有时序图。
3. 契约一致性：实体名、字段类型、状态枚举、抽象方法、伪代码、请求和响应一致；每个业务组件调用的接口均存在且具备相应权限。接口的权限判定与权限矩阵逐行对应，错误语义引用全局错误码而不各自定义，字段定义与数据字典一致。
4. 流程完整性：主流程、失败路径、跳转与状态变化互相对应；URL 初始化、更新、刷新和前进后退逻辑完整；状态转移图中合法与非法转移均有标注并与错误码一致；主体切换后的失效路径完整。
5. 表达合规：受限架构段无技术栈、源码引用或项目名；验收不分期；业务名词和技术术语分开解释；无未替换模板或空伪代码。业务设计全部为表达清楚所需的最简伪代码，基础组件不写实现，复合组件说明组件组合，业务组件说明组件与接口各自用途，页面保持薄封装；展示代码不夹带业务实现。
6. 文件一致性：链接与锚点有效，编号与 slug 唯一且未漂移。Astro 产物由 Markdown 构建生成且未手改；抽查至少三节的结论句与 Markdown 逐字一致，没有只有页面才有的关键设计结论。
7. 追溯完整性：追溯表四列填满，每个需求至少一个验收项，没有孤立需求或孤立验收项；无法对应的行已标注原因。
8. 展示验证：Astro 站点按站点方式检查导航、目录、深链、刷新、窄屏、键盘交互、图渲染与原型核心路径；用 `scripts dev` 预览，构建前先过 `scripts check`。微交互在减少动态效果偏好下降级生效，动画结束后 DOM 与状态一致，不停在中间帧；目标语言下文案不溢出、不截断关键信息。缺少运行环境时说明未实测范围，不能声称通过。
9. 可用性可复算：每个产品端有核心任务与可观察的成功判据；指标有口径与阈值，阈值有来源或标待确认；评估方法与阶段匹配，样本与场景明确，结果记录位置明确；不涉及界面时已声明不适用。
10. 资产合规：无 emoji 充当图标或状态标记；图标与插画为 SVG 且可随主题换色；图片有宽高比与替代文本，装饰图置空；视频有封面帧与字幕或文字稿，音频有文字稿；自定义滚动条保留可见滑块与键盘操作；媒体文件不为唯一信息载体。
11. Astro 导入：`scripts build`（或手工复制 `design/` 到 `src/content/docs/design/`）后 `astro build` 通过；每个非 `draft` 文件生成一个页面；不需要站点侧逐文件转换。
12. 链接与锚点：所有相对路由链接（`./`、`../`）在产物中可达；`#fragment` 在目标页存在；产物中没有字面量 `{#`，没有 `href` 以 `.md` 结尾或以 `/design/` 开头的站内链接。
13. 单 H1 与目录：每页恰好一个 H1，正文无 H1；TOC 不收录 `footnote-label`，H2–H3 齐全。
14. 资源与图：图片有 `alt`、来自内容目录、相对引用、无远程；Mermaid 显示 SVG，源码在 `<details>` 内，没有可见的 `data-language="mermaid"` 代码块。
15. 草稿：`draft: true` 不出现在生产产物；开发模式可见。

最终答复提供 Markdown 总入口、Astro 路由入口（如 `/design/`）、输出位置、构建/检查/预览命令（`scripts build/check/dev`）以及尚未解决的实质问题。不要只提供工作说明而不生成文件。
