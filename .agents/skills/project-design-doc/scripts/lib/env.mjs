const SECRET_SUFFIX = /(_KEY|_PASSWORD|_SECRET|_TOKEN)$/i;

/**
 * 子进程环境净洗：移除密钥与 DSH 变量。
 * Clean child env: strip secrets and DSH_* variables.
 */
export function cleanEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (/^DSH_/i.test(key)) continue;
    if (SECRET_SUFFIX.test(key)) continue;
    env[key] = value;
  }
  env.ASTRO_TELEMETRY_DISABLED = '1';
  return env;
}
