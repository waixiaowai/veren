# cms 后台「消息通道运维」GUI（微信通道 + taskhub）— 四问加深任务书

状态：**待执行**（2026-11-03 立项，四问加深 + 取证在案）。
来源：用户问「cms 后台是否有绑定微信和飞书等页面」→ 查证结论=OAuth 登录绑定有页（/profile 六平台）、**消息通道/机器人绑定 GUI 缺位**（imhub 全套 API 在、web 零命中）→ 用户令四问加深本任务。

## 0. 一句话重述

把 2026-11-02 微信通道抢修时**手工做过的每一步**（起授权挑战→渲染二维码→轮询→发现必须重启服务→验证游标推进→投递测试回信）变成 cms 管理台的两个页面：「消息通道」（imhub 微信授权漏斗+活体证据+消息日志+intake 结构化开关）与「任务路由」（taskhub 清单+单任务时间线回放+重排+节点池）；地基先行修掉 authorized-不-恢复-轮询 的既有缺陷；飞书只出**有界决策备忘录**不写代码。

**深不要大的硬边界（三零）**：零新权限码（imhub:manage / taskhub:read|manage / config:manage 全现成）、零新迁移、零协议变更。

## 1. 取证在案

- **缺陷⑤（地基，先修）**：`domain_stack.go` 装配注释承诺「扫码授权后 5s 内自动接管」，但 `imhub/service.go pollOnce` 在 -14（ErrAuthRequired）时让轮询 goroutine **永久退出**；「空转等待重查会话行」路径只在「从无会话」分支。实证：2026-11-02 生产 authorized 落库后通道仍死，`systemctl restart cms` 才接管（当日交付笔记在案）。
- **「authorized」≠ 活**：会话行存在（2026-10-28）而 iLink 实际 -14 长达数日；裸探 SQL + 解封 token 直连上游才定案。现状**无活性读口**（最后成功轮询时刻/游标推进/消息吞吐均无 API 面）。
- **imhub API 全套现成**（`routes.go`/`user_routes.go`）：authorize/status/verify 三件套、session 投影、messages 日志、people 目录、replies 投递（设备面 Bearer+imhub:read）。信封 {code,message,data}。
- **LoginStatus 闭集**（ilink.go 逐字）：wait|scaned|need_verifycode|confirmed|expired|verify_code_blocked|binded_redirect；-14=登录死亡（服务端语义面）。
- **二维码挑战 ~2 分钟过期**（2026-11-02 实录：第一张码死在用户扫码之前）；重复 POST authorize 返回当前尝试（不叠加）。
- **taskhub API 现成**：tasks 清单/详情（含 task_events 时间线）/requeue/workers（7700-7799 码段、taskhub:read|manage）。生产已有真实数据：failed 任务 `01M6EAQMVBXZXMESDVHVPW7W0C` 时间线含 received→matched→task_reply→10×reply_failed(-14)→failed——负路径 fixture 现成。
- **web 侧最近表亲**：`web/src/features/ws/`（活连接轮询+节点身份+原始消息面板，测试齐）；结构化配置页先例 T317（billing-config 专用表单 beats 裸 KV）；菜单注册 seed C 行 + sidebar-data + route-perms 双向守护纪律。
- **第二实现可继承**：cursour `plugins/im/ui` 云端 tab 扫码漏斗（≥9 运行态的状态清单沉淀在其重写记录）；飞书定位需先读 `D:\cms docs/im-content-routing.{cn,}.md`（3b5200e4 待评审）。
- **OAuth 登录绑定已有页**（/profile connected-accounts 六平台）：本任务不触碰它，语义不同（登录身份 ≠ 消息通道）。

## 2. 四问结论（浓缩）

- **Q1 专业加项**：活性证据卡（不信任 authorized）；先修 poller 恢复缺陷再盖楼；手工操作清单=affordance 清单；二维码倒计时+自动换码；时间线回放为中心；intake 表单说清在飞语义（改 mode 不改在途任务）；C 先读评审稿再出有界备忘录。
- **Q2 原生材料**：§1 所列 Go 源码 / ws 页先例 / im-ui 状态清单 / 事故记录 / 真实 events fixture / content-routing 评审稿。
- **Q3 方法**：状态机逐态一屏映射表先行；缺陷红绿双向；组件测试驱动漏斗全态（-14 用 base_url 指 stub）；真 events 进 fixture；seed/ROUTE_PERMS/sidebar 守护纪律；每态截图。
- **Q4 外部裁决**：盲操作者仅凭 GUI 完成重授权+游标推进+手机收回信（零手工零重启）；stub 证明死通道页显示「失联」；GUI 回放 ≡ sqlite 双源；Go 钉红转绿 + staging 免重启接管；C 备忘录对照评审稿供拍板。

## 3. 裁决点

| # | 分叉 | 裁定 | 依据 |
|---|------|------|------|
| D1 | 活性证据来源 | **新增 imhub 状态读口**（session 投影增 last_poll_ok_at + cursor + 近 1h 消息计数），前端禁拼凑 | 单一事实源；前端猜=第二个谎言面 |
| D2 | 漏斗状态钉 | **LoginStatus 闭集逐态一屏**（含 -14 死亡态与 expired 态的恢复动线），契约测试钉字面 | im-ui ≥9 态教训；we lived it |
| D3 | taskhub 页中心 | **单任务时间线回放为主**（直读 events，负路径同级视觉），清单为辅 | 昨天调试的真实路径 |
| D4 | intake 六键 | **页内结构化表单**（读 config + PUT /v1/admin/configs/{key}，type:string 齐备），表单注明在飞语义；不新建通用 KV 入口 | T317 先例 |
| D5 | 飞书 | **仅决策备忘录**（docs/notes/ 候选），先引 im-content-routing 既有范围给有界选项；本任务零飞书代码 | 深，不是大 |
| D6 | 边界 | 三零（§0）+ 不碰 /profile OAuth 绑定 + 不做 email/webhook 渠道 | 深不要大 |

## 4. 任务分解与验收

- **B0 地基（先于一切 UI）**：①imhub poller 恢复缺陷红绿修复（回归钉「-14 死亡→重新授权→≤5s 接管且免进程重启」，今天必红）+ `systemctl restart` 时代遗留的装配注释校真；②D1 活性读口 + 测试。staging（3100）实机：扫码重授权免重启、游标推进可见。
- **A 消息通道页**：`/channels/wechat`（挂既有管理组菜单，seed/sidebar/route-perms 三方守护）；活体证据卡、授权漏斗（二维码倒计时+自动换新+验证码输入+逐态屏）、消息日志（复用 ws 消息面板模式）、人员目录、intake 结构化表单。组件测试驱动全态含 -14 stub 态；每态截图。
- **B 任务路由页**：`/channels/taskhub`：清单（状态过滤）+ 详情时间线回放（真 fixture：昨天 failed 任务）+ requeue（manage）+ workers 池。回放与 sqlite 双源一致性比对。
- **C 备忘录**：`docs/notes/` 候选稿——飞书两语义（feishuhub 对齐 imhub 入云 vs 节点侧凭据托管）的取证、成本、与 content-routing 评审稿的范围对齐，交用户拍板；零代码。
- **终裁（Q4 四条逐一取证）**：盲操作者 GUI 全程重授权 → 微信发「任务：…」→ taskhub 页时间线走到 replied + 手机收回信；死通道 stub 态页面显示失联；staging 免重启实证；Go 钉红转绿。

## 5. 红线

两仓 AGENTS.md 照抄自查（cms：≤300/60 行、红绿双向、seed/权限中央登记 append-only、auditMW 挂管理面写路由；web：三态齐全、console 零报错、tsc/lint/build 绿）。信封一律 {code,message,data}；禁以 HTTP 200 判可用。凭据零落盘（设备 key 明文仅创建响应一次）。不改 imhub 既有端点行为契约（D1 只增读口）。

## 6. 终止条件

盲操作者不看任何内部文档、不用任何手工工具，仅凭这两个页面完成：微信重新授权（免重启、页面见游标推进）→ 微信发「任务：…」→ taskhub 页时间线全跳可见、手机收到回信；-14 死通道在 stub 下被页面如实判「失联」；昨天 failed 任务的 GUI 回放与 sqlite 逐行一致。此四条齐，任务闭环。
