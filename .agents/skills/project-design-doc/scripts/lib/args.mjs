import { usageError } from './errors.mjs';

const COMMANDS = new Set(['build', 'check', 'dev', 'setup']);

const VALUE_FLAGS = new Map([
  ['--design', 'designDir'],
  ['--site', 'siteDir'],
  ['--out', 'outDir'],
  ['--port', 'port'],
]);

const BOOLEAN_FLAGS = new Map([
  ['--minimal', 'minimal'],
  ['--host', 'host'],
  ['--install', 'install'],
  ['--no-install', 'noInstall'],
  ['--skip-check', 'skipCheck'],
  ['--content-only', 'contentOnly'],
  ['--build', 'build'],
  ['--json', 'json'],
  ['--strict', 'strict'],
  ['--help', 'help'],
]);

export const HELP = `设计辅助脚本 / Design doc helper

用法 / Usage:
  node scripts/cli.mjs build [design-dir] [options]
  node scripts/cli.mjs check [design-dir] [options]
  node scripts/cli.mjs dev   [design-dir] [options]
  node scripts/cli.mjs setup

命令 / Commands:
  build   校验 + 同步 + astro build / validate, sync, build
  check   内容规则 + astro check / content rules and Astro check
  dev     校验 + 同步 + astro dev / validate, sync, dev server
  setup   安装 scripts 依赖 / install script dependencies

选项 / Options:
  --design <dir>   方案目录，默认 ./design / design directory
  --site <dir>     已有 Astro 项目 / existing Astro site
  --minimal        使用最小集合模板 / use minimal template
  --out <dir>      构建输出，默认 <design>/.design-doc/dist
  --port <n>       dev 端口，默认 4321 / dev port
  --host           dev 监听所有地址 / expose dev server
  --install        允许安装缺失依赖 / allow dependency install
  --no-install     禁止安装 / forbid installs
  --skip-check     build 跳过内容校验 / skip content check
  --content-only   check 只跑内容规则 / content rules only
  --build          check 额外跑 astro build / also run build
  --json           JSON 报告 / machine-readable report
  --strict         warning 视为 error / warnings are errors
  --help           帮助 / help
`;

export function defaults() {
  return {
    designDir: null,
    siteDir: null,
    outDir: null,
    port: 4321,
    host: false,
    minimal: false,
    install: false,
    noInstall: false,
    skipCheck: false,
    contentOnly: false,
    build: false,
    json: false,
    strict: false,
    help: false,
  };
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    return { command: 'help', options: defaults() };
  }
  if (command === '--version') {
    return { command: 'version', options: defaults() };
  }
  if (!COMMANDS.has(command)) {
    throw usageError(`未知命令 / unknown command: ${command}`);
  }
  const options = defaults();
  const rest = argv.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('-')) {
      if (options.designDir) {
        throw usageError(`多余的位置参数 / unexpected argument: ${token}`);
      }
      options.designDir = token;
      continue;
    }
    index = applyToken(token, rest, index, options);
  }
  validateOptions(command, options);
  return { command, options };
}

function applyToken(token, rest, index, options) {
  const eq = token.indexOf('=');
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? null : token.slice(eq + 1);
  const key = VALUE_FLAGS.get(name);
  if (key) {
    const value = inline ?? rest[index + 1];
    if (value === undefined || (inline === null && value.startsWith('-'))) {
      throw usageError(`${name} 需要值 / requires a value`);
    }
    options[key] = key === 'port' ? Number(value) : value;
    return inline === null ? index + 1 : index;
  }
  const boolKey = BOOLEAN_FLAGS.get(name);
  if (boolKey) {
    options[boolKey] = true;
    return index;
  }
  throw usageError(`未知选项 / unknown option: ${name}`);
}

function validateOptions(command, options) {
  if (options.install && options.noInstall) {
    throw usageError('--install 与 --no-install 不能同时使用 / mutually exclusive');
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw usageError(`--port 必须是 1-65535 的整数 / invalid port: ${options.port}`);
  }
  if (options.json && options.build) {
    throw usageError('--json 与 --build 不能同时使用 / mutually exclusive');
  }
  if (options.skipCheck && command !== 'build') {
    throw usageError('--skip-check 只用于 build / --skip-check is build-only');
  }
  if ((options.contentOnly || options.build || options.json) && command !== 'check') {
    throw usageError('--content-only/--build/--json 只用于 check / check-only flags');
  }
  if ((options.host || options.port !== 4321) && command !== 'dev') {
    throw usageError('--host/--port 只用于 dev / dev-only flags');
  }
}
