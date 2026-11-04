/** 稳定退出码 / Stable exit codes. */
export const EXIT = Object.freeze({
  OK: 0,
  CONTENT: 1,
  ENV: 2,
  ASTRO: 3,
  USAGE: 4,
});

/** 带退出码的 CLI 错误 / CLI error carrying an exit code. */
export class CliError extends Error {
  constructor(message, exitCode = EXIT.ENV) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** 用法错误 / Usage error. */
export function usageError(message) {
  return new CliError(message, EXIT.USAGE);
}
