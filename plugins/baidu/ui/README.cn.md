# @veren/baidu-pan-ui（百度网盘面板）

DSH 的百度网盘**网页面板**：一个侧栏入口加三个页签，把 `@veren/baidu-pan` 工具给 agent 的能力同样交到人手里。

什么时候用：DSH web 部署已经跑了 `@veren/baidu-pan`，而操作者需要图形入口——登录、浏览、分享、传输。什么时候不用：部署是纯无头的，或者只要工具就够。

## 三个页签

- **概览**——登录状态（账号、有效期、会员类型）、容量卡，以及粘贴授权码的登录向导：匿名用户打开授权链接、把授权码粘回来，换取 → 在线校验 → 落库全链在面板内完成，不需要 agent。
- **文件**——授权根内的面包屑浏览、本地排序与筛选、带分页的关键字检索；行内操作：打开、分享（选有效期，回链接+提取码卡）、下载、重命名、复制/移动、复制路径，删除走"恰好集合"确认弹层。上传收本地绝对路径，同名冲突给出显式覆盖按钮。
- **传输**——上传/下载任务以"受理后轮询"的任务卡呈现（running 在前），另有独立下载表单。任务只承诺"已提交"，完成与否看任务状态。

面板的读写与工具走同一套守门：越界路径本地拒绝、删除要求恰好路径凭证、领域失败携带稳定 `BDPAN_*` 码进错误块。每个视图都覆盖设计的四态（加载 / 空 / 失败 / 无权限）。

## 形态

这是一个**纯客户端包**，与 `@veren/im-ui`、`@veren/mail-ui` 同形：

- `./`（`dist/index.js`）是空的 `apply`——它存在的唯一理由，是让 Web 应用（扫描**活跃 Loader 条目**的 manifest）看见本包的 `dsh.client` 声明。
- `./client`（`lib/client.js`）是浏览器产物：挂载宿主的 `baiduPan` 远端命名空间、注册侧栏入口与主面板、登记语言字典、安装样式表。

产物里对外的 `require` 只有 `react`、`react/jsx-runtime`、`zod`——外壳恰好只 seed 这三个。运行时再引别的客户端包会让模块物化失败，整个面板会被静默丢弃。

面板的设计契约在 [`../design/`](../design/index.cn.md)：第 9 章（令牌、间距、动效、文案）、第 10–11 章（基础与复合组件）、第 12–13 章（业务组件与页面）。

## 安装

通过组合包安装，它会同时插入服务端那一行：

```bash
dsh plugin --profile web add @veren/baidu-pan-bundle
```

## 开发

```bash
pnpm --dir plugins/baidu/ui run typecheck   # tsc ×2（Node 半边 + 客户端半边）
pnpm --dir plugins/baidu/ui test            # vitest：语言表、样式方言、线上契约
pnpm --dir plugins/baidu/ui run build       # dist/index.js + lib/client.js
```

`tests/remote-arity.spec.ts` 钉死客户端↔网关的线上契约（方法名、命名空间、服务名、参数个数），`tests/client-locales.spec.ts` 审计双语字典，`tests/panel-dialect.spec.ts` 强制样式表的令牌纪律。
