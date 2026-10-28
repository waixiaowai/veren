# OpenCode Go 桥接插件：设计与取证记录

**状态**：已实现，单测全绿（25/25），typecheck 通过；待稳定节点真机验收与发布。
English: [opencode-go-plugin.md](opencode-go-plugin.md)

## 0. 一句话

`@veren/opencode-go` 把 OpenCode Go 订阅做成 dsh 一等模型路由：引导式登录授权流（经 `ctx.authorization` + `ctx.credentials` 缝）+ 专用 provider 适配器（经 `ctx.llm` 适配器 SPI，OpenAI 兼容 wire 指向 `opencode.ai/inference/go`）。

## 1. 取证结论（2026-10-28，全部一手证据）

| 问题 | 结论 | 证据 |
|---|---|---|
| v2 的鉴权方式 | **无 OAuth/设备码**。官方通道 = 在 `https://opencode.ai/auth` 页面创建 API key 后粘贴。CLI 的登录提示原文（自 1.19.2 二进制内嵌 JS 提取）："Create an api key at https://opencode.ai/auth" | opencode.exe 字符串取证；本机 `auth.json` 两个条目均为 `type:"api"` + 51 字符 key |
| "控制台找不到 key" | v2 控制台（/console）不再展示 key；建 key 入口是 /auth 页面 | 用户实报 + 官方 v2 文档只写 console 订阅流程 |
| 白名单/客户端封锁 | **持 key 用户 + 诚实 UA 完全放行**。以非 opencode UA 实测：`GET /inference/go/v1/models` → 200 全目录；`POST /inference/go/openai/v1/chat/completions`（deepseek-v4.1-flash）→ 200 真实补全 | 2026-10-28 活性探测（真实 go key） |
| 端点形状 | 目录：`/inference/go/v1/models`（标准 OpenAI list）；对话：`/inference/go/openai/v1/chat/completions`；每对话须带 `x-opencode-session`；官方文档声明多协议互译 | v2 官方文档 + 实测 |
| 配额面 | 响应 `usage.opencode = { billing_source:"go", list_cost, allowance, tokens{…} }` | 实测响应体 |
| 客户端身份 | `x-opencode-session` + 诚实 UA（文档点名要求非通用 SDK 名） | v2 官方文档 |
| DSH 侧既有能力 | pi-ai 已收录 opencode-go（models.dev 目录，baseURL 已落后为 /zen/go），其 api-key 登录流只支持"粘贴"（v2 已无 key 可粘）——这就是本插件要补的缺口 | pi-ai 1.1.0 dist 取证 |
| 凭据语法 | 凭据记录 `<scope>/<id>`：`opencode-go/account` 合法（小写连字符段）；api-key 记录形状 `{kind:'api-key', key}` | dsh-credentials / llm-pi-ai auth.ts |
| 授权缝规则 | 每凭据 key 唯一流程（`DUPLICATE_FLOW`）；流程 resolve 前必须提交记录（`NOT_COMMITTED`） | dsh-authorization 源码 |

## 2. 架构

```
登录授权流（ctx.authorization.registerFlow）
  方法一 console-key：notify(/auth 入口) → prompt(粘贴) → GET /models 在线校验 → 提交记录
  方法二 import-local-cli：只读 ~/.local/share/opencode/auth.json 的 opencode-go 条目
        ↓ commit {kind:'api-key', key} → opencode-go/account 记录（credentials-local 持久化）
专用适配器（ctx.llm.registerAdapter(['opencode-go'], adapter)）
  stream(): requireStoredKey → translateRequest → fetch(chat/completions) → SSE 聚合 → StreamChunk
  listModels(): 未登录=空（登出门面）；已登录=静态快照 + 在线目录定序增补（后台保鲜）
```

关键决策：

- **不复用 pi-ai 路由**：pi-ai 的流已被它的粘贴式流程占用（DUPLICATE_FLOW），且其目录 baseURL 落后于 v2。专用适配器持有 v2 正门、配额语义与门面语义。
- **不发明新机制**：凭据、授权、目录缓存、401 不清登录——全部映射 llm-deepseek-account 先例。
- **key 卫生**：key 只存在于凭据记录与请求头，不进配置、不进日志；本机导入严格只读。

## 3. 契约

- **请求头**：`Authorization: Bearer`、`x-opencode-session`（`GenerateOptions.sessionId`，缺省落进程稳定匿名值）、harness 归因头（harness 拥有的名字赢 UA 碰撞，即面向网关的诚实身份）。
- **错误映射**：401→`KEY_INVALID`（不清登录）、402→`QUOTA_EXCEEDED`、403→`ROUTE_FORBIDDEN`、其余→`UPSTREAM_ERROR`(status)；未登录请求→`SIGN_IN_REQUIRED`。
- **usage 折算**：TokenUsage 计数不相交——`inputTokens = prompt_tokens − cached − cache_write`；`reasoning_tokens` 单列。
- **块序**：reasoning 块先行（DeepSeek 系网关形态）→ 文本 → 工具调用（wire index 聚合）；流必以一个 finish 终局（abort → `aborted`）。
- **目录合并**：静态快照（30 模型，pi-ai 数据生成）为体；在线目录只定序与增补，不收缩；拉取失败保旧目录。

## 4. 测试地图（25 用例全绿）

| 文件 | 覆盖 |
|---|---|
| `tests/stream.spec.ts` | 真实网关 SSE 形态红绿、工具聚合、usage 折算扣缓存、abort 终局、带内 error、并发隔离 |
| `tests/wire.spec.ts` | role 分派、reasoning 不可回放、工具回放、头组成、错误映射 4 态 |
| `tests/adapter.spec.ts` | mock 网关全链路（凭据→头→翻译→SSE）、未登录门面、401 不清登录 |
| `tests/auth-flow.spec.ts` | 校验通过才提交、401 零落库、本机导入条目形状严格校验（临时路径注入） |
| `tests/catalog.spec.ts` | 目录合并、未知 id 透传、容量元数据（mock 网关，不触真网关） |

## 5. 验收协议（外部裁决）

自动化部分已过；以下按 AGENTS 稳定节点流程人肉执行：

1. **门禁**：根目录 `pnpm check:plugins`、`pnpm check:entries` 通过（随 CI）。
2. **安装**：稳定节点 web profile 装 `@veren/opencode-go`（`dsh plugin --profile web add plugins/opencode-go`，或并入组合包），`DSH_HOME` 指向 `deepseek\.dsh`。
3. **登录漏斗**：Models 页/授权面发起 OpenCode Go 登录，走方法一（/auth 建 key 粘贴）——通过标准：通知给出精确 /auth 入口；粘贴后在线校验；凭据库出现 `opencode-go/account`。
4. **真实对话**：会话选 `opencode-go/deepseek-v4.1-flash` 问一道有确定答案的题——通过标准：答案正确、会话日志出现 reasoning 块、`usage.opencode.billing_source == "go"` 且套餐配额被真实消耗。
5. **同 key 对照**：同一问题在 opencode CLI（go 模型）与本路由各答一次均通。
6. **错误态**：登出后请求 → Models 页空 + `SIGN_IN_REQUIRED`；手工改坏 key → `KEY_INVALID` 且登录记录仍在。

## 6. 边界与后续

- v1 文本面：图片/文件投影为占位文本（网关原生支持图片，attachment 解析留给 v2）。
- `reasoning_effort` 暂不下发（网关默认）；`replayState` 未填充。
- 组合包/市场归属（并入 app-host-bundle 或独立上架）按发布流水线另行决策。
