# @veren/zhihu-ops

以 Veren 应用的形态，对你自己的知乎账号做运营分析。

它每天按计划从**知乎官方开放平台**只读采集账号与内容统计，把日快照存进持久化
存储域，派生涨粉与内容表现，写出一份模型生成的报告，并经任务中心投递到你的
收件箱。

对知乎做的所有动作都是**读**。它绝不替你发布、评论或关注。

## 何时使用

当你在运营一个知乎账号，想让数字被自动收上来并变成分析，而不是靠一张表格
维持仪式感时，用它。

如果压根不用知乎，或者想让 agent 替你在知乎上发文——那是另一件（也更危险）
产品，不要用这个。

## 流水线

```
每日调度 → 采集（只读） → 持久快照 → 派生指标
                                    ↓
                              模型写报告 → 任务中心收件箱
```

- **采集。** 每天一次，在配置��本地时刻。它读账号统计、你的内容列表、每篇的
  漏斗统计（曝光 UV、阅读、赞同、喜欢、评论、收藏、读完率、涨粉）、你自己
  作品下的评论、热榜，以及适合回答的问题。
- **幂等。** 采集按本地日历日定键：同一天重采是**覆盖**而不是累加，重启也
  不会重采。失败的那天在采集账里如实记为 `failed` 或 `partial`。
- **派生。** 涨粉、单篇 movers、待回评论，都是存储快照上的纯函数——页面与
  报告读的是同一份口径。
- **报告。** 一次模型调用，基于事实块写成。它跑在任何会话之外，因此绝不
  唤醒 agent、绝不进入对话日志。
- **投递。** 报告进任务中心，于是它落在你自己的收件箱里，通知与完成状态都
  是宿主那一套。

## 安装

1. 到 [developer.zhihu.com](https://developer.zhihu.com) 注册并创建一个
   **Access Secret**。
2. 装组合包：
   ```bash
   dsh plugin --profile web add @veren/zhihu-ops-bundle
   ```
3. 打开知乎运营分析应用，调 `setup_credentials` 把 Access Secret 粘进去。
   它落在凭据存储里——不进配置、不进日志。

## 页面

| 页面 | URL | 干什么 |
|---|---|---|
| overview | `/apps/zhihu-ops/overview` | 粉丝趋势、采集账、凭据状态 |
| contents | `/apps/zhihu-ops/contents` | 每篇内容的最新指标与区间增量 |
| content | `/apps/zhihu-ops/content/:contentId` | 单篇的逐日曲线与评论 |
| reports | `/apps/zhihu-ops/reports` | 报告列表与最新一份全文 |

## 工具

- tool: `refresh_now` —— 立刻重采一次
- tool: `setup_credentials` —— 写入 Access Secret
- tool: `generate_report` —— 写一份报告并投进收件箱
- tool: `list_contents` —— 按增量排的内容指标清单
- tool: `content_trend` —— 单篇的逐日趋势
- tool: `suggest_topics` —— 适合回答的问题与热榜

## 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `pullLocalTime` | `08:00` | 每日采集时刻（本地 `HH:mm`） |
| `dailyCallLimit` | `60` | 本地日调用上限（0 = 不限） |
| `requestIntervalMs` | `3000` | 两次采集请求的最小间隔 |
| `reportCadence` | `weekly` | `daily` 或 `weekly` |
| `reportWindowDays` | `7` | 一份报告覆盖的天数 |
| `contentLimit` | `20` | 一次采集读多少篇内容 |
| `autoPull` | `true` | 是否按计划自动采集 |

## 关于口径

- 官方契约区分**赞同**（`UpvoteCount`）与**喜欢**（`LikeCount`）。本插件把
  两者分开，不合并成一个"点赞"。
- 页面上的互动率是**代理指标**：（喜欢 + 评论 + 收藏）除以阅读。官方给的读完
  率单独列出，平台没给时保持缺省。
- 平台没返回的数字保持缺省。本插件绝不把缺失的指标补成零——零会被读成
  "这篇没人看"。
