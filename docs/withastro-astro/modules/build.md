---
title: 产物构建
description: "build 编排一次完整的产物生成：解析设定、发现路由、同步内容、装配适配器、打包客户端与服务端、逐页预渲染、资源落盘、写清单与缓存。它是唯一允许写产物目录的模块；与 server 的分界是：server 复用同样的编译与渲染能力，但不写产物、不跑适配器"
sidebar:
  order: 7
  label: 产物构建
draft: false
lastUpdated: 2026-11-04
---

## 7. Build

`build` 编排一次完整的产物生成：解析设定、发现路由、同步内容、装配适配器、打包客户端与服务端、逐页预渲染、资源落盘、写清单与缓存。它是**唯一允许写产物目录**的模块；与 `server` 的分界是：`server` 复用同样的编译与渲染能力，但不写产物、不跑适配器。

### 7.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 构建阶段机（发现 → 同步 → 打包 → 预渲染 → 落盘 → 完成） | 判定请求命中哪条路由（委托 `routing`） |
| 预渲染调度（静态路径、并行度、自定义预渲染器） | 组件语法转换（委托 `compile`） |
| 产物目录结构、文件名、资源指纹与清单 | 图片解码与格式转换（委托 `assets`） |
| 增量构建的判定、缓存读写与失效 | 内容条目的业务校验（委托 `content`） |
| 适配器钩子时序与 `astro:build:*` 事件 | 请求期响应（委托 `render`） |

### 7.2 Invariants

构建域的三条铁律决定"产物是否可发布"：

| 铁律 | 理由 | 违反后果 |
| --- | --- | --- |
| 写盘只发生在构建编排内 | 两处写盘会互相覆盖 | 产物混合新旧版本，清单与实际文件不一致 |
| 失败不写成功缓存 | 失败页被缓存会在下次被跳过 | 错误页被当作成功产物发布 |
| 同一目录同时只允许一个构建 | 并发写同一目录 | 文件被截断，清单损坏 |

恢复策略：失败运行保留上一次成功产物并标记未完成；重试时以设定指纹与文件依赖指纹判定需重建的页，成功后才更新成功标记。

### 7.3 Capabilities

构建分两段：**准备**与**产出**。准备段做五件事：运行 `astro:config:setup`（集成可改配置）、推导 `buildOutput`（`static` 或 `server`）、发现并排序路由、运行 `astro:config:done`（适配器在此 `setAdapter`，缺少适配器而需要按需渲染即 `NoAdapterInstalled`）、创建打包配置并同步内容。产出段先运行 `astro:build:start`，收集页面数据（每页的组件、参数集合、预渲染标记、依赖），再执行一次打包：客户端环境产出浏览器资源，服务端环境产出可被适配器调用的入口，预渲染环境在构建进程内渲染静态页。预渲染对每个 `getStaticPaths()` 的返回值逐页执行；未声明但被判定为静态的路由只渲染一次；声明了动态段却没有 `getStaticPaths()` → `GetStaticPathsRequired`；同一路径被两条路由产出 → `PrerenderRouteConflict`。渲染完成后统一落盘：HTML、客户端资源、预渲染资源、清单与构建缓存；随后运行 `astro:build:ssr`（若有服务端入口）与 `astro:build:done`（页面与资源清单）。增量构建以"设定指纹 + 文件内容指纹 + 上次页面元数据"判定哪些页可跳过；`--force` 或设定指纹变化时全量重建。构建摘要必须包含：输出模式、产物目录、页数、资源数、耗时；失败时必须包含首个失败页与稳定错误码。

### 7.4 Contracts

```ts
type BuildPhase = 'prepare' | 'discover' | 'sync' | 'bundle' | 'prerender' | 'emit' | 'done';

interface BuildRun {
  id: string;                          // 本次构建标识，写入日志与缓存元数据
  phase: BuildPhase;
  output: 'static' | 'server';
  outDir: URL;
  startedAt: number;                   // 毫秒时间戳
  pages: Map<string, PageBuildData>;   // 键为 pathname
  assets: Map<string, URL[]>;          // 源文件 → 产出 URL
  errors: Diagnostic[];                // 首个致命错误另存，决定退出码
}

interface PageBuildData {
  route: RouteRecord;
  pathname: string;
  prerender: boolean;
  component: string;
  dependencies: string[];              // 参与增量判定的文件
  lastBuiltAt?: number;                // 来自缓存，用于跳过判定
}

interface BuildOptions {
  force?: boolean;                     // 忽略增量缓存
  devOutput?: boolean;                 // 产出未压缩、便于调试的产物
  timings?: boolean;                   // 打印阶段耗时
  concurrency?: number;                // 预渲染并发上限，默认取 CPU 核数相关值
}

abstract class BuildOrchestrator {
  abstract run(options: BuildOptions): Promise<BuildRun>;
  abstract invalidate(paths: string[]): void;        // 供开发期复用，不触发落盘
}
```

约束：同一产物目录同时只允许一个构建写入（并发写会互相覆盖）；构建失败时不得把失败页写入缓存，避免下一次误跳过；`assets` 的键必须是源文件绝对路径，值必须是产物 URL，供集成与清单消费。

### 7.5 Flow

下面伪代码说明一次构建从设定到落盘的主干，覆盖缺适配器、静态路径缺失与页面冲突。

```ts
async function runBuild(inline: AstroInlineConfig, options: BuildOptions): Promise<BuildRun> {
  const settings = await resolveConfig(inline, 'build');
  const routes = await discoverRoutes(settings);
  if (settings.buildOutput === 'server' && !settings.config.adapter) {
    throw new AstroError(AstroErrorData.NoAdapterInstalled);
  }
  const content = await syncContent(settings);                 // 条目不合法则中止
  const run = createRun(settings, routes);
  await hook('astro:build:start');

  const pages = await collectPages(routes, { content });       // 每页参数与依赖
  const bundle = await bundleAll(pages, settings);             // 客户端 + 服务端 + 预渲染
  const prerenderer = settings.customPrerenderer ?? defaultPrerenderer(bundle);

  const pending = [...pages.values()].filter((page) => isDirty(page, run.id, options.force));
  await runWithConcurrency(pending, options.concurrency ?? 4, async (page) => {
    if (page.prerender && !page.route.pathname) {
      const paths = await page.route.getStaticPaths?.();
      if (!paths) throw new AstroError(AstroErrorData.GetStaticPathsRequired, { route: page.route.route });
      for (const path of paths) await prerenderer.render(path, page.route);
    } else {
      await prerenderer.render(page.pathname, page.route);
    }
  });

  await emitArtifacts(run, bundle);                            // HTML、资源、清单、缓存
  await hook('astro:build:ssr', { manifest: bundle.manifest });
  await hook('astro:build:done', { pages: [...run.pages.keys()], assets: run.assets });
  return { ...run, phase: 'done' };
}
```

失败处理：预渲染某页失败立即标记该页为失败并中止后续同批作业；已成功页可保留但整体退出码为 1，且摘要明确指出"未完成"；`--force` 只影响增量判定，不放宽任何校验。

幂等与恢复：构建以运行 ID 隔离中间产物，重跑只重建指纹变化的页；失败运行不更新成功标记，也不覆盖上一次成功的产物清单。

### 7.6 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-7-01 | 纯静态项目 | `astro build` | 产出 `dist/`；每页有 HTML；`_astro/` 下资源带内容指纹 |
| A-7-02 | `output: 'server'` + 适配器 | `astro build` | 产出客户端与服务端两部分；适配器入口文件存在且可被宿主导入 |
| A-7-03 | 动态路由未实现 `getStaticPaths()` | `astro build` | 失败并返回 `GetStaticPathsRequired`，指出路由文件 |
| A-7-04 | 两条路由产出同一路径 | `astro build` | 失败并返回 `PrerenderRouteConflict`，列出冲突双方 |
| A-7-05 | 连续两次构建、源码未变 | 第二次 `astro build` | 跳过未变页；摘要显示复用页数；产物内容一致 |
| A-7-06 | 修改一页依赖 | 再次构建 | 只重建该页与其依赖页，其余复用缓存 |
| A-7-07 | 集成在 `astro:build:done` 抛错 | 构建 | 退出码 1，错误含集成名；不误报"构建完成" |
| A-7-08 | 构建中途失败 | 再次执行构建 | 上一次成功产物与清单保持不变，摘要标记本次未完成 |
| A-7-09 | 同一产物目录并发两次构建 | 同时启动 | 第二个被拒绝并说明占用，不产生交叉写入 |
