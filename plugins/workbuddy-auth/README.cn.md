# @veren/workbuddy-auth

把 WorkBuddy（国内版，copilot.tencent.com）与 WorkBuddy AI（国际版，workbuddy.ai）
经**插件自有的 OAuth 设备码流程**接入 DSH：单一 `workbuddy` 模型路由、双区域一等
公民、多账号池、轮换安全的令牌刷新。

- **两区域一套路由**：区域随凭据走，模型选择器一个分组（显示名带 `国内`/`国际`
  标签与计费倍率；模型 id 带 `cn:`/`global:` 前缀——上游 id 两区域有撞名）。
- **多账号**：同区域可登录多个，选号轮换并自动跳过冷却中的账号；额度耗尽只停
  那一个账号（1h），限流冷却 1min，服务端错误冷却 10s。
- **会话粘性但不粘坏**：同一会话粘住同一账号；账号一进冷却，下一条消息即落健
  康账号，上下文不丢（消息由 DSH 持有）。
- **进程内翻译**：无回环端口、无共享密钥、无外部网关进程；宿主消息词汇直接在
  适配器里翻译成 WorkBuddy 的 OpenAI 兼容 wire（协议细节见
  [docs/workbuddy-protocol.cn.md](../../docs/workbuddy-protocol.cn.md)）。
- **登录零指纹**：设备指纹只出在 chat/计费端点并按 uid 确定性派生；OAuth 三端
  点不带任何设备身份。

## 用法

设置 → 模型 页脚的 WorkBuddy 卡片：选「登录 · 国内版 / 国际版」→ 浏览器完成授权
→ 卡片自动等待并落凭据（在线校验通过才保存）。已登录后卡片给出账号表：余额、
停用/启用、退出登录、推理档位探测（**消耗真实积分，双确认后才会发起**）。

依赖协议纯库 [`@veren/workbuddy-protocol`](../../packages/workbuddy-protocol)
（零 DSH 依赖、离线全测）；本包只做宿主接缝。

## 测试

```bash
pnpm --dir plugins/workbuddy-auth test    # vitest，不触网（上游全部 mock）
```

风控不变式全部落成测试：刷新单飞（N 调用 1 请求）、锁跨网络调用、零指纹登录、
轮询节奏下限、state 区域锁定、粘性不粘坏账号、冷却分类学、登出四类清除（凭据/
冷却/停用/探测按 uid 一次删净）、显示层脱敏。

## 上游漂移时

先重跑 Phase 0 探针并 diff `tests/fixtures/`（流程与注意见协议文档 §9）；探针
消耗真实积分，**每轮捕获前须用户确认**。
