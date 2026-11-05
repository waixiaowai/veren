---
title: 资源优化
description: "Assets 拥有 图片与字体从源文件变成可交付 URL 的全部决策——格式、尺寸、质量、产物路径、响应头；它不拥有路由表、不拥有内容数据，也不决定页面何时被渲染"
sidebar:
  order: 9
  label: 资源优化
draft: false
lastUpdated: 2026-11-04
---

## 9. Assets

Assets 拥有"图片与字体从源文件变成可交付 URL"的全部决策——格式、尺寸、质量、产物路径、响应头；它不拥有路由表、不拥有内容数据，也不决定页面何时被渲染。

### 9.1 Duties

| 维度 | 内容 |
| --- | --- |
| 输入 | `image.*` 与 `fonts` 配置；ESM 导入的 `ImageMetadata`（`src`/`width`/`height`/`format`）；远程图片 URL；`Image`、`Picture`、`getImage()` 的变换参数 |
| 输出 | 图片字节与 URL（`/_image?...` 或构建期落盘的静态文件）、`srcset` 值、`img` 元素附加属性、`@font-face` CSS 与字体文件、`CssVariable` 联合类型 |
| 不负责 | 路由匹配与优先级（[路由表](/design/modules/routing/#44-contracts)）；集合条目的数据校验（[内容层](/design/modules/content/#103-contracts)）；请求管线与响应收尾（[请求渲染](/design/modules/render/#65-flow)）；产物目录结构（[产物构建](/design/modules/build/#73-capabilities)） |
| 相邻模块 | 上游是 [配置解析](/design/modules/config/#33-contracts)（产出规范化 `image`、`fonts`）；下游是构建与渲染，二者只消费 `getImage()` 返回的 URL 与属性 |
| 数据所有权 | 拥有图片/字体的**产物清单**（`AssetsGlobalStaticImagesList`）与变换哈希；不拥有任何业务数据 |
| 决策权 | 独占三项决策：某个源是否允许处理（`domains`/`remotePatterns`）、用哪个 service（`build` 与 `runtime` 可不同）、输出什么格式与尺寸 |

### 9.2 Capabilities

Assets 以"服务（service）可替换、端点（endpoint）可替换"的方式工作：`image.service` 接受单个 `{ entrypoint, config }` 或 `{ build, runtime }` 双目标（7.4 起），默认 `astro/assets/services/sharp`；服务分两类——实现 `transform` 的 `LocalImageService` 由 Astro 的图片端点驱动，只提供 `getURL` 的外部服务 `ExternalImageService` 交给图片 CDN。渲染期 `getImage()` 先做选项校验与默认值归一（默认输出 `webp`、`fit` 默认 `cover`），再经 `validateOptions`→`getURL`/`getSrcSet`/`getHTMLAttributes` 得到结果；`Image`、`Picture` 两个组件只是它的外壳。请求期默认端点路由为 `/_image`（`image.endpoint.route`），入口按模式选择：dev 用 `astro/assets/endpoint/dev`，build 用 `astro/assets/endpoint/generic`，用户可整体替换；该路由以 `prerender: false` 注入到路由表首位。

- **远程图片白名单**：`image.domains` 与 `image.remotePatterns`（`protocol`/`hostname`/`port`/`pathname`，支持 `**.`、`*.`、`/**`、`/*` 通配）共同决定是否代取；重定向会被跟随，且最终地址也必须在白名单内。
- **响应式布局**：`layout` 取 `constrained`/`fixed`/`full-width`/`none`，由 `widths` 或 `densities` 生成 `srcset`（两者互斥），断点取内置分辨率表；`image.responsiveStyles` 决定是否注入配套全局样式。
- **SVG**：默认不进入优化管线（`image.dangerouslyProcessSVG` 默认 `false`），只有显式开启后才走 `svgo` 优化器，优化器抛错即 `CannotOptimizeSvg`。
- **静态图片清单**：构建期只写"渲染中实际收集到"的变换产物，键为原图路径 + 变换哈希；增量构建可把跳过的页面用 `SerializedStaticImage` 回放进清单。
- **字体**：顶层 `fonts` 配置（早期以 `experimental.fonts` 提供，7.4.5 已稳定）按家族声明 `provider`/`name`/`cssVariable`/`fallbacks` 等；内置提供方含 `google`、`fontsource`、`local`，以及 `adobe`/`bunny`/`fontshare`/`googleicons`/`npm`；`Font` 组件输出 `@font-face`，`astro sync` 生成 `CssVariable` 类型，dev 期由字体文件中间件提供字节。

| 失败条件 | 表现 | 触发点 |
| --- | --- | --- |
| 本地图片导入无法解析（文件被删或路径错） | `ImageNotFound` | 构建期资源插件 |
| 远程 URL 不在白名单（`inferSize` 路径） | `RemoteImageNotAllowed` | `getImage()` |
| 端点收到非白名单远程地址、跨源本地路径，或取不到源图 | HTTP 403 / 404 | `/_image` |
| 导入格式不在支持列表 | `UnsupportedImageFormat` | `verifyOptions()` |
| `sharp` 无法加载 | `MissingSharp` | service 首次调用 |
| SVG 优化器失败 | `CannotOptimizeSvg` | SVG 解析 |

### 9.3 Contracts

```ts
type ImageOutputFormat = 'avif' | 'png' | 'webp' | 'jpeg' | 'jpg' | 'svg';
type ImageLayout = 'constrained' | 'fixed' | 'full-width' | 'none';
type ImageFit = 'fill' | 'contain' | 'cover' | 'scale-down' | 'none';
type ImageQuality = 'low' | 'mid' | 'high' | 'max' | number; // number 取值 0–100
interface ImageTransformOptions {
  src: ImageMetadata | string;     // 本地必须为 ESM 导入结果
  width?: number;                  // px，整数
  height?: number;                 // px，整数
  format?: ImageOutputFormat;      // 缺省由源格式推导，最终默认 'webp'
  quality?: ImageQuality;
  fit?: ImageFit;                  // 缺省 'cover'
  position?: string;               // CSS object-position 语法
  background?: string;             // CSS 颜色，透明转不透明格式时使用
  layout?: ImageLayout;
  widths?: number[];               // 与 densities 互斥
  densities?: (number | `${number}x`)[];
  priority?: boolean;              // 置 true 时关闭懒加载
  inferSize?: boolean;             // 仅远程图，可省略 width/height
}
interface ImageServiceConfig { entrypoint: string; config?: Record<string, unknown>; }
type ImageServiceTargets = { build: ImageServiceConfig; runtime: ImageServiceConfig };
abstract class SharedImageService {
  abstract getURL(o: ImageTransformOptions, config: ResolvedImageConfig): string | Promise<string>;
  getSrcSet?(o: ImageTransformOptions, config: ResolvedImageConfig): UnresolvedSrcSetValue[];
  getHTMLAttributes?(o: ImageTransformOptions, config: ResolvedImageConfig): Record<string, string | number>;
  validateOptions?(o: ImageTransformOptions, config: ResolvedImageConfig): ImageTransformOptions;
  getRemoteSize?(url: string, config: ResolvedImageConfig): Promise<Pick<ImageMetadata, 'width' | 'height' | 'format'>>;
}
abstract class LocalImageService extends SharedImageService {
  abstract parseURL(url: URL, config: ResolvedImageConfig): ImageTransformOptions | undefined;
  abstract transform(input: Uint8Array, o: ImageTransformOptions, config: ResolvedImageConfig):
    Promise<{ data: Uint8Array; format: ImageOutputFormat }>;
  propertiesToHash?: string[];     // 缺省 src,width,height,format,quality,fit,position,background
}
type ImageService = LocalImageService | ExternalImageService; // External 仅实现 Shared 部分
interface GetImageResult {
  src: string;
  srcSet: { values: { url: string; descriptor: `${number}w` | `${number}x` }[]; attribute: 'srcset' };
  attributes: Record<string, string | number>;
  options: ImageTransformOptions;  // 归一后的值
  rawOptions: ImageTransformOptions;
}
interface FontFamilyConfig {
  provider: FontProvider;          // 内置或自定义
  name: string;
  cssVariable: `--${string}`;
  fallbacks?: string[];            // 缺省 ['sans-serif']
  weights?: Array<string | number>; // 缺省 ['400']
  styles?: Array<'normal' | 'italic' | 'oblique'>;
  subsets?: string[];              // 缺省 ['latin']
  formats?: Array<'woff2' | 'woff' | 'otf' | 'ttf' | 'eot'>; // 缺省 ['woff2']
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}
```

错误约定：契约方法一律**抛错**而非返回错误对象，抛出物为带稳定名字的 `AstroError`（上表中的错误码）；端点侧把"不允许"映射为 403、"取不到"映射为 404，二者都不泄漏源站细节。

### 9.4 Flow

伪代码用于说明三个入口的调用顺序与失败出口：渲染期 `getImage()`、请求期 `/_image`、构建期静态图片生成。

```ts
// 入口 1：渲染期，<Image>/<Picture> 与用户代码都走这里
async function getImage(o: ImageTransformOptions, cfg: ResolvedImageConfig): Promise<GetImageResult> {
  if (!o?.src) throw invalidOptionsError('src');                  // 选项缺失，不进入服务
  const service = await getConfiguredImageService();            // 记录一次，进程内复用
  let opts = await resolveSrc(o);                               // Promise<{default}> 先解包
  if (opts.inferSize && isRemote(opts.src)) {
    if (!isRemoteAllowed(opts.src, cfg)) throw new AstroError('RemoteImageNotAllowed');
    const size = await (service.getRemoteSize?.(opts.src, cfg) ?? inferRemoteSize(opts.src, cfg));
    opts.width ??= size.width; opts.height ??= size.height;     // 只补缺省，不覆盖用户值
  }
  opts = (await service.validateOptions?.(opts, cfg)) ?? opts;   // 默认格式/取整/清 layout
  const url = await service.getURL(opts, cfg);                   // 不合法源直接返回原 URL
  return { src: url, srcSet: service.getSrcSet?.(opts, cfg) ?? empty, attributes: service.getHTMLAttributes?.(opts, cfg) ?? {}, options: opts, rawOptions: o };
}

// 入口 2：GET /_image（默认路由；entrypoint 可替换）
async function handleImageRequest(request: Request, cfg: ResolvedImageConfig): Promise<Response> {
  const service = await getConfiguredImageService();
  if (!isLocalService(service)) return new Response('Not Found', { status: 404 });
  const transform = await service.parseURL(new URL(request.url), cfg);
  if (!transform?.src) return new Response('Forbidden', { status: 403 });
  if (isRemote(transform.src) && !isRemoteAllowed(transform.src, cfg)) return new Response('Forbidden', { status: 403 });
  const bytes = await loadImage(transform.src, cfg);             // 本地直读，远程带白名单代取
  if (!bytes) return new Response('Not Found', { status: 404 });
  const { data, format } = await service.transform(bytes, transform, cfg); // 失败向上抛
  return new Response(data, { headers: { 'Content-Type': `image/${format}`, ETag: etag(data) } });
}

// 入口 3：构建期，为已收集的变换生成静态文件
async function generateImages(collected: AssetsGlobalStaticImagesList, cfg: ResolvedImageConfig): Promise<void> {
  const service = cfg.service.build;                             // 与 runtime 可用不同实现
  for (const [src, { transforms }] of collected) {
    for (const [hash, { finalPath, transform }] of transforms) {
      if (await cacheHit(finalPath, hash)) continue;             // 命中即跳过
      const data = await service.transform(await readSource(src), { ...transform, src }, cfg);
      await writeFile(finalPath, data.data);                     // 只写被引用过的产物
    }
  }
}
```

### 9.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-9-01 | 配置 `image.remotePatterns: [{ hostname: '**.example.com' }]`；页面用图片组件（`Image`）并为远程图开启尺寸推断 | 执行 `astro build` | 构建成功；输出 `img` 元素带非零 `width`/`height`，`src` 指向构建期落盘的产物路径（`_astro/` 下，扩展名按推导出的格式）；产物目录内存在该图片文件 |
| A-9-02 | 同上但 `src` 为 `https://evil.test/x.png` | 执行 `astro build` | 构建失败，报 `RemoteImageNotAllowed`，提示中给出该 URL |
| A-9-03 | SSR 模式已启用并部署 | 直接请求 `GET /_image?href=https://evil.test/x.png&w=100` | 返回 403，响应体无源站内容，日志无重试记录 |
| A-9-04 | 配置 `image.layout: 'constrained'`、`image.responsiveStyles: true`；页面用图片组件（`Image`）指定宽度 800 | 执行 `astro build` | 产物 `srcset` 含多个 `800w` 级别的 `w` 描述符且无 `x` 描述符；页面样式表出现该布局对应的响应式规则 |
| A-9-05 | 项目未安装 `sharp`，`image.service` 使用默认值 | 渲染含图片组件的页面 | 构建失败，报 `MissingSharp` 并给出安装提示，不产生半成品产物目录 |
| A-9-06 | 配置 `fonts: [{ provider: fontProviders.google(), name: 'Roboto', cssVariable: '--font-roboto' }]` | `astro sync` 后执行 `astro dev` 并访问页面 | 生成 `fonts.d.ts` 中的 `CssVariable` 联合类型；页面内联 `@font-face`，字体文件请求返回 200 |
