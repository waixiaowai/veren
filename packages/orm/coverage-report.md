# @veren/orm 测试覆盖率报告 / Test Coverage Report

- 生成时间 / Generated: 2026-11-05
- 生成命令 / Command: `pnpm --dir packages/orm run coverage`
- 覆盖率提供方 / Provider: V8 (`@vitest/coverage-v8 5.0.4`, Vitest 5.0.4)
- 测试结果 / Tests: 20 个测试文件、105 个用例全部通过 / 20 files, 105 tests, all passing
- 统计范围 / Scope: `src/**/*.ts`（排除 `.d.ts`）

## 总体 / Overall

| 指标 / Metric | 已覆盖 / Covered | 总数 / Total | 覆盖率 / % |
| --- | ---: | ---: | ---: |
| 行 / Lines | 1740 | 1843 | **94.41%** |
| 分支 / Branches | 975 | 1249 | **78.06%** |
| 函数 / Functions | 627 | 664 | **94.43%** |
| 语句 / Statements | 1986 | 2206 | **90.03%** |

## 按模块 / By module

| 模块 / Module | 行 / Lines | 分支 / Branches | 函数 / Functions | 语句 / Statements |
| --- | ---: | ---: | ---: | ---: |
| 全部 / All files | 94.41% | 78.06% | 94.43% | 90.03% |
| src/(root) | 100% | 100% | 100% | 100% |
| src/adapters | 98.48% | 97.83% | 90.91% | 97.47% |
| src/driver | 90.43% | 79.88% | 84.21% | 89.21% |
| src/errors | 100% | 80% | 100% | 100% |
| src/logger | 100% | 88.57% | 100% | 93.75% |
| src/metadata | 96.04% | 79.91% | 98.46% | 91.73% |
| src/migration | 93.15% | 50% | 92.31% | 87.21% |
| src/naming | 100% | 88.24% | 100% | 100% |
| src/persistence | 93.88% | 77.66% | 100% | 85.66% |
| src/query | 92.45% | 77.44% | 92% | 88.41% |
| src/runtime | 95.24% | 70.37% | 97.41% | 89.53% |
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

- 核心链路的行覆盖均已进入高位：持久化 93.87%、运行时 95.23%、查询 92.45%、模式同步 95.65%、迁移 93.15%、适配器 98.48%、元数据 96.03%。
- 剩余缺口集中在需要**真实外部条件**或**异常分支**的位置：
  1. `driver/postgres.ts`、`driver/mysql.ts`：默认连接池的创建与销毁已覆盖；`pool.connect()` 成功后的客户端包装层需要真实数据库服务器，默认套件没有凭据，因此这两处保持较低行覆盖。
  2. `schema/introspect.ts`：SQLite 内省已覆盖；PostgreSQL/MySQL 的 information_schema 分支同样需要真实服务器。
  3. `query/insert-builder.ts`、`query/update-builder.ts`：空值集、RETURNING 关闭、空更新集等防御分支只在极端输入下触发。
  4. `runtime/manager-helpers.ts`：参数归一与错误消息分支有多条组合路径，主链只覆盖常见组合。
- 纯导出/纯类型文件（`index.ts`、`types.ts`、`schema/table.ts`、`subscriber/subscriber.ts`）V8 统计为 0 行，不计入缺口。

## 产物 / Artifacts

- HTML 报告 / HTML report: [`coverage/index.html`](./coverage/index.html)
- JSON 汇总 / JSON summary: [`coverage/coverage-summary.json`](./coverage/coverage-summary.json)
- 终端文本 / Terminal text: 重新执行 `pnpm --dir packages/orm run coverage` 即可复现。

## 下一步建议 / Suggested next steps

1. 为 PostgreSQL / MySQL 增加可选 e2e（无凭据自跳过），覆盖客户端包装、连接池与事务路径，把驱动模块推向 95%。
2. 为 insert/update builder 补空值集、RETURNING 关闭、空更新集等防御分支的单测。
3. 若接入 CI，建议设置行覆盖阈值 90%、语句覆盖阈值 90%，先锁住当前水平。
