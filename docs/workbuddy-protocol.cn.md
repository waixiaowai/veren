# WorkBuddy / CodeBuddy 上游协议卷宗（国内版 + 国际版）

> **证据状态声明**：本文档第一版（2026-10-30）的每条事实都来自 `dsh-workbuddy-oauth/`
> 参考实现的**已付费实测注释**（其注释中标注了实测日期与上游项目出处），以及其源码中的
> 请求/响应形状定义。**本文档尚未包含本插件自己的新鲜探针捕获**——探针消耗真实积分且
> 有风控暴露，每轮捕获须用户确认后执行（见 §9）。届时按 §9 的流程 diff 本文档与
> `plugins/workbuddy-auth/tests/fixtures/`，不一致处以新捕获为准并更新本文档。

证据指针缩写：

- **卷宗·文件:行** = `dsh-workbuddy-oauth/src/<文件>` 的对应注释/代码（每个"实测"注释是一条已付费教训）
- **fixture:名** = `plugins/workbuddy-auth/tests/fixtures/<名>.json`（本插件离线回放样本，形状取自卷宗）
- **P0-待验** = 尚待 Phase 0 探针轮次复核的事实

## 0. 区域总表

两区域是**独立账号体系**（独立配额、独立登录、目录行为不同）。区域以数据表驱动，不是分支复制。

| | 国内版 (cn) | 国际版 (global) |
|---|---|---|
| API base（chat/catalog/refresh） | `https://copilot.tencent.com` | `https://www.workbuddy.ai` |
| Web origin（Origin/Referer，billing） | `https://www.codebuddy.cn` | `https://www.workbuddy.ai` |
| 登录 base（OAuth 三端点） | `https://www.workbuddy.cn` | `https://www.workbuddy.ai` |
| Accept-Language | `zh-CN` | `en-US` |
| X-Auth-Refresh-Source | `workbuddy` | `plugin` |
| chat User-Agent 产品段 | `WorkBuddy/<ver> WorkBuddy/<ver>` | `WorkBuddy AI/<ver> WorkBuddy AI/<ver>` |
| catalog User-Agent | `CLI/2.63.2 CodeBuddy/2.63.2` | `WorkBuddyAI/<ver>`（**无空格**） |
| X-Agent-Type: main | **不发** | 发 |

三个域名**不许合并**：上游按 `Origin` 校验（卷宗·region.ts:44-48）。`loginBase` 与 `base`
是两个 host：state 端点把它被调用时所在的 host 回显进授权 URL，登录页按 host 隔离 state——
用户打开的 URL 与该 state 的所有后续调用必须在同一个 host 上（卷宗·region.ts:29-36：在
`copilot.tencent.com` 的 URL 上做手机号登录会被拒 `无效的token`）。

区域判定：凭据的 `domain` 字段（上游返回裸域名，如 `workbuddy.ai`），后缀匹配
`workbuddy.ai` → global，否则 cn（卷宗·region.ts:75-78）。**region 从 domain 重算，不从盘上信**（卷宗·credentials.ts:151-156）。

## 1. OAuth 设备码登录（零指纹区）

流程：`state → 授权 URL 交用户 → 轮询 token → account`。刻意非交互：无 TTY、无本地回调端口（卷宗·oauth.ts:11-13）。

登录三端点**只带** CLI UA 与区域 Origin/Referer——**不带任何设备指纹头**（无 `X-Machine-ID`/`X-Session-ID`；三个参考实现均核对过；卷宗·fingerprint.ts:26-34）。这是风控不变式"零指纹登录"的依据。

### 1.1 POST `/v2/plugin/auth/state?platform=workbuddy`（loginBase）

- 请求体 `{}`。头：`loginHeaders(origin)` = Content-Type/Accept JSON + `X-Requested-With: XMLHttpRequest` + `Origin`/`Referer` + `User-Agent: CLI/2.63.2 CodeBuddy/2.63.2`（卷宗·oauth.ts:24, 131-141）。
- `platform=workbuddy`，**不是 `CLI`**：桌面 App 的授权 URL 报 `platform=workbuddy`；对 `CLI` 作用域的 state，登录页手机号流程会拒 OneID token（`无效的token`）。这是**对参考实现（两家用 `CLI`）的有据偏离**——它们是网关产品，CLI 流程即全部；本插件代表桌面 App 用户登录（卷宗·oauth.ts:27-37）。
- 响应：`{code:0, msg, data:{state, authUrl}}`。
- 客户端在 `authUrl` 上补 `loginSessionId=<fresh UUID>`（端点忽略请求侧的它；是页面 OneID 手机流程与客户端的关联键，缺它页面拒 token）。**不发 `version`**：页面 HTML 与有无 version 字节一致（0.0.1/5.5.6/99.0.0/缺失全测过），发自己的版本号=声称一个无法保持新鲜的东西（卷宗·oauth.ts:39-79）。

### 1.2 GET `/v2/plugin/auth/token?state=<state>`（loginBase）

- 同 `loginHeaders`。成功：`data:{accessToken, refreshToken, expiresIn(秒), domain}`。
- **未完成形态**：HTTP 200 + `{code:11217, msg:"11217:login ing..."}`、无 `data`（实测于 tools/login-probe.mjs；旧形状曾以 4xx 呈现）。`code===11217` ∨ `msg` 含 `login ing` ∨ HTTP 4xx ⇒ `LoginPending`（用户只是还没在浏览器完成，必须显示"等待"，绝不能显示"失败"）（卷宗·oauth.ts:265-280）。
- 未知/过期 state ⇒ `LoginExpired`，必须重新发起。

### 1.3 GET `/v2/plugin/login/account?state=<state>`（loginBase，Bearer accessToken）

- 响应 `data:{uid, enterpriseId, nickname}`。无 uid = 凭据不可用（每个上游调用都要它），登录失败（卷宗·oauth.ts:406-412）。
- 成功后**退役 state**（同一授权不得二次铸币）；pending 时 state 必须保留（卷宗·oauth.ts:413-416）。

### 1.4 登录轮询的风控约束（不变式）

- **轮询节奏下限 3s**：登录端点是滥用心智画像的靶子（密循环轮询长得像撞库）。节奏由用户在浏览器侧控制，轮询更快毫无收益。下限在**发请求前**执行（急躁重试根本到不了上游）（卷宗·oauth.ts:81-96, 344-355）。
- **state TTL 600s**：本地过期一个被上游早已遗忘的 state（对齐 workbuddy2api-panel 的 pending 窗口）（卷宗·oauth.ts:98-105）。
- **state 区域锁定**：state 兑换用的区域从**记录的 attempt**里取，不由调用方传——state 只能在签发它的 host 上兑（workbuddy2api 的 `validateRealmMatch` 同款理由）（卷宗·oauth.ts:332-359）。

## 2. Token 刷新（轮换语义）

POST `<base>/v2/plugin/auth/token/refresh`，体 `{}`。

- 头（在 common 头之上）：`X-Refresh-Token`（**只出现在这里**）、`X-Auth-Refresh-Source`（cn=`workbuddy`，global=`plugin`——上游按此判别刷新来源，发错对它们可见）、`X-User-Id`、`X-CodeBuddy-Request: 1`、`Accept-Language`（区域）、可选 `X-Domain`/`X-Enterprise-Id`（卷宗·refresh.ts:70-93）。
- 响应信封嵌套不稳定：`{data:{...}}` 与 `{data:{data:{...}}}` 都出现过，解包两次（卷宗·refresh.ts:114-134）。
- **轮换**：响应带新 refresh token，旧的即作废。**两个并发刷新 = 第二个发送已被消费的令牌 = 上游眼里的被盗令牌重放**——这正是风控要抓的形状。因此：进程内单飞（N 调用 1 请求）+ 跨进程把"读-刷新-写"整周期锁住（第二进程锁内重读新令牌自然跳过刷新）；锁**跨网络调用**持有（卷宗·refresh.ts:5-28, 163-166）。
- **惰性刷新**：距过期 ≤5min 边际才刷（边际 > 一个聊天回合，令牌不会在检查与使用之间过期）。**禁止定时器后台刷**（白白放大凭据流量）（卷宗·refresh.ts:18-28, 44-51）。
- 无 refresh token 的凭据报"不需要刷"而不是"需要刷"（否则每次调用都注定失败地试一轮）；正确答案是重新登录（卷宗·refresh.ts:107-112）。
- 刷新响应未带新 refreshToken 时旧令牌仍有效，保留旧值（卷宗·refresh.ts:217-219）。

## 3. Chat（流式补全）

POST `<base>/v2/chat/completions`，OpenAI 兼容体，**强制 `stream:true`**（上游拒绝非流式）。

### 3.1 请求头（在 common 头之上）

- `Authorization: Bearer <accessToken>`、`Content-Type: application/json`
- 桌面身份族：`X-IDE-Type: WorkBuddy`、`X-IDE-Name: WorkBuddy`、`X-IDE-Version: <appVersion>`、`X-Product: SaaS`；chat User-Agent = `WorkBuddy/<ver> WorkBuddyAI?/<ver>[ CLI/<cliVer>]`（国际版产品段带空格 `WorkBuddy AI`）（卷宗·identity.ts:134-145）
- 账号身份族：`X-User-Id`/`X-Enterprise-Id`/`X-Domain`——**缺哪个就发对应的 `X-No-<字段>: 1`**，不发空白头（空白头=向上游登记一个无身份设备，比不发更糟）（卷宗·upstream.ts:443-460，fingerprint.ts:91-101）
- 设备指纹族：`X-Machine-ID`/`X-Session-ID` = `md5("wb2a:<purpose>:<uid>")`（32 hex 截断），按 uid 确定性派生——同账号恒定、跨账号隔离；空 uid 则整头不发。**只用于 chat/billing/task 端点**（§1 零指纹登录）（卷宗·fingerprint.ts 全文）
- **X-Agent 身份族**（PR #1 实测：国际版缺它报 400/11128「请求被拦截，请重新发送」）：
  - `X-Agent-Intent: craft` + `X-Agent-Purpose: conversation` + `X-Agent-Type: main`——**三件两区域都发**。
  - **2026-10-30 本机真机实测偏离卷宗**：CN chat 端点对只有 intent/purpose 的请求同样回答
    400/11128「请求被拦截，请重新发送」，补上 `X-Agent-Type: main` 后放行——CN 风控已与
    国际版收敛。卷宗（2026-09 观测）"CN 不发 type" 的不对称已过时；三件套是当前唯一实测
    皆过的形态（证据：本插件真机验收会话 + `tests/upstream-client.spec.ts` 的 CN 断言）。
- **会话追踪族**（`withGatewayChatHeaders`，卷宗·upstream.ts:640-690）：
  - `X-Conversation-ID` = `sha256("<进程盐>|conversation|<会话键>")` 前 32 hex；会话键优先 harness 会话键，否则首条真实用户消息签名
  - `X-Conversation-Request-ID` = `sha256("<进程盐>|turn|<会话键>|<回合键>")` 前 32 hex；回合键 = 倒数第一条**真实**用户消息（跳过纯工具结果消息）的位置+内容签名
  - `X-Conversation-Message-ID` = `X-Request-ID` = 每 32 hex 随机（每出站消息全新一对）
  - **为什么**：上游按 `X-Conversation-Request-ID` 把一次用户发送计为一次请求；每次调用带全新 id 会把一次发送在使用明细里碎片化成多条。重试/工具续跑/换账号保持同一回合；用户下一条消息才换新回合（卷宗·upstream.ts:525-611）
  - **原始本地会话 id 绝不外发**：派生 id 盐化（每进程新盐），不得可读回原文（卷宗·upstream.ts:509-517）
  - 调用方已带的同名头保留（调用者的归因比这里的派生更优）；不添加大小写变体的重复头（fetch 会合并值）（卷宗·upstream.ts:670-679）

### 3.2 请求体翻译

- `stream: true` 强制；`developer` 角色改写为 `system`（上游拒 developer 角色：HTTP 400/11128「Illegal API invocation from an unapproved channel」）（卷宗·upstream.ts:708-744）
- `tool_choice` 折叠为字符串：`none` ⇒ 删字段并连 `tools`/`functions` 一起删；对象形 `{type:'auto'|'required'}` ⇒ 字面量；`{type:'function', function:{name}}` ⇒ 函数名；其余删字段。对象形原样发会 400（卷宗·upstream.ts:746-784）
- `reasoning_effort: 'off'` **两区域都删**（字段缺省是唯一各处实测皆过的形态；字面 `'none'` 不安全——GPT-5.6 家族与 GLM 收，`gpt-6-astra` 拒）。国际 GPT 家族拒 off 报 400/11133（`extError.param='reasoning.effort'`）；CN 在 `onlyReasoning` 模型上拒 off 报 400/11150（卷宗·upstream.ts:1654-1686）
- **国际版独有**：首条消息必须是 system，否则 400/11128「first message is not system prompt」——缺则前插 `{"role":"system","content":"You are a helpful assistant."}`（前插不合并，不搅乱既有消息）（卷宗·upstream.ts:1618-1652）
- 探测请求的国际版 `max_tokens` 下限：GPT-5.6 家族拒 `1`（400/11133 `integer_below_min_value`），用 16（卷宗·upstream.ts:1266-1288, 1699-1706）

### 3.3 响应

- 成功：SSE（`data:` 行 JSON，`[DONE]` 收尾）。增量形状与 OpenAI 兼容（`choices[].delta.{content,reasoning_content,tool_calls}` + usage 尾块）。
- 失败：JSON 体（≤4KB 截断保存），形状含 `{error:{data:{code,msg}}}` / `{extError:{code,param}}` / `{displayMsg:{zh,en}}` / `{code,msg}`。

## 4. 模型目录

GET `<base>/v3/config`，**路径同、按 User-Agent 分流**（网关按客户端身份切花名册，这个分流是承重的）：

- CN 用 CLI UA（`CLI/2.63.2 CodeBuddy/2.63.2`）⇒ CLI 花名册（本插件能 chat 的正是这份）
- 国际版用 App UA（`WorkBuddyAI/<ver>`，**无空格**——带空格的形态被拒 400/12403）⇒ App 内部花名册（卷宗·upstream.ts:978-1048, identity.ts:147-161）
- 国际版额外带 `X-Requested-With` + `X-Product: SaaS`
- 响应形状两样：通常是 `{code,msg,data}` 信封；国际版 `/v3/config` 也见过**裸产品文档**（无信封）——`data` 缺失但文档自身带 `models`/`agents` 时以文档为答案（卷宗·upstream.ts:1027-1036）
- 成员资格 = `agents[name='cli'].models` 花名册 ∩ 可用行（无行/`disabled:true`/`maxInputTokens`或`maxOutputTokens`非正 ⇒ 剔除）；花名册缺失或交集为空 = 硬错误（卷宗·upstream.ts:1406-1475）
- 行字段：`{id,name,maxInputTokens,maxOutputTokens,contextWindow:{defaultLength,supportedLengths}(仅国际),supportsImages,disabledMultimodal,supportsReasoning,onlyReasoning,reasoning:{supportedEfforts,defaultEffort|effort,canDisableThinking},credits,tags}`；effort 词表闭集 `low|medium|high|xhigh|max`（`minimal` 不存在于上游词表）；`canDisableThinking` 只有显式 `true` 才算能关（旧行缺字段且其中若干在线上拒 `off`，保守默认"不能关"）（卷宗·upstream.ts:227-270）
- 计费：`credits` 形如 `x0.79` 或 `x0.79 credits`（后缀词去掉，得到各语言通读的 `x0.79`）；`badge:<label>:<color>` 标签只在控制台文档 `/console/enterprises/personal/models`（CN 最佳努力二次读取合并，失败只丢标签不丢目录）；`x0.00` ⇒ 免费。国际版文档带 `modelPromotions`（限时折扣，`displayMode:'replace'` 才采纳；缓存行上的促销**按时钟重估**——不在生效期则放弃报价报 `rateUnknown`，绝不继续声称免费）（卷宗·upstream.ts:272-332, 1477-1589）
- 目录日抖动大（`auto`/`kimi-k3-1`/`minimax-m3` 一周内出现又消失）；静态兜底表只是启动占位，不是承诺（卷宗·catalog.ts:14-38）

## 5. 计费/余额

POST（billingBase）两形状，按账号类型选路（卷宗·upstream.ts:1102-1263）：

- **个人**（国际版一律；CN 无企业 id 的账号）：`/v2/billing/meter/get-user-resource`，体 `{PageNumber:1,PageSize:100,ProductCode:'p_tcaca',Status:[0,3],PackageEndTimeRangeBegin/End:<本地时间 YYYY-MM-DD HH:mm:ss>}`；答案 `data.Response.Data.Accounts[]`，每行 `CycleCapacitySize/CycleCapacityRemain/CycleCapacityUsed/CapacityRemain/CapacitySize/PackageName`，取值优先级见卷宗 1160-1181
- **CN 企业**（cn 且 enterpriseId 非空；区域闸是承重的——国际凭据恰带 enterpriseId 时留在实测过的个人路径）：`/v2/billing/meter/get-enterprise-user-usage`，体 `{}`，身份全在头；答案字段拼写两官方调用点不一致（`limitNum/credit` vs `limit_num/used_num`）都收；`limitNum===-1` = 无上限（独立 flag，绝不渲染成 0）；可识别字段缺失 = **硬错误**而不是 0（"渲染一个貌似合理的错数字"正是 #31 潜伏多年的形态）（卷宗·upstream.ts:1184-1263）
- 头：`Authorization` + `X-User-Id`/`X-Enterprise-Id`+`X-Tenant-Id`/`X-Domain`（卷宗·upstream.ts:692-706）

## 6. 错误分类学（承重顺序）

`classifyUpstreamError(status, body)`（卷宗·upstream.ts:336-370）。**额度判定先于状态码兜底，刻意**：

1. HTTP 402 ⇒ `hard_credit`
2. HTTP 401 ⇒ `session_dead`（401 无业务含义可覆盖；12153 等会话死标记只是附加信号）
3. 体含额度标记（小写 ASCII 集 + 中文原文集，含「额度**已**用尽」——**实测 2026-09-30**：真耗尽账号答 **HTTP 429** + `{"error":{"data":{"code":14018,"msg":"额度已用尽，…购买加量包…"}}}`，不是 402；早期清单漏「已」变体导致耗尽被归为 `soft_rate` 永远重试死账号）或体含 `14018` ⇒ `hard_credit`
4. 体含 `Offline user session not found` ∨ `12153` ⇒ `session_dead`
5. HTTP 429 ⇒ `soft_rate`；404 ⇒ `not_found`；5xx ⇒ `server`；其余 4xx ⇒ `client`

冷却分类学（卷宗·shim.ts:42-45）：`hard_credit` 1h（用户不充值不会好）、`soft_rate` 1min、`server` 10s。`session_dead`/`client`/`not_found` 不冷却（重试无益或需人工）。

用户可见消息提取：`displayMsg.zh` > `displayMsg.en` > `msg`（卷宗·upstream.ts:372-400）。

**11128 双义**：CN 上报 developer 角色；国际上报首消息非 system——**永远不要单凭 code 分支区域逻辑**（卷宗·upstream.ts:1618-1626）。

## 7. 推理档位探测（耗积分，双确认）

`probeModel`（卷宗·probe.ts）：baseline（无 effort）→ sentinel（随机不可能值）→ 逐档位。顺序即语义不是优化：baseline 证明请求路径本身通；sentinel 回答"上游验不验这个字段"（收下不可能值 = 非验证型，逐档全白测）；只有 sentinel 被拒后档位结果才有意义。判定：`400 + extError.code ∈ {invalid_reasoning_effort(CN 实测), model_param_invalid(国际实测 2026-10-01)}` = 归因明确的拒绝；`200 且真流出一个 data 事件` = 接受（读完首个事件即挂断）。中途遇到不决答案 ⇒ 整轮 `unknown`（部分清单不是发现）。探测结论只是"上游收这些拼写"，永不是"这些拼写改变模型行为"。`off` 永不探测（能否关思考是目录声明 `canDisableThinking` 的事）。

## 8. 多账号池与登出

- **选号**（卷宗·store.ts:103-125）：区域过滤 → 排除停用 → 未过期令牌优先 → 未冷却优先 → 环序轮换；全冷却时服务**最快恢复**的账号（拒绝服务整个池子不可用，不如在最小坏账号上短等）
- **会话粘性但不粘坏**（卷宗·store.ts:223-245）：会话钉住的账号**只有仍可选**才续用（冷却/停用的钉子被无视——钉住会话不得绕过冷却）；无活钉才轮换并钉住。粘性不持久化（30min TTL 本就不跨进程重启）
- **冷却跨重启持久**：一小时前耗尽额度的账号不能在重启后立刻被重试（它要撞的正是冷却要避的失败）。轮换游标不持久（从头无害）（卷宗·cooldown-state.ts:5-15）
- **登出四类清除**（卷宗·account-purge.ts + README「登出会删什么」）：凭据/冷却/停用状态/探测记录**四类都以 uid 为键**，只删凭据 = uid 留在其余文件（隐私泄漏 + 同 uid 再登录时旧停用态/旧探测结论悄悄生效）。本插件四类同住一张凭据记录文档，登出=按 uid 从文档四处移除，原子完成（取舍见插件 README）

## 9. 维护跑路手册（上游漂移时）

1. **先重跑 Phase 0 探针**（`dsh-workbuddy-oauth/tools/`：login-probe / live-probe / credit-error-probe / auth-host-flow-probe），diff `tests/fixtures/`：
   - 探针消耗**真实积分**且有风控暴露；**每轮捕获前明示并取得用户确认**
   - 捕获顺序：auth state → 轮询（含 11217 pending 形态）→ account → refresh（验证轮换语义）→ catalog → 一段真实聊天 SSE → 错误形态（额度耗尽/限流）；两区域各一轮
   - token/uid/昵称**脱敏后**才准入库 `plugins/workbuddy-auth/tests/fixtures/`
2. 偏离参考实现必须带实测理由（范本：卷宗·oauth.ts 的 `platform=workbuddy` 偏离注释）
3. 争议细节以 workbuddy2api-hub/panel + connect 观察到的行为为准
4. 不承诺上游非公开接口的稳定性；本文档即接口稳定的唯一契约面

**P0-待验清单**（本插件自己的探针轮次要复核的）：§1 全部端点形状与 11217 形态、§2 轮换语义与 X-Auth-Refresh-Source 判别、§3.1 头族在线接受度、§4 两 UA 分流现状、§6 额度/限流错误形态、卷宗静态目录表 vs 当日在线目录。
（已闭环一项：X-Agent 族两区域三件套——2026-10-30 真机实测 CN 11128，见 §3.1。）

**宿主契约冲突裁定（有意偏离，已在案）**：DSH 宿主要求每个 provider 请求带
`attributionHeaders()`（`user-agent: deepseek-harness/<ver> (+url)`），但该头会**覆盖**
WorkBuddy 的 UA，而 UA 形状本身是承重身份（§4 按 UA 分流目录花名册、§3.1 按 App 形分叉）。
本插件保持卷宗实测的 UA 字节形态、**不发** attribution 头；探针轮次顺带验证"附加归因头
是否被上游容忍"，容忍则补、拒绝则维持现状（取舍记录：plugins/workbuddy-auth/src/adapter.ts
头部注释）。
