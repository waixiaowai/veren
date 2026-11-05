---
title: 组件编译
description: "compile 把单个单文件组件、内容文档与框架组件编译成可执行的渲染单元，并保留三样东西：源码位置（供诊断与覆盖层）、客户端边界（哪些片段需要下水合脚本）、以及模块依赖（供热更新精确失效）。它不做路由、不发请求、不写产物；与 integrations 的分界是：compile 负责 如何编译 ，集成只提供渲染器、指令与语法扩展"
sidebar:
  order: 5
  label: 组件编译
draft: false
lastUpdated: 2026-11-04
---

## 5. Compile

`compile` 把单个单文件组件、内容文档与框架组件编译成**可执行的渲染单元**，并保留三样东西：源码位置（供诊断与覆盖层）、客户端边界（哪些片段需要下水合脚本）、以及模块依赖（供热更新精确失效）。它不做路由、不发请求、不写产物；与 `integrations` 的分界是：`compile` 负责"如何编译"，集成只提供渲染器、指令与语法扩展。

### 5.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 解析组件三段式结构（前言脚本、模板、样式/脚本块） | 决定页面是否预渲染（委托 `routing`） |
| 生成渲染函数、样式作用域、脚本提升与资源引用 | 决定请求如何匹配（委托 `routing`） |
| 标记客户端指令边界与渲染器归属 | 生成最终 HTML 文档骨架（委托 `render`） |
| 产出源码映射与错误位置 | 打包与产物命名（委托 `build`） |
| 内容文档的 Markdown/MDX 语法转换 | 内容集合校验（委托 `content`） |

### 5.2 Invariants

编译域的三条铁律围绕"产物可用"与"边界可预测"：

| 铁律 | 理由 | 违反后果 |
| --- | --- | --- |
| 失败不产出半成品模块 | 半成品会被后续渲染误用，错误延后到请求期 | 页面缺段，或水合脚本指向不存在的边界 |
| 岛屿属性必须可序列化 | 不可序列化的值无法跨进程传递 | 浏览器端水合失败，交互静默失效 |
| 客户端边界在编译期定稿 | 运行期再决定会破坏缓存与预渲染一致性 | 同一页面两次请求下发不同脚本集合 |

恢复策略：编译失败只写错误载荷、不写模块缓存；修复后按文件粒度失效并重建，其他文件的结果继续复用。

### 5.3 Capabilities

编译单元分四类：页面组件、普通组件、端点模块、内容文档。组件编译输出一个模块，模块导出一个异步渲染函数；函数接收属性、插槽与渲染上下文，返回结构化结果：HTML 片段、需要提升到文档头部的元数据（标题、链接、脚本、样式）、以及本单元产生的客户端脚本引用。模板中的表达式在服务端求值，输出前统一转义；`set:html` 等显式逃逸必须由作者声明。样式块按配置的作用域策略（`where`/`class`/`attribute`）改写选择器，并在结果中登记样式引用；`script` 块默认为提升脚本，参与打包并去重。客户端指令有五类：立即、空闲、可见、媒体查询、仅客户端；每条指令绑定一个渲染器与一个客户端入口，编译期只记录"边界描述"，不内联客户端代码。岛屿边界会被编译为占位元素与序列化属性，属性值必须可被安全序列化（函数、Symbol 与循环引用在编译期或运行期报错）。内容文档经语法管线转换后与组件同构：同样产出渲染函数，同样可被页面引用。热更新以"模块"为单位：模板、样式、脚本任一变化都产出新的编译结果并附带失效范围；编译失败不产生半成品模块，只产出错误载荷。

### 5.4 Contracts

```ts
type ClientDirective = 'load' | 'idle' | 'visible' | 'media' | 'only';

interface CompileInput {
  filePath: string;                 // 绝对路径，用于源码映射与缓存键
  source: string;
  mode: 'dev' | 'build';
  scopedStyleStrategy: 'where' | 'class' | 'attribute';
  renderers: RendererRegistry;      // 由集成注册，按组件扩展名解析
  syntaxExtensions: SyntaxExtension[]; // 如 MDX、Markdoc
}

interface IslandBoundary {
  componentId: string;              // 客户端入口标识
  directive: ClientDirective;
  directiveValue?: string;          // client:media 的查询串
  rendererName: string;
  props: Record<string, unknown>;   // 必须可序列化
}

interface CompileResult {
  code: string;                     // 可执行模块源码
  map?: SourceMap;                  // 行/列可映射回源文件
  styles: StyleAsset[];             // 已作用域化的样式
  hoistedScripts: ScriptAsset[];    // 需参与打包的脚本
  islands: IslandBoundary[];        // 客户端边界描述
  diagnostics: Diagnostic[];        // 非致命告警（如未知指令）
}

interface RenderUnit {
  render(props: Record<string, unknown>, slots: SlotMap, ctx: RenderContext): Promise<RenderResult>;
}

interface RenderResult {
  html: string;
  head: HeadMetadata;               // 标题、meta、链接、内联样式
  scripts: ScriptAsset[];
  islands: IslandBoundary[];
}

abstract class Compiler {
  abstract compile(input: CompileInput): Promise<CompileResult>;
  abstract invalidate(filePath: string): void;   // 供热更新精确失效
}
```

错误约定：语法错误 → `UnknownCompilerError`（含文件、行列、片段）；模板中使用了未注册的渲染器 → `NoMatchingRenderer`；声明了 `client:*` 但渲染器无客户端入口 → `NoClientEntrypoint`；`client:only` 无法推断渲染器 → `NoClientOnlyHint`。编译期错误绝不降级为"空组件"，否则会把错误推迟到运行期。

### 5.5 Flow

下面伪代码说明一个组件从源码到可渲染单元，以及一次岛屿属性序列化；覆盖编译失败与不可序列化两类拒绝。

```ts
async function compileComponent(input: CompileInput): Promise<CompileResult> {
  const parsed = parseSFC(input.source, input.filePath);        // 前言、模板、样式、脚本
  const scoped = transformStyles(parsed.styles, input.scopedStyleStrategy);
  const template = await transformTemplate(parsed.template, {
    renderers: input.renderers,
    onUnknownDirective: (name) => report(diagnostics, name),
  });
  const module = emitModule({ frontmatter: parsed.frontmatter, template, scoped });
  return { code: module.code, map: module.map, styles: scoped, hoistedScripts: parsed.scripts,
           islands: template.islands, diagnostics };
}

function serializeIsland(boundary: IslandBoundary): string {
  const safe = toSerializable(boundary.props);                  // 拒绝函数/Symbol/循环引用
  if (!safe.ok) throw new AstroError(AstroErrorData.InvalidComponentArgs, { path: boundary.componentId });
  return `<astro-island component-url="${boundary.componentId}" client="${boundary.directive}"
           props="${encodeProps(safe.value)}" renderer-url="${resolveRenderer(boundary)}"></astro-island>`;
}
```

失败处理：编译失败时返回错误载荷而不写入模块缓存，热更新把载荷推给覆盖层，构建则中止当前页并把文件名写进摘要；同一文件连续失败只保留最后一次错误，避免覆盖层闪烁。`client:only` 在无法确定渲染器时必须在编译期失败，不得在浏览器脚本体里抛错。

幂等与恢复：同一文件在相同模式下编译结果确定；并发编译同一文件以首个成功结果为准，失败结果不进入缓存。

### 5.6 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-5-01 | 组件含前言脚本与模板表达式 | 构建后查看产物 | 表达式在服务端求值并转义；HTML 中无未转义的用户输入 |
| A-5-02 | 组件含样式块 | 构建 | 选择器按配置策略作用域化；样式在页面中只出现一次 |
| A-5-03 | 组件使用 `client:visible` | 打开页面 | 输出 `astro-island` 占位；进入视口后才加载客户端脚本 |
| A-5-04 | 组件使用 `client:only` 且未安装对应渲染器 | 构建 | 失败并返回 `NoClientEntrypoint`/`NoClientOnlyHint`，指出组件与指令 |
| A-5-05 | 岛屿属性含函数 | 构建或渲染 | 立即报错并指出属性路径，不产生无法水合的 HTML |
| A-5-06 | 模板存在语法错误 | 开发期保存文件 | 覆盖层显示文件名与行列，服务器继续运行；修复后恢复正常渲染 |
| A-5-07 | 同一文件并发编译 10 次 | 并发触发编译 | 只有一份结果写入缓存，其余命中同一结果 |
| A-5-08 | 编译失败后修复 | 保存文件 | 只重建该文件，其他文件结果复用；错误载荷被清除 |
