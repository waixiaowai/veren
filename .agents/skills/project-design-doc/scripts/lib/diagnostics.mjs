/** 生成统一诊断对象 / Build a normalized diagnostic. */
export function diagnostic(code, level, entry, line, message, fix = '') {
  return {
    code,
    level,
    file: entry.rel,
    line: line ?? 1,
    message,
    fix,
  };
}
