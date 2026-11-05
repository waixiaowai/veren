---
title: 客户端导航
description: "一句话职责边界：客户端导航在首屏之后接管同源跳转——它拥有 是否拦截、预取哪个 URL、如何换 DOM 与恢复滚动 这三项决策；首屏 HTML 归渲染(/design/modules/render/#65-flow)，URL 与路由匹配归路由表(/design/modules/routing/#41-duties)，导航后工具栏重建归本地服务(/design/modules/server/#82-capabilities)"
sidebar:
  order: 15
  label: 客户端导航
draft: false
lastUpdated: 2026-11-04
---

## 15. Navigation

一句话职责边界：客户端导航在**首屏之后**接管同源跳转——它拥有"是否拦截、预取哪个 URL、如何换 DOM 与恢复滚动"这三项决策；首屏 HTML 归[渲染](/design/modules/render/#65-flow)，URL 与路由匹配归[路由表](/design/modules/routing/#41-duties)，导航后工具栏重建归[本地服务](/design/modules/server/#82-capabilities)。

### 15.1 Duties

导航是**纯浏览器侧决策者**：服务器不感知客户端路由，也不存在"导航状态"这类服务端数据；路由器只在 `history.state` 里保存 `{ index, scrollX, scrollY }`，因此刷新或从外部进入时以服务端 HTML 为准。

| 关注点 | 拥有者 | 决策者 | 依据 |
| --- | --- | --- | --- |
| 是否拦截一次点击 | `ClientRouter` 的 `click` / `submit` 监听 | 路由器 | 同源、左键、无修饰键、`target` 为空、无 `download`、无 `data-astro-reload`、未 `preventDefault` |
| 预取哪个 URL、何时预取 | `prefetch` 运行时 | 配置 + 元素属性 | `prefetch.defaultStrategy` 与 `data-astro-prefetch` |
| 如何替换 DOM | `swap` 函数 | `astro:before-swap` 监听者可整体替换 `swap` | 保留 `transition:persist` 节点 |
| 滚动位置 | 路由器（写入 `history.state`） | 前进用 `pushState` 归零，遍历用存档值 | `scrollRestoration = 'manual'` |
| 新页脚本执行时机 | `runScripts` | 路由器 | `swap` 之后、`astro:page-load` 之前 |
| 工具栏生命周期 | 开发工具栏 | 工具栏订阅 `astro:after-swap` 自行重建 | 每个内置 app 各自监听 |
| 版本与降级 | — | `supportsViewTransitions` 与 `fallback` | 不支持 View Transitions API 时按 `animate` 模拟 |

### 15.2 Capabilities

能力分三层：**视图过渡**（`ClientRouter` 组件，写入两条 meta 并启用路由拦截）、**预取**（四策略 + 慢连接降级 + Speculation Rules）、**事件与指令**（5 个文档事件、3 个 `transition:*` 指令）。

| 文档事件 | 时机 | 可取消 | 监听者可改写 |
| --- | --- | --- | --- |
| `astro:before-preparation` | 新文档已取回、开始准备前 | 是 | `event.loader`、`to`、`direction`、`newDocument` |
| `astro:after-preparation` | 准备完成、`swap` 前 | 否 | — |
| `astro:before-swap` | 即将替换 DOM | 否 | `event.swap`（可整体替换交换逻辑） |
| `astro:after-swap` | DOM 已换、脚本尚未执行 | 否 | — |
| `astro:page-load` | 首次页面加载与每次导航结束 | 否 | — |

| 配置 / 属性 | 取值 | 作用 |
| --- | --- | --- |
| `prefetch: false` | 布尔 | 关闭预取，`ClientRouter` 也不再初始化预取 |
| `prefetch.prefetchAll` | 布尔 | 所有 `<a>` 参与预取，可用 `data-astro-prefetch="false"` 退出 |
| `prefetch.defaultStrategy` | `tap` / `hover` / `viewport` / `load` | 默认为 `hover` |
| `experimental.clientPrerender` | 布尔（默认 `false`） | 改用 Speculation Rules；静态 `document` 规则与动态 `list` 规则不重复注入 |
| `data-astro-prefetch` | 空值 / 四策略 / `false` | 空值表示跟随默认策略 |
| `data-astro-reload` | 存在即生效 | 该链接与表单退化为整页跳转 |
| `data-astro-history="replace"` | `replace` | 该链接以替换而非入栈方式写入历史 |
| `ClientRouter` 的 fallback 属性 | `none` / `animate` / `swap` | 不支持 View Transitions API 时的降级方式，默认 `animate` |

| 策略 | 触发 | 去抖与降级 |
| --- | --- | --- |
| `tap` | `touchstart` / `mousedown` | 无去抖；慢连接下仍预取（唯一允许忽略慢连接的策略） |
| `hover` | `mouseenter` / `focusin` | 80ms 去抖，`mouseleave` / `focusout` 取消 |
| `viewport` | `IntersectionObserver` | 300ms 去抖，离开视口即取消 |
| `load` | `astro:page-load` 后 | 立刻预取全部匹配链接 |

预取的准入条件固定为：在线、非数据节省/2G、同源、非当前页、未预取过；实现顺序为 Speculation Rules → `<link rel="prefetch">` → `fetch(priority: 'low')`（Safari 走最后一条，失败被吞掉）。另提供 `prefetch(url, { ignoreSlowConnection, eagerness })` 供脚本主动调用。

| 指令 | 取值 | 作用 |
| --- | --- | --- |
| `transition:animate` | `initial` / `slide` / `fade` / `none` / 自定义方向动画对象 | 元素级过渡动画，服务端渲染期算出作用域与关键帧 |
| `transition:persist` | 布尔或名字 | 跨导航保留该节点（含岛的水合属性），交换时转移而非重建 |
| `transition:name` | 字符串 | 跨页同名元素配对，用于共享元素过渡 |

每次导航结束会向 `aria-live="assertive"` 的 `.astro-route-announcer` 写入新页标题（延迟 60ms 后写入，避免屏幕阅读器读不到变化），该节点与样式由 `ClientRouter` 自带。

### 15.3 Contracts

```ts
type Fallback = 'none' | 'animate' | 'swap';
type NavigationTypeString = 'push' | 'replace' | 'traverse';
type Direction = 'forward' | 'back';
type Options = {
  history?: 'auto' | 'push' | 'replace';
  info?: unknown; state?: unknown;
  formData?: FormData; sourceElement?: Element;
};
class TransitionBeforePreparationEvent extends Event {   // cancelable
  from: URL; to: URL; direction: Direction | string; navigationType: NavigationTypeString;
  sourceElement: Element | undefined; info: unknown; newDocument: Document; signal: AbortSignal;
  formData: FormData | undefined; loader: () => Promise<void>;
}
class TransitionBeforeSwapEvent extends Event {
  from: URL; to: URL; direction: Direction | string; navigationType: NavigationTypeString;
  newDocument: Document; signal: AbortSignal;
  swap: () => void;                  // 可整体替换
  viewTransition: ViewTransition;
}
type TransitionAnimationValue = 'initial' | 'slide' | 'fade' | 'none' | TransitionDirectionalAnimations;
interface PrefetchOptions {
  ignoreSlowConnection?: boolean;    // 默认 false
  eagerness?: 'immediate' | 'eager' | 'moderate' | 'conservative';   // 仅 clientPrerender 生效
}
// 模块导出：astro:transitions → ClientRouter / fade / slide
// astro:transitions/client → navigate / supportsViewTransitions / transitionEnabledOnThisPage / 事件类 / swapFunctions
```

### 15.4 Flow

**用途：一次被拦截的站内点击如何走完"取文档 → 准备 → 换 DOM → 派发事件"**；任一步取不到 HTML 就交还浏览器。

```ts
async function interceptAndNavigate(href: string, opts: Options) {
  const doc = await fetchHTML(href);                       // 只接受 text/html、application/xhtml+xml
  if (!doc) return location.assign(href);                  // 非 HTML 或网络失败 → 整页跳转
  const prep = await doPreparation(from, to, direction, 'push', el, opts.info, signal, opts.formData, defaultLoader);
  if (prep.defaultPrevented) return;                       // 监听者取消 → 不发 after-preparation
  await doSwap(prep, viewTransition);                      // 派发 before-swap，监听者可替换 swap
  triggerEvent('astro:after-swap');
  await runScripts(); onPageLoad();                        // 新页脚本执行完才派发 page-load
  // 失败分支：signal 中止 → 丢弃该次导航，visual 状态回退
}
```

**用途：点击/悬停/进入视口时判定某个 `<a>` 是否命中当前策略**，是预取的唯一入口条件。

```ts
function elMatchesStrategy(el: Element | null, strategy: 'tap'|'hover'|'viewport'|'load') {
  if (el?.tagName !== 'A') return false;
  const attr = el.dataset.astroPrefetch;
  if (attr === 'false') return false;                                    // 显式退出，优先于 prefetchAll
  if (strategy === 'tap' && (attr != null || prefetchAll) && isSlowConnection()) return true;
  if ((attr == null && prefetchAll) || attr === '') return strategy === defaultStrategy;
  return attr === strategy;
  // 失败分支：不满足 → 不预取、不报错；真正发起前还会过一次 canPrefetchUrl
}
```

**用途：导航换页后让开发期浮层（工具栏、岛检查、错误覆盖层）跟上新 DOM**，由各 app 自行重建而不是中央重挂载。

```ts
document.addEventListener('astro:after-swap', () => {   // 内置 astro 菜单、canvas、settings、xray 各注册一次
  rebuildOverlayNodes();                                // 旧节点随 body 一起被换掉，必须重建并重新绑定事件
  applySettings();                                      // 设置从 localStorage 恢复
});
document.addEventListener('astro:page-load', refreshIslandsOverlayPositions);  // 尺寸/位置在新页加载后重算
```

### 15.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-15-01 | 页面引入客户端路由组件（`ClientRouter`），两页同源 | 点击站内链接 | 无整页刷新（浏览器加载指示不出现），事件顺序为 `before-preparation` → `after-preparation` → `before-swap` → `after-swap` → `page-load` |
| A-15-02 | 同上 | 按住 Ctrl 点击链接、或链接带 `download`、或外链 | 不拦截，走浏览器默认行为；`data-astro-reload` 链接同样整页跳转 |
| A-15-03 | `prefetch.defaultStrategy: 'hover'`，链接设 `data-astro-prefetch="false"` | 悬停该链接 | 网络面板无该 URL 的预取请求；移除该属性后同一操作出现预取请求 |
| A-15-04 | 预取已开启，目标页离线或返回非 HTML | 点击链接 | 预取失败不抛未捕获异常；导航退化为整页跳转且目标页正常打开 |
| A-15-05 | 目标服务器在导航中途断开 | 点击链接 | 该次导航被丢弃并整页跳转，控制台无 unhandled rejection |
| A-15-06 | 设备开启"减少动态效果" | 打开含客户端路由组件的页面 | dev 下打印动画被禁用的警告，页面仍可导航，动画不播放 |
| A-15-07 | 开启 dev 工具栏并切到岛检查 app | 客户端导航到另一页 | 工具栏与浮层出现在新页面上，位置重新计算且交互正常 |
