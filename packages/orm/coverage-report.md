# @veren/orm 测试覆盖率报告 / Test Coverage Report

- 生成时间 / Generated: 2026-11-05
- 生成命令 / Command: `pnpm --dir packages/orm run coverage`
- 覆盖率提供方 / Provider: V8 (`@vitest/coverage-v8 5.0.4`, Vitest 5.0.4)
- 测试结果 / Tests: 25 个测试文件、115 个用例全部通过 / 25 files, 115 tests, all passing
- 统计范围 / Scope: `src/**/*.ts`（排除 `.d.ts`）
- 真实数据库 e2e / Live e2e: `pnpm test:e2e`（无凭据自动跳过 / self-skips without credentials）

## 总体 / Overall

| 指标 / Metric | 已覆盖 / Covered | 总数 / Total | 覆盖率 / % |
| --- | ---: | ---: | ---: |
| 行 / Lines | 1741 | 1843 | **94.47%** |
| 分支 / Branches | 977 | 1249 | **78.22%** |
| 函数 / Functions | 628 | 664 | **94.58%** |
| 语句 / Statements | 1987 | 2206 | **90.07%** |

## 集成测试 / Integration coverage

默认套件里已经包含进程内集成测试，不只是 mock：

- 真实 Hono 应用：`app.request()` 走完整中间件，验证成功提交、500 回滚。
- 真实 Express 应用：起本地 HTTP server，`fetch` 走完整请求/响应生命周期。
- 文件型 SQLite：跨两个独立连接读回数据、关系装载、事务回滚、补列、迁移执行/回退。
- Cordis Loader：`loader.create` 加载 ORM 插件、下游 entry 注入 `verenOrm`、卸载销毁数据源。
- 真实 PostgreSQL/MySQL：`tests/*.e2e.ts`，有 `ORM_POSTGRES_URL` / `ORM_MYSQL_URL` 时运行。

## 按模块 / By module

| 模块 / Module | 行 / Lines | 分支 / Branches | 函数 / Functions | 语句 / Statements |
| --- | ---: | ---: | ---: | ---: |
| 全部 / All files | 94.47% | 78.22% | 94.58% | 90.07% |
| src/(root) | 100% | 100% | 100% | 100% |
| src/adapters | 98.48% | 97.83% | 90.91% | 97.47% |
| src/driver | 90.43% | 79.88% | 84.21% | 89.21% |
| src/errors | 100% | 80% | 100% | 100% |
| src/logger | 100% | 88.57% | 100% | 93.75% |
| src/metadata | 96.04% | 79.91% | 98.46% | 91.73% |
| src/migration | 93.15% | 54.55% | 92.31% | 87.21% |
| src/naming | 100% | 88.24% | 100% | 100% |
| src/persistence | 93.88% | 77.66% | 100% | 85.66% |
| src/query | 92.45% | 77.44% | 92% | 88.41% |
| src/runtime | 95.56% | 70.9% | 98.28% | 89.81% |
| src/schema | 95.65% | 75.41% | 96.55% | 88.98% |
| src/subscriber | 100% | 75% | 100% | 100% |
| src/util | 100% | 100% | 100% | 100% |

## 低覆盖热点 / Low-coverage hotspots

只列出「行数 ≥ 10 且行覆盖率 < 80%」的文件。/ Files with at least 10 lines and line coverage below 80%.

| 文件 / File | 行覆盖 / Lines | 分支覆盖 / Branches |
| --- | ---: | ---: |
| src/driver/mysql.ts | 67.86% (19/28) | 40% |
| src/runtime/manager-helpers.ts | 70% (14/20) | 64.71% |
| src/schema/introspect.ts | 72.73% (8/11) | 50% |
| src/driver/postgres.ts | 73.08% (19/26) | 40% |
| src/query/insert-builder.ts | 79.41% (27/34) | 58.33% |
| src/query/update-builder.ts | 79.41% (27/34) | 68.18% |

## 解读 / Interpretation

- 核心链路的行覆盖均已进入高位：持久化 93.88%、运行时 95.24%、查询 92.45%、模式同步 95.65%、迁移 93.15%、适配器 98.48%、元数据 96.04%。
- 剩余缺口集中在需要**真实外部条件**或**异常分支**的位置：
  1. `driver/postgres.ts`、`driver/mysql.ts`：默认连接池的创建与销毁已覆盖；`pool.connect()` 成功后的客户端包装层需要真实数据库服务器。
  2. `schema/introspect.ts`：SQLite 内省已覆盖；PostgreSQL/MySQL 的 information_schema 分支同样需要真实服务器。
  3. `query/insert-builder.ts`、`query/update-builder.ts`：空值集、RETURNING 关闭、空更新集等防御分支只在极端输入下触发。
  4. `runtime/manager-helpers.ts`：参数归一与错误消息分支有多条组合路径，主链只覆盖常见组合。
- 纯导出/纯类型文件（`index.ts`、`types.ts`、`schema/table.ts`、`subscriber/subscriber.ts`）V8 统计为 0 行，不计入缺口。

## 产物 / Artifacts

- HTML 报告 / HTML report: [`coverage/index.html`](./coverage/index.html)
- JSON 汇总 / JSON summary: [`coverage/coverage-summary.json`](./coverage/coverage-summary.json)
- 终端文本 / Terminal text: 重新执行 `pnpm --dir packages/orm run coverage` 即可复现。

## 下一步建议 / Suggested next steps

1. 在 CI 或本地提供 PostgreSQL/MySQL 服务，跑 `pnpm test:e2e`，把驱动模块推向 95%。
2. 为 insert/update builder 补空值集、RETURNING 关闭、空更新集等防御分支。
3. CI 建议设置行覆盖阈值 90%、语句覆盖阈值 90%，先锁住当前水平。
