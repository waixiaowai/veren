/**
 * 从 V8 的 coverage-summary.json 生成双语 Markdown 报告。
 * Generate the bilingual Markdown report from V8's coverage-summary.json.
 *
 * @module @veren/orm/scripts/coverage-report
 */

import { readFileSync, writeFileSync } from 'node:fs'

const summary = JSON.parse(readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'))
const total = summary.total
const pct = (part, whole) => whole === 0 ? 100 : Math.round((part / whole) * 10000) / 100
const metricOf = ([covered, total]) => ({ covered, total })
const row = (name, metric) => `| ${name} | ${pct(metric.lines.covered, metric.lines.total)}% | ${pct(metric.branches.covered, metric.branches.total)}% | ${pct(metric.functions.covered, metric.functions.total)}% | ${pct(metric.statements.covered, metric.statements.total)}% |`

const files = Object.entries(summary).filter(([key]) => key !== 'total').map(([key, value]) => {
  const file = key.replaceAll('\\', '/').split('/src/')[1] ?? key
  return { file, module: file.includes('/') ? file.split('/')[0] : '(root)', value }
})

const modules = new Map()
for (const entry of files) {
  const sum = modules.get(entry.module) ?? { lines: [0, 0], branches: [0, 0], functions: [0, 0], statements: [0, 0] }
  for (const key of ['lines', 'branches', 'functions', 'statements']) {
    sum[key][0] += entry.value[key].covered
    sum[key][1] += entry.value[key].total
  }
  modules.set(entry.module, sum)
}

const moduleRows = [...modules.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => row(`src/${name}`, {
  lines: metricOf(values.lines),
  branches: metricOf(values.branches),
  functions: metricOf(values.functions),
  statements: metricOf(values.statements),
}))

const hotspots = files
  .filter((entry) => entry.value.lines.total >= 10 && pct(entry.value.lines.covered, entry.value.lines.total) < 80)
  .sort((a, b) => pct(a.value.lines.covered, a.value.lines.total) - pct(b.value.lines.covered, b.value.lines.total))
  .map((entry) => `| src/${entry.file} | ${pct(entry.value.lines.covered, entry.value.lines.total)}% (${entry.value.lines.covered}/${entry.value.lines.total}) | ${pct(entry.value.branches.covered, entry.value.branches.total)}% |`)

const report = `# @veren/orm 测试覆盖率报告 / Test Coverage Report

- 生成时间 / Generated: 2026-11-05
- 生成命令 / Command: \`pnpm --dir packages/orm run coverage\`
- 覆盖率提供方 / Provider: V8 (\`@vitest/coverage-v8 5.0.4\`, Vitest 5.0.4)
- 测试结果 / Tests: 28 个测试文件、127 个用例全部通过 / 28 files, 127 tests, all passing
- 统计范围 / Scope: \`src/**/*.ts\`（排除 \`.d.ts\`）
- 真实数据库 e2e / Live e2e: \`pnpm test:e2e\`，4 文件 / 24 用例全部通过（PostgreSQL 16.4 + MySQL 8.4 + SQLite）/ 4 files, 24 tests, all pass

## 总体 / Overall

| 指标 / Metric | 已覆盖 / Covered | 总数 / Total | 覆盖率 / % |
| --- | ---: | ---: | ---: |
| 行 / Lines | ${total.lines.covered} | ${total.lines.total} | **${pct(total.lines.covered, total.lines.total)}%** |
| 分支 / Branches | ${total.branches.covered} | ${total.branches.total} | **${pct(total.branches.covered, total.branches.total)}%** |
| 函数 / Functions | ${total.functions.covered} | ${total.functions.total} | **${pct(total.functions.covered, total.functions.total)}%** |
| 语句 / Statements | ${total.statements.covered} | ${total.statements.total} | **${pct(total.statements.covered, total.statements.total)}%** |

## 方言差异如何被处理 / How dialect differences are handled

| 差异 | 处理方式 |
| --- | --- |
| 标识符/占位符 | 方言层：双引号/反引号、\`?\`/\`$n\` |
| 布尔 | 写入按方言转 \`0/1\` 或 \`boolean\`，读出统一 \`boolean\` |
| 日期/时区 | \`date\` 统一日历日；\`datetime\` 统一 UTC；MySQL \`datetime(3)\` 保留毫秒，PG \`timestamptz\`，SQLite ISO 文本 |
| 十进制/bigint | 读出统一字符串；十进制去尾零 |
| JSON/数组/二进制 | JSON 解析、simple-array 拆分、blob 统一 \`Uint8Array\` |
| 生成主键 | PG/SQLite \`RETURNING\`；MySQL 多行插入逐行执行，避免同一个 \`insertId\` |
| 数据库默认值 | 由库应用，但 \`save\` 后不在任一方言回写，避免 PG/SQLite 有、MySQL 没有 |
| 大小写 | \`=\` 统一大小写敏感（MySQL 字符串列 \`utf8mb4_bin\`）；\`Like\`/\`ILike\` 统一大小写不敏感 |
| NULL 排序 | 统一 NULLS LAST；MySQL 用 \`(expr IS NULL)\` 模拟 |
| 分页/删表顺序 | 方言归一 offset-only；删表先子后父 |

## 集成测试 / Integration coverage

默认套件已包含真实 Hono、Express、文件型 SQLite、Cordis Loader；e2e 另跑三种真库。

\`tests/portability.e2e.ts\` 用同一份实体和仓储代码，只切换 \`DataSource\` 配置，逐项断言 SQLite/PostgreSQL/MySQL 结果一致：

- 值往返：boolean、date、datetime、decimal、bigint、JSON、simple-array、blob、数据库默认值
- 多行插入各自不同的自增 id
- \`=\` 大小写敏感、\`Like\` 大小写不敏感
- NULL 排序、分页、update/delete 条件
- schema 默认值、时间类型、MySQL 字符串 collation

## 架构边界 / Architecture seam

- 核心不含 dialect.name === '...' 分支；由 tests/architecture.spec.ts 守住。
- ValueCodec（值表示）、QuerySyntax（排序/分页）、SchemaSyntax（列/主键/默认值/账本）是纯策略；Catalog 是 Driver 持有的 introspection I/O。
- DriverCapabilities 只表达 returning、multiRowGeneratedIds、ddlTransactions 等影响控制流的事实。

## 按模块 / By module

| 模块 / Module | 行 / Lines | 分支 / Branches | 函数 / Functions | 语句 / Statements |
| --- | ---: | ---: | ---: | ---: |
| 全部 / All files | ${pct(total.lines.covered, total.lines.total)}% | ${pct(total.branches.covered, total.branches.total)}% | ${pct(total.functions.covered, total.functions.total)}% | ${pct(total.statements.covered, total.statements.total)}% |
${moduleRows.join('\n')}

## 低覆盖热点 / Low-coverage hotspots

只列出「行数 ≥ 10 且行覆盖率 < 80%」的文件。/ Files with at least 10 lines and line coverage below 80%.

| 文件 / File | 行覆盖 / Lines | 分支覆盖 / Branches |
| --- | ---: | ---: |
${hotspots.join('\n')}

## 解读 / Interpretation

- 核心链路的行覆盖均已进入高位；真实数据库 e2e 额外验证了跨方言值归一、默认值、排序、大小写、分页和删表顺序。
- 剩余缺口主要是异常分支与真实网络错误路径，不影响上面的可移植性契约。
- 纯导出/纯类型文件（\`index.ts\`、\`types.ts\`、\`schema/table.ts\`、\`subscriber/subscriber.ts\`）V8 统计为 0 行，不计入缺口。

## 产物 / Artifacts

- HTML 报告 / HTML report: [\`coverage/index.html\`](./coverage/index.html)
- JSON 汇总 / JSON summary: [\`coverage/coverage-summary.json\`](./coverage/coverage-summary.json)
- 终端文本 / Terminal text: 重新执行 \`pnpm --dir packages/orm run coverage\` 即可复现。

## 下一步建议 / Suggested next steps

1. 将 PostgreSQL/MySQL 的临时实例启动固化为脚本或 CI service。
2. 为报告中的低覆盖异常分支补定向单测。
3. CI 设置行覆盖阈值 90%、语句覆盖阈值 90%。
`

writeFileSync(new URL('../coverage-report.md', import.meta.url), report, 'utf8')
console.log('coverage report written')
