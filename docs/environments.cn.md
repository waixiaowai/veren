# 多环境体系：测试 / 预发布 / 正式

> 一套 home = 一套环境。环境之间靠 `DSH_HOME` 物理隔离——storages、sessions、
> 凭据、pnpm store 全部不共享。本文是环境的职责边界与搭建方法的唯一权威。

## 一张表看懂

| | 测试（test） | 预发布（staging） | 正式（prod） |
| --- | --- | --- | --- |
| 回答的问题 | 「这个改动能不能跑？」 | 「这次发布敢不敢发？」 | 「用户今天用的好不好？」 |
| 位置（DSH_HOME） | `deepseek\.dsh` | `deepseek\.dsh-staging` | `~\.dsh`（桌面应用） |
| profile | `web` | `web`（home 级隔离，名字无关紧要） | `desktop` |
| 端口 | 3080 | 3100 | 桌面自管（运行时 54224） |
| 启动方式 | 源码直起（`dsh web`） | 源码直起（`dsh web`） | 桌面应用自启 |
| 插件来源 | registry `^2.0.x`，跟随每次发布 | registry **精确 pin**（发布列车版本） | 桌面插件市场（用户手动） |
| 数据 | 一次性，随时可清重建 | **长期保留、跨升级保留**（演练的核心资产） | 真实用户数据，神圣不可侵犯 |
| 谁可以动 | agent / 脚本随意折腾 | agent 可升级演练；清库需明确指令 | **禁止任何 CLI / 脚本触碰**（AGENTS.md 铁律） |
| 坏了怎么办 | 清库重来 | 回滚 pin 到上一版本重装 | 用户从市场装回旧版本 |

## 三条隔离铁律

1. **每套环境独立 DSH_HOME**——绝不共用。storages、sessions、凭据随 home 走。
2. **每套 profile 独立 `.npmrc` store-dir**——pnpm store 硬链接绝不跨环境
   （`package-import-method=copy` 加持，桌面 node_modules 不得出现任何路径共享）。
3. **凭据只许「从 `~/.dsh` 复制出去」，永不回写**——`.credentials.yaml` 与
   `//npm.veren.top/:_authToken` 都按此方向复制，token 绝不写进任何入库文件。

## 晋升流水线（一个版本的生命周期）

```
workspace 改动
  → 门禁：vitest + typecheck + check:* 全绿
  → node market/release.mjs 发布到 https://npm.veren.top/
  → 【测试环境】^2.0.x 自动跟随，冒烟（起服务 + 一轮 GUI 探针）
  → 【预发布环境】把 pin 改到该版本，install，重启，
      跑 AGENTS.md「真机验证清单」，在长期数据上验证升级路径
  → 通过 → 在 RELEASE-NOTES.md 签发（日期 / 版本 / harness commit / 清单结果）
  → 【正式环境】用户在桌面插件市场里点更新——agent 的工作到此为止
```

不通过 → 预发布环境把 pin 回滚到上一版本重装，修复后重新走一遍。

## 各环境详解与搭建方法

### 测试环境（test）——已有，不重建

日常开发验证、自动化测试、无人化验收的实验区。坏了就清库重建，所以它可以
（也应该）跑最激进的变更。全部命令与注意事项见 AGENTS.md「稳定测试节点」
一节，那里是它的唯一权威定义。

**一个必须知道的边界**：插件版本 pin 管不到宿主——两个环境都用
`deepseek/deepseek-harness` 源码直起，harness 侧的改动（如事件转发白名单）
对测试与预发布**同时生效**。涉及宿主行为的验收，签发时必须记录 harness
commit（`git -C deepseek/deepseek-harness rev-parse --short HEAD`）。

### 预发布环境（staging）——一次性搭建

作用：发布演练。用「将要发布的精确版本」在「长期保留的数据」上走完整升级
路径与验收清单——它是签发的舞台，签发之前的最后一道闸。

**搭建（一次性，约两分钟）：**

```bash
# 1. 生成 home：目录骨架 + 凭据只读副本 + 专用 .npmrc（独立 store + token）
node scripts/env-init.mjs --home deepseek/.dsh-staging --port 3100

# 2. 首次启动（创建 profile 骨架）
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3100 --no-open

# 3. 安装发布列车版本（精确 pin，走正规插件-add 流程：兼容检查 + bundle patch 行）
cd deepseek/deepseek-harness
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add \
  @veren/app-host-bundle@2.0.10 @veren/task-workbench@2.0.10

# 4. 重启生效，看启动日志无激活错误、探针 401
```

**升级演练（每次发布后）：**

```bash
# 记录当前版本（profiles/web/package.json 的 @veren 区间）→ 改 pin 到新版本
# → pnpm install（profile 目录内，.npmrc 已指向专用 store）→ 重启
# → 跑 AGENTS.md「真机验证清单」七条 → RELEASE-NOTES.md 签发或回滚
```

签发记录落在 `deepseek/.dsh-staging/profiles/web/RELEASE-NOTES.md`（追加式）：
日期、版本矩阵、harness commit、清单逐条结果、结论（签发/回滚 + 原因）。

### 正式环境（prod）——不搭建、不触碰

正式环境就是**桌面应用本身**（`~/.dsh`，profile desktop）。它不需要我们搭建
——它的数据是用户每天的真实工作，它的升级路径只有一条：**用户在桌面插件市场
里自己操作**。agent 与脚本对它的完整职责边界：

- 允许：**只读**（读它的 `.npmrc` 取 token、读凭据做副本的源头）
- 禁止：`dsh plugin` 任何写操作、直接改文件、起停它的进程——铁律见 AGENTS.md
  「特别注意」节；搞错 DSH_HOME 等于自杀

## 端口分配

| 端口 | 用途 |
| --- | --- |
| 3080 | 测试环境（稳定节点） |
| 3100 | 预发布环境 |
| 3200 | 预留（压测 / 长稳 soak，需要时按 staging 同法再建一套 home） |
| 54224 | 桌面运行时（自管，勿动） |

## 常用命令速查

```bash
# 测试环境（日常）
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3080 --no-open

# 预发布环境（发布演练）
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3100 --no-open

# 发布（幂等；已发布版本自动跳过）
node market/release.mjs

# 新环境初始化（任何名字）
node scripts/env-init.mjs --home deepseek/.dsh-<名字> --port <端口>
```
