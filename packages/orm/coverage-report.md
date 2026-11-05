# @veren/orm 测试覆盖率报告 / Test Coverage Report

- 生成时间 / Generated: 2026-11-05
- 生成命令 / Command: `pnpm --dir packages/orm exec vitest run --coverage`
- 覆盖率提供方 / Provider: V8 (`@vitest/coverage-v8 5.0.4`, Vitest 5.0.4)
- 测试结果 / Tests: 9 个测试文件、31 个用例全部通过 / 9 files, 31 tests, all passing
- 统计范围 / Scope: `src/**/*.ts`（排除 `.d.ts`）

## 总体 / Overall

| 指标 / Metric | 已覆盖 / Covered | 总数 / Total | 覆盖率 / % |
| --- | ---: | ---: | ---: |
| 行 / Lines | 1308 | 1836 | **71.24%** |
| 分支 / Branches | 699 | 1236 | **56.55%** |
| 函数 / Functions | 451 | 662 | **68.13%** |
| 语句 / Statements | 1470 | 2199 | **66.85%** |

## 按模块 / By module

| 模块 / Module | 行 / Lines | 分支 / Branches | 函数 / Functions | 语句 / Statements |
| --- | ---: | ---: | ---: | ---: |
| 全部 / All files | 71.24% | 56.55% | 68.13% | 66.85% |
| src/(root) | 100% | 100% | 100% | 100% |
| src/adapters | 78.79% | 63.04% | 68.18% | 73.42% |
| src/driver | 71.74% | 52.44% | 70.53% | 66.19% |
| src/errors | 17.33% | 0% | 18.52% | 16.88% |
| src/logger | 31.82% | 17.14% | 17.65% | 21.88% |
| src/metadata | 82.84% | 60.71% | 80% | 77.33% |
| src/migration | 93.15% | 50% | 92.31% | 87.21% |
| src/naming | 55.17% | 58.82% | 64.71% | 54.84% |
| src/persistence | 93.88% | 77.04% | 100% | 85.66% |
| src/query | 60.91% | 49.21% | 63.51% | 57.53% |
| src/runtime | 67.3% | 54.5% | 59.48% | 63.09% |
| src/schema | 83.7% | 59.02% | 86.21% | 77.97% |
| src/subscriber | 100% | 75% | 100% | 100% |
| src/util | 18.18% | 21.43% | 50% | 18.75% |

## 低覆盖热点 / Low-coverage hotspots

只列出「行数 ≥ 10 且行覆盖率 < 50%」的文件。/ Files with at least 10 lines and line coverage below 50%.

| 文件 / File | 行覆盖 / Lines | 分支覆盖 / Branches |
| --- | ---: | ---: |
| src/errors/base.ts | 7.89% (3/38) | 0% |
| src/driver/mysql.ts | 14.29% (4/28) | 0% |
| src/driver/postgres.ts | 15.38% (4/26) | 0% |
| src/util/random.ts | 18.18% (2/11) | 21.43% |
| src/errors/core.ts | 27.03% (10/37) | 0% |
| src/runtime/repository.ts | 31.25% (10/32) | 100% |
| src/logger/logger.ts | 31.82% (7/22) | 17.14% |
| src/query/find-operator.ts | 35.29% (6/17) | 0% |
| src/runtime/entity-manager.ts | 39.18% (38/97) | 37.21% |
| src/query/select-builder.ts | 42.5% (34/80) | 29.85% |
| src/runtime/manager-helpers.ts | 45% (9/20) | 44.12% |

## 解读 / Interpretation

- 高覆盖：持久化管线（`persist.ts` 98.8%、`persist-values.ts` 98.1%）、关系装载（94.3%）、迁移执行器（93.9%）、数据源（91.4%）、订阅者广播（100%）。核心写入路径有真库（SQLite）端到端验证。
- 中低覆盖主要集中在三类：
  1. **未实例化的错误构造器**：`errors/base.ts`、`errors/core.ts` 只在实际失败分支执行；测试只覆盖了少数错误码，其余错误类的消息与字段尚未逐项断言。
  2. **未触达的委托方法**：`repository.ts`、`entity-manager.ts` 有大量一行委托 API（`findBy`、`count`、`exists`、`insert`、`update`、`delete`、`clear`、`increment`、自定义仓储等），主链测试只走了其中一部分。
  3. **无真实凭据的驱动连接路径**：`postgres.ts` / `mysql.ts` 的默认客户端加载与连接池分支未执行（只验证了注入 `client` 时的 SQL 生成），这是报告里最低的两个文件。
- 另：`naming-strategy.ts`、`logger.ts`、`find-options.ts` 的许多分支属于可选能力（自定义命名、日志级别、少用操作符），主链不需要逐条覆盖。
- `src/index.ts`、`src/types.ts`、`src/schema/table.ts`、`src/subscriber/subscriber.ts` 是纯导出/纯类型文件，V8 统计为 0 行，不代表缺口。

## 产物 / Artifacts

- HTML 报告 / HTML report: [`coverage/index.html`](./coverage/index.html)
- JSON 汇总 / JSON summary: [`coverage/coverage-summary.json`](./coverage/coverage-summary.json)
- 终端文本 / Terminal text: 重新执行上面的命令即可复现。

## 下一步建议 / Suggested next steps

1. 为 `repository.ts` / `entity-manager.ts` 的委托 API 补一组表驱动测试，目标行覆盖 ≥ 80%。
2. 为每个错误类至少构造一次，断言 `code`、`name` 与关键字段（错误面是公共契约）。
3. 增加 Postgres/MySQL 的可选 e2e（无凭据自跳过），覆盖默认客户端加载、连接池与事务路径。
4. 为 `find-options.ts` 的每个操作符补参数化断言（当前主要覆盖 `In`、`Not`、`Between` 与嵌套关系条件）。
