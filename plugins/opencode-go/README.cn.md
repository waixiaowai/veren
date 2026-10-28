# @veren/opencode-go

[English](README.md) | 中文

## 摘要

把 OpenCode Go 订阅计划变成 dsh 的一等模型路由。插件注册专用的 `opencode-go` provider 适配器（OpenAI 兼容 wire，指向 `https://opencode.ai/inference/go`），并提供引导式登录授权流，经 harness 的授权缝与凭据缝拿到计划 API key。部署持有 OpenCode Go 订阅时使用；没有订阅时跳过。

## 使用

1. **挂载**：把插件加进 profile（见 `cordis.patch.yml` 的 overlay 示例，或加入组合包）。
2. **登录**：在 dsh 的授权界面（Models 页 / 设置）发起，两个方法：
   - **opencode.ai/auth** —— 授权流给出 `https://opencode.ai/auth` 入口（v2 控制台已不再展示 key，建 key 就在这个页面），粘贴 key 后插件先在线校验（`GET /models`），通过才落库。
   - **本机 CLI 导入** —— 本机 opencode CLI 已用 Go key 登录时，从 `~/.local/share/opencode/auth.json` 只读导入。
3. **选模型**：登录后 `opencode-go` 路由即展示 Go 目录（`deepseek-v4.1-flash`、`glm-5.3-flash`、`kimi-k3` …）。无需重启，已存 key 对下一次请求即生效。

key 只存于 harness 凭据库的 `opencode-go/account` 记录，绝不进配置文件、绝不进日志。网关 401 呈现为 `KEY_INVALID`，且**不清除已存登录**；删除登录是用户的显式动作。

## 配置

全部字段可选；缺省值与官方网关一致。

| 字段 | 缺省 | 含义 |
|---|---|---|
| `baseURL` | `https://opencode.ai/inference/go/openai/v1` | OpenAI 兼容根；chat completions 落在 `{baseURL}/chat/completions` |
| `listingBaseURL` | `https://opencode.ai/inference/go/v1` | 协议无关目录根；列表落在 `{listingBaseURL}/models` |
| `modelsTimeoutMs` | `5000` | 单次目录请求的截止时间 |
| `modelsMaxAgeMs` | `600000` | 目录老化阈值，超过后下一次访问触发后台刷新 |
| `requestTimeoutMs` | `600000` | 单次模型请求的墙钟守卫 |

## 错误码

| 码 | 含义 |
|---|---|
| `SIGN_IN_REQUIRED` | 未存 key；请先走登录流 |
| `KEY_INVALID` | 网关 401；已存登录保留 |
| `QUOTA_EXCEEDED` | 网关 402 |
| `ROUTE_FORBIDDEN` | 网关 403 |
| `UPSTREAM_ERROR` | 其余网关失败（保留 status） |
| `LOCAL_IMPORT_UNAVAILABLE` | 本机 CLI 没有可用的 `opencode-go` 条目 |
| `SIGN_IN_CANCELLED` | 登录尝试以空 key 收场 |

## 网关契约要点（2026-10 实测）

- 请求头：`Authorization: Bearer <key>`、`x-opencode-session`（harness 会话 id，供网关路由与 prompt 缓存）、harness 归因头 + 诚实 UA。
- 目录是标准 OpenAI 形状 `{"object":"list","data":[{"id":…}]}`。
- 每个响应的 `usage` 带 `usage.opencode = { billing_source, list_cost, allowance, tokens }` —— 计划配额面。harness `TokenUsage` 折算会从 `prompt_tokens` 中扣除缓存部分（计数不相交）。
- 推理模型回 `reasoning_content`；适配器以 harness `reasoning` 块呈现在正文之前。

## 目录数据

`src/catalog-data.ts` 是 Go 模型目录的生成快照（出处：`@earendil-works/pi-ai@1.1.0 providers/data/opencode-go.json`，上游 models.dev）。在线目录负责可用性保鲜；计划模型阵容变化时重新生成快照。

## 开发

```bash
pnpm --dir plugins/opencode-go install
pnpm --dir plugins/opencode-go run typecheck
pnpm --dir plugins/opencode-go test
```

设计与取证记录：[docs/opencode-go-plugin.cn.md](../../docs/opencode-go-plugin.cn.md)（中文）/ [docs/opencode-go-plugin.md](../../docs/opencode-go-plugin.md)（英文）。
