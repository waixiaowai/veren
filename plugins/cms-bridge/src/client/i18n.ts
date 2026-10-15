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
  uploadIcon: '上传图片',
  uploading: '上传中…',
  show: '显示明文',
  hide: '隐藏明文',
  identityTitle: '节点信息',
  nodeName: '节点名称',
  nodeDescription: '简介',
  nodeDescriptionPlaceholder: '一句话描述这个节点(可选)',
  nodeIcon: '图标',
  nodeId: '节点 ID',
  deviceId: '设备 ID',
  identityHint: '保存后经 Loader 热更,并在下次连接时上报给 cms;ID 为稳定 uuid,修改后服务端将视为新节点。设备 ID 由 device-id 插件从本机硬件解析,只读。',
  loading: '加载中…',
  credential: '凭证',
  notSet: '未配置',
  uptime: '在线时长',
  reconnects: '重连次数',
  pending: '待补报',
  inflight: '执行中',
  lastError: '最近错误',
  refreshHint: '状态实时推送',
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
  uploadIcon: 'Upload image',
  uploading: 'Uploading…',
  show: 'Show plain text',
  hide: 'Hide plain text',
  identityTitle: 'Node Identity',
  nodeName: 'Node name',
  nodeDescription: 'Description',
  nodeDescriptionPlaceholder: 'One line about this node (optional)',
  nodeIcon: 'Icon',
  nodeId: 'Node ID',
  deviceId: 'Device ID',
  identityHint: 'Saved through the Loader hot path and reported to cms on the next connect; the ID is a stable uuid — changing it makes the server treat this as a new node. The Device ID is resolved from this machine by the device-id plugin and is read-only.',
  loading: 'Loading…',
  credential: 'Credential',
  notSet: 'not set',
  uptime: 'Uptime',
  reconnects: 'Reconnects',
  pending: 'Pending events',
  inflight: 'In-flight',
  lastError: 'Last error',
  refreshHint: 'Realtime status updates',
  apiUnreachable: 'API unreachable: {error}',
  'state.connected': 'Connected',
  'state.connecting': 'Connecting',
  'state.reconnecting': 'Reconnecting',
  'state.awaiting-credential': 'Credential required',
  'state.idle': 'Idle',
  'state.disposed': 'Disposed',
};
