---
title: 本地服务
description: "server 把编译与渲染接到本地端口上，并在同一个进程里维护三样附加能力：热更新、错误覆盖层、开发者界面宿主。它不拥有路由、编译或渲染规则；与 build 的分界是：server 只产出内存中的响应，产物落盘永远属于 build"
sidebar:
  order: 8
  label: 本地服务
draft: false
lastUpdated: 2026-11-04
---

## 8. Server

`server` 把编译与渲染接到本地端口上，并在同一个进程里维护三样附加能力：热更新、错误覆盖层、开发者界面宿主。它不拥有路由、编译或渲染规则；与 `build` 的分界是：`server` 只产出**内存中的响应**，产物落盘永远属于 `build`。

### 8.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 监听地址/端口、开放浏览器、允许的主机名 | 解析项目设定（委托 `config`） |
| 开发期请求分发（静态资源、页面、端点、内部通道） | 页面渲染语义（委托 `render`） |
| 文件变化 → 模块失效 → 热更新载荷 | 产物目录与清单（委托 `build`） |
| 编译失败 → 覆盖层载荷；恢复后清除 | 审计规则与工具栏业务逻辑（委托开发者界面自身） |
| 后台服务器的锁文件、`logs`/`status`/`stop` 管理 | 语言服务器与编辑器诊断（委托 `tooling`） |

### 8.2 Capabilities

启动阶段创建三套环境（浏览器、服务端、预渲染）并把同一份路由与渲染器注入；随后按需加载集成与开发者界面应用，最后监听端口并输出可用 URL。请求阶段先交给资源与模块请求处理，再进入页面/端点渲染；内部路径（动作、图片、Server Islands、工具栏通道）走各自处理器，不与用户路由混淆。文件变化时只失效受影响模块：模板变化产出局部更新，样式变化只替换样式，配置或路由结构变化触发整页重载；编译失败时生成覆盖层载荷（码、标题、提示、栈、源码位置），服务器保持运行，修复后自动清除。后台模式把服务器进程与锁文件绑定：`--background` 启动后立即返回，`logs`/`status`/`stop` 通过锁文件定位同一实例；`--force` 替换已有实例，`--ignore-lock` 明确表示"不登记、不管理"。当运行环境被判定为自动化代理时，默认以后台方式启动，避免阻塞调用方（待确认：该判定是否应可通过环境变量显式关闭）。预览模式优先使用适配器提供的预览入口；没有适配器时以内置静态服务器提供产物目录，并对未知路径返回 404 而不是回退到开发期行为。

### 8.3 Contracts

```ts
interface DevServerOptions {
  config: ResolvedSettings;
  host: string | boolean;            // true 表示监听所有网卡
  port: number;                      // 默认 4321；占用时按策略递增
  open: string | boolean;            // true 或具体路径
  background: boolean;               // 写入锁文件并以子进程运行
  force: boolean;                    // 替换已有实例
  ignoreLock: boolean;               // 与 background/force 互斥
}

interface DevServerHandle {
  url: string;                       // 形如 http://localhost:4321
  pid: number;
  close(): Promise<void>;            // 幂等；关闭后锁文件被移除
}

interface DevLockFile {
  pid: number;
  url: string;
  cwd: string;
  startedAt: number;                 // 毫秒时间戳
  astroVersion: string;
}

interface OverlayPayload {
  code: string;                      // 稳定错误码，如 UnknownCompilerError
  title: string;
  hint?: string;
  stack: StackFrame[];               // 每帧含文件、行、列、是否应用内
  location?: { file: string; line: number; column: number };
}

type DevEvent =
  | { type: 'update'; modules: string[] }
  | { type: 'reload'; reason: 'config' | 'route-tree' | 'manual' }
  | { type: 'error'; payload: OverlayPayload }
  | { type: 'toolbar'; event: string; payload: unknown };   // API-04 通道

abstract class LocalServer {
  abstract start(options: DevServerOptions): Promise<DevServerHandle>;
  abstract notify(event: DevEvent): void;          // 不阻塞文件监听
  abstract status(): Promise<DevLockFile | null>;
  abstract stop(pid: number): Promise<boolean>;
}
```

约定：`close()` 必须释放端口、关闭长连接并移除锁文件，重复调用不抛错；`status()` 遇到陈旧锁文件（进程不存在）时返回 `null` 并清理；`notify` 的每个事件都必须可被客户端幂等处理，重放不会产生重复脚本。

### 8.4 Flow

下面伪代码说明开发服务器从启动到一次文件变化的分发，覆盖配置重启与编译失败两条分支。

```ts
async function startDevServer(options: DevServerOptions): Promise<DevServerHandle> {
  const existing = options.ignoreLock ? null : await readLockFile(options.config.config.root);
  if (existing && !options.force) return await attachToExisting(existing);   // 复用同一实例
  const environments = await createEnvironments(options.config);              // client / server / prerender
  const server = await listen(environments, options);                        // 端口占用时尝试下一个
  const handle = { url: server.url, pid: process.pid, close: () => shutdown(server) };
  if (options.background) await writeLockFile(toLockFile(handle, options));
  await hook('astro:server:setup', { server });
  await hook('astro:server:start', { address: server.address });
  return handle;
}

async function onFileChange(path: string, server: DevServerState): Promise<void> {
  const affected = server.graph.dependentsOf(path);
  if (isConfigFile(path) || isRouteStructureChange(path)) {
    server.notify({ type: 'reload', reason: isConfigFile(path) ? 'config' : 'route-tree' });
    return;
  }
  try {
    const result = await server.compiler.compile({ filePath: path, mode: 'dev' });
    server.notify({ type: 'update', modules: affected });
    server.broadcast({ type: 'astro:hmr', result });                        // 浏览器替换模块
  } catch (error) {
    server.notify({ type: 'error', payload: toOverlayPayload(error) });      // 覆盖层，不退出
  }
}
```

失败处理：端口被占用且不可递增 → 启动失败并给出端口与 `--port` 建议；配置变化后重启失败 → 保留旧服务器继续服务，覆盖层提示新配置的错误；后台子进程启动失败 → 不写锁文件并返回非 0 退出码；`stop` 遇到无权限终止的进程 → 返回失败原因而不是静默成功。

### 8.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-8-01 | 端口空闲 | `astro dev` | 输出可访问 URL；打开后页面渲染成功；进程保持前台 |
| A-8-02 | 已有开发服务器在运行 | `astro dev --background` | 不重复启动；`dev status` 报告同一 PID 与 URL |
| A-8-03 | 修改页面模板 | 保存文件 | 浏览器局部更新；不整页刷新；工具栏在新内容上重建 |
| A-8-04 | 故意写入语法错误 | 保存文件 | 覆盖层展示文件名、行列与提示；服务器仍可响应其他页面 |
| A-8-05 | 修改 `astro.config.mjs` | 保存文件 | 触发配置重启；若新配置非法，旧服务继续可用并提示错误 |
| A-8-06 | `astro dev stop` 后 | `astro dev status` | 返回"未运行"，陈旧锁文件被清理 |
| A-8-07 | `output: 'server'` 且已构建 | `astro preview` | 由适配器预览入口提供服务；未知路径返回 404 而非开发期回退 |
