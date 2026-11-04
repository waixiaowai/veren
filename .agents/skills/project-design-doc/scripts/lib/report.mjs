import { EXIT } from './errors.mjs';

export function printReport(result, options) {
  if (options.json) {
    const payload = {
      errors: result.errors,
      warnings: result.warnings,
      stats: result.stats,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  for (const item of result.errors) {
    console.log(`${item.file}:${item.line} [${item.code}] ${item.message}`);
    if (item.fix) console.log(`  → ${item.fix}`);
  }
  const { files, errors, warnings } = result.stats;
  console.log(`\n${files} 个文件 / files, ${errors} 个错误 / errors, ${warnings} 个警告 / warnings`);
}

export function contentExitCode(result) {
  return result.errors.length > 0 ? EXIT.CONTENT : EXIT.OK;
}
