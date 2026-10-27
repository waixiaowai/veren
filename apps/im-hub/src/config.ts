/**
 * Environment configuration of the hub. Every knob has a default so the spike
 * runs with zero setup; the device token is the one value that must be set.
 *
 * 环境配置。每个开关都有默认值，尖刺零配置即可跑；设备令牌是唯一必须设置的值。
 *
 * @module im-hub/config
 */

import { join } from 'node:path'

/** Resolved configuration. */
export interface HubConfig {
  /** HTTP listen address. */
  addr: string
  /** Durable data directory (credentials, queues, cursors). */
  dataDir: string
  /** The shared device token devices must present. */
  deviceToken: string
  /** The device every inbound message routes to (the spike's single device). */
  defaultDevice: string
  /** iLink API base URL override. */
  baseUrl: string
}

/** Read the configuration from the environment, failing loudly on nonsense. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const deviceToken = env.HUB_DEVICE_TOKEN?.trim() ?? ''
  if (deviceToken === '') {
    throw new Error('HUB_DEVICE_TOKEN is required: set a shared secret devices must present')
  }
  return {
    addr: env.HUB_ADDR?.trim() || ':8787',
    dataDir: env.HUB_DATA_DIR?.trim() || join(process.cwd(), 'data'),
    deviceToken,
    defaultDevice: env.HUB_DEFAULT_DEVICE?.trim() || 'main',
    baseUrl: env.HUB_BASE_URL?.trim() || 'https://ilinkai.weixin.qq.com/',
  }
}

/** Resolve one durable file path inside the data directory. */
export function dataFile(config: HubConfig, name: string): string {
  return join(config.dataDir, name)
}
