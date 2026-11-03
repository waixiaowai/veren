# iLink 单变量探针矩阵：判级书（2026-11-03）

> 环境：生产 box，录制反代 `127.0.0.1:19090` → `https://ilinkai.weixin.qq.com`；
> 每个格子只改一个因子，全部经录制器落盘（`docs/evidence/ilink-send-20261103/probe-matrix.jsonl`）。
> 令牌：bot `959aef235f2b@im.bot` 的当前 token（指纹 `sha256:12797c93e7 len=58`）。
> 触发时刻：2026-11-03T02:17Z 前后。

## 判级

| 格 | 因子 | 观测 | 判级 |
|----|------|------|------|
| `baseline` | 对照（notifystart + 132102 + context） | notifystart `{"ret":0}`；send 200 + `message_id` | **发送面活**（对照成立） |
| `version-4102` | 客户端版本头改为 4102 | notifystart `{"ret":0}`；send 200 + `message_id` | **H2 证伪**：版本头值不是门槛；132102 只是客户端约定 |
| `no-context` | 省略 `context_token` | send 200 + `message_id` | **context_token 非必需**：缺它仍可投递 |
| `no-notifystart` | 本进程不调 notifystart | send 200 + `message_id` | **PARTIAL / 不可判**：该 token 已在 02:43:45 被服务调用过 notifystart（记录在案），本格无法构造"从未开启"的反事实；H1 仍未证伪/证实 |
| `dead-token` | 当前 token 末位翻转 | notifystart `{"errcode":-14,"errmsg":"session timeout"}`；send 同 | **负控通过**：死 token 仍 `-14`，且错误在 `errcode` 而非 `ret` |
| `bad-target` | 收件人改为不可解析地址 | send 200 + `{"ret":-3}` | **业务拒绝可区分**：-3 ≠ -14，不能归入"登录失效" |
| `old-token` | 更老的真实 token | 未执行 | **NOT-EXERCISED**：唯一可得的更老 token 属于 TS 直连账号（`32beb5e8`，不同 bot 家族），迁移到生产箱超出凭据红线；见契约 §6.4 |

## 结论（与契约 §4 对齐）

1. 请求形状（版本头、context_token）**不是** `-14` 的门槛；`-14` 只随令牌/会话状态出现。
2. `-14` 的原文是 `errcode:-14, errmsg:"session timeout"`；`ret` 与 `errcode` 两个字段都要看。
3. `-3` 是收件人不可解析的业务拒绝，客户端必须与 `-14` 分开处置。
4. notifystart 的必要性仍缺一次干净实验（需要新扫码 token 且从不在其上调用 notifystart）。
