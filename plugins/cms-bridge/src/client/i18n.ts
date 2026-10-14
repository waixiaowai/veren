/**
 * cms-bridge 多语言字典(中英双语,经 locale 服务注册)。
 * The cms-bridge locale dictionaries (zh/en, registered through the locale service).
 *
 * Translate 形态:支持 {placeholder} 插值,由调用方做简单替换。
 * The Translate shape supports {placeholder} interpolation via simple replacement.
 */
export type Translate = (key: string, params?: Record<string, string>) => string;

export const NS = '@veren/cms-bridge';

/** 插值替换 / placeholder interpolation */
function format(template: string, params?: Record<string, string>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

/** 由字典生成 Translate / builds a Translate from a dict */
export function translateFrom(dict: Record<string, string>): Translate {
  return (key, params) => format(dict[key] ?? key, params);
}

export const zh: Record<string, string> = {
  statusTitle: 'CMS 连接',
  apiKeyTitle: 'API Key',
  apiKeyHint: '保存后经 Loader 热更生效,插件自动以新凭证重连;原文不会回显。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '保存失败:{message}',
  show: '显示明文',
  hide: '隐藏明文',
  credential: '凭证',
  notSet: '未配置',
  uptime: '在线时长',
  reconnects: '重连次数',
  pending: '待补报',
  inflight: '执行中',
  lastError: '最近错误',
  refreshHint: '每 3 秒自动刷新',
  apiUnreachable: 'API 不可达:{error}',
  'state.connected': '已连接',
  'state.connecting': '连接中',
  'state.reconnecting': '重连中',
  'state.awaiting-credential': '等待凭证',
  'state.idle': '空闲',
  'state.disposed': '已卸载',
};

export const en: Record<string, string> = {
  statusTitle: 'CMS Connection',
  apiKeyTitle: 'API Key',
  apiKeyHint: 'Saved through the Loader hot path; the plugin reconnects with the new credential. The raw value is never shown back.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Save failed: {message}',
  show: 'Show plain text',
  hide: 'Hide plain text',
  credential: 'Credential',
  notSet: 'not set',
  uptime: 'Uptime',
  reconnects: 'Reconnects',
  pending: 'Pending events',
  inflight: 'In-flight',
  lastError: 'Last error',
  refreshHint: 'Auto-refreshes every 3s',
  apiUnreachable: 'API unreachable: {error}',
  'state.connected': 'Connected',
  'state.connecting': 'Connecting',
  'state.reconnecting': 'Reconnecting',
  'state.awaiting-credential': 'Credential required',
  'state.idle': 'Idle',
  'state.disposed': 'Disposed',
};
