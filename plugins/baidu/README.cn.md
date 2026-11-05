# @veren/baidu-pan（百度网盘）

给 DSH 的百度网盘原生操作能力——Agent 与人都算：十三个模型工具（`baidu_pan__*`）覆盖浏览、检索、整理、分享、上传与下载，全部经 guard 模块 confined 在应用授权根内；内置技能携带风险分级与确认纪律；粘贴授权码的 OAuth 登录流保证令牌只进凭据库。网页客户端面板（`baiduPan` 远端命名空间）让人类操作者从侧栏直接做同样的操作——登录、浏览、分享、传输。本包是 [design/](./design/index.md) 设计方案的 DSH 移植——client/guard/bridge/skill 四个模块收敛为一个插件，命令行与二进制分发被 DSH 工具面取代，设计第 8–13 章的视图以面板形态延续。

什么时候用：部署里的 Agent 需要操作真实百度网盘账号，或部署里的人需要一个直接面板——列目录、检索、在本地与网盘之间搬运文件、整理目录、创建分享链接、查容量。什么时候不用：部署永不触碰百度网盘；或需求是第三方分享转存、文档正文提取——这两样在官方开放平台之外（网页 cookie 端点 / SVIP 门槛），本版本**不覆盖**。

## 工具清单

- tool: `baidu_pan__whoami` — 已登录账号与会员等级（只读）
- tool: `baidu_pan__quota` — 总量/已用/剩余与到期提示（只读）
- tool: `baidu_pan__list` — 根内单目录列举，排序与分页（只读）
- tool: `baidu_pan__search` — 文件名关键字检索，可限定目录（只读）
- tool: `baidu_pan__meta` — 1–100 个 fsid 的元数据，含下载直链（只读）
- tool: `baidu_pan__mkdir` — 建目录，支持多级（写入）
- tool: `baidu_pan__copy` — 复制到目标目录，同名冲突按失败（写入）
- tool: `baidu_pan__move` — 移动到目标目录，同名冲突按失败（写入）
- tool: `baidu_pan__rename` — 原地重命名，只收裸名称（写入）
- tool: `baidu_pan__delete` — 不可逆删除，`confirm_paths` 凭证须与目标集合完全一致（危险）
- tool: `baidu_pan__share` — 私密分享链接，带提取码与有效期（写入）
- tool: `baidu_pan__upload` — 本地文件 → 授权根，4 MiB 分片、秒传感知，覆盖须用户事先同意（写入）
- tool: `baidu_pan__download` — 授权根文件 → 本地工作区或绝对路径，失败清理半成品（本地写入）

技能：`baidu-pan`——内置行为纪律：触发判定、读/写/危险三级风险、确认次序、显示路径与链接透传规则、按错误码决定的失败处理。

## 网页面板

插件挂载 `baiduPan` 远端命名空间（服务 `baiduPanGateway`，同一个 apply 注册）与客户端入口（`./client`），在侧栏注册一个面板。三个页签：

- **概览**——登录状态（账号、有效期、会员类型）、容量卡，以及粘贴授权码登录向导：匿名用户打开授权链接、把授权码粘贴回来，换取/在线校验/落库全链在面板内完成——不需要 agent。
- **文件**——授权根内的面包屑浏览、本地排序与筛选、带分页的关键字检索；行内操作：打开、分享（选有效期，回链接+提取码卡）、下载、重命名、复制/移动、复制路径，删除走恰好集合确认弹层。上传收本地绝对路径，同名冲突给出显式覆盖按钮。
- **传输**——上传/下载任务以"受理后轮询"的任务卡呈现（running 在前），另有独立下载表单。任务只承诺"已提交"；完成与否看任务状态。

面板的读写与工具走同一套守门：越界路径本地拒绝、删除要求恰好路径凭证、领域失败携带稳定 `BDPAN_*` 码进错误块。设计的四态（加载/空/失败/无权限）逐视图覆盖。

## 安装与登录

1. 在[百度网盘开放平台](https://pan.baidu.com/union/doc)控制台创建应用，取得 `appKey`/`secretKey`。
2. 把插件挂到 profile：

   ```bash
   dsh web --patch plugins/baidu/cordis.patch.yml
   ```

   patch 行携带 `appKey`/`secretKey` 与授权根 `root`（缺省 `/apps/bdpan`）。`appKey`/`secretKey` 是应用级凭据，写在 profile 配置里是明文；OAuth 用户令牌是另一级，只进凭据库。
3. 登录有两条路：走宿主的授权入口（授权流打开百度授权页——oob 形态，无回调服务——粘贴授权码回来，换取令牌、经账号资料在线校验后才落库；第二个方法接受已有的 `access_token refresh_token` 令牌对），**或**直接在网页面板的概览页签里走同一条粘贴授权码链路。
4. 未登录时所有工具一律以 `BDPAN_AUTH_REQUIRED` 拒绝，面板显示登录引导。

## 安全模型

- 路径出网前先本地归一：穿越（`..`、编码形态、`~`、平台陷阱）与越界路径一律本地拒绝、不发请求（`BDPAN_PATH_OUT_OF_SCOPE`）。
- 删除需要凭证：归一化后的路径集合必须与目标集合完全一致——多、少、错任何一项都以 `BDPAN_CONFIRM_REQUIRED` 打回；确认永不沿用。
- 令牌到期前自动刷新，失效错误号重放一次；刷新失败即要求重新授权，不静默降级。
- 日志与诊断统一脱敏；令牌不进配置文件、日志与命令行。
- 上传的创建一步绝不盲目重试：网络失败折成 `BDPAN_OUTPUT_UNCERTAIN`，由调用方先核实远端状态。

## 本版本边界

- 第三方分享转存未实现——开放平台不暴露该能力；设计方案里相关上游错误号属于网页 cookie 体系。
- 文档正文读取（`get-content`，SVIP 门槛的 docparse）未实现。
- 设计方案的 `memory`（记忆备份）与 `delivery`（安装分发）模块不在范围内：DSH 取代了 CLI 分发，记忆备份按设计自查结论留作后续模块。

## 开发

```bash
pnpm install
pnpm --dir plugins/baidu run typecheck   # tsc ×2（Node 半边 + 客户端半边）
pnpm --dir plugins/baidu test            # vitest 单测（76 条）
pnpm --dir plugins/baidu run build       # dist/ + lib/client.js
```

设计契约见 [design/index.md](./design/index.md)；`src/` 按其模块边界组织（`guard`、`client`、工具面、`skill`、网页 `gateway`），`tests/guard.spec.ts` 逐条执行设计的 GD 验收行，`tests/remote-arity.spec.ts` 钉死客户端↔网关的线上契约，`tests/panel-dialect.spec.ts` 按设计令牌纪律审计面板样式表。
