#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HELP, parseArgs } from './lib/args.mjs';
import { runBuild, runCheck, startDev } from './lib/astro.mjs';
import { CliError, EXIT } from './lib/errors.mjs';
import { resolvePaths, SCRIPTS_ROOT } from './lib/paths.mjs';
import { contentExitCode, printReport } from './lib/report.mjs';
import { ensureSite, installDependencies } from './lib/site.mjs';
import { syncContent, watchContent } from './lib/sync.mjs';

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help' || options.help) {
    console.log(HELP);
    return EXIT.OK;
  }
  if (command === 'version') {
    console.log('design-doc-scripts 1.0.0');
    return EXIT.OK;
  }
  if (command === 'setup') return setup(options);
  const paths = resolvePaths(options);
  ensureScriptDeps();
  const { validateDesign } = await import('./lib/validate.mjs');
  if (command === 'check') return check(paths, options, validateDesign);
  if (command === 'build') return build(paths, options, validateDesign);
  return dev(paths, options, validateDesign);
}

async function setup(options) {
  if (options.noInstall) {
    throw new CliError('setup 被 --no-install 禁止 / setup disabled', EXIT.ENV);
  }
  await installDependencies(SCRIPTS_ROOT);
  console.log('scripts 依赖已安装 / script dependencies installed');
  return EXIT.OK;
}

async function check(paths, options, validateDesign) {
  const result = await validateDesign(paths);
  printReport(result, options);
  if (result.errors.length > 0) return contentExitCode(result);
  if (!options.contentOnly && !options.json) await optionalAstroCheck(paths);
  if (options.build) await checkBuild(paths, options);
  return EXIT.OK;
}

async function checkBuild(paths, options) {
  await ensureSite(paths, options);
  await syncContent(paths);
  await runBuild(paths.siteDir, paths.checkDir);
  console.log(`Astro 构建通过 / build passed: ${paths.checkDir}`);
}

async function optionalAstroCheck(paths) {
  const hasSite = existsSync(path.join(paths.siteDir, 'package.json'));
  const hasAstro = existsSync(path.join(paths.siteDir, 'node_modules', 'astro', 'package.json'));
  if (!hasSite || !hasAstro) {
    console.log('未找到已安装的 Astro 站点，跳过 astro check / no site, skipped');
    return;
  }
  const result = await runCheck(paths.siteDir);
  if (result.skipped) {
    console.log('未安装 @astrojs/check，跳过类型检查 / skipped');
  }
}

async function build(paths, options, validateDesign) {
  if (!options.skipCheck) {
    const result = await validateDesign(paths);
    if (result.errors.length > 0) {
      printReport(result, options);
      return contentExitCode(result);
    }
    console.log('内容校验通过 / content check passed');
  }
  await ensureSite(paths, options);
  const count = await syncContent(paths);
  await runBuild(paths.siteDir, paths.outDir);
  console.log(`构建完成 / build complete: ${paths.outDir}`);
  console.log(`入口 / entry: /design/ (${count} 个 Markdown 文件)`);
  return EXIT.OK;
}

async function dev(paths, options, validateDesign) {
  const result = await validateDesign(paths);
  if (result.errors.length > 0) {
    printReport(result, options);
    return contentExitCode(result);
  }
  await ensureSite(paths, options);
  await syncContent(paths);
  const watcher = watchContent(paths, (error) => console.error(error.message));
  const child = startDev(paths.siteDir, options);
  const stop = () => child.kill('SIGINT');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`预览地址 / preview: http://localhost:${options.port}/design/`);
  const code = await waitForExit(child);
  watcher.close();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  return code === 0 ? EXIT.OK : EXIT.ASTRO;
}

function ensureScriptDeps() {
  const modules = ['yaml', 'github-slugger'].map((name) =>
    path.join(SCRIPTS_ROOT, 'node_modules', name, 'package.json'),
  );
  if (modules.every((file) => existsSync(file))) return;
  throw new CliError(
    `缺少 scripts 依赖 / missing dependencies.\n  node "${path.join(SCRIPTS_ROOT, 'cli.mjs')}" setup`,
    EXIT.ENV,
  );
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    console.error(error.stack ?? error.message ?? error);
    process.exitCode = EXIT.ENV;
  });
