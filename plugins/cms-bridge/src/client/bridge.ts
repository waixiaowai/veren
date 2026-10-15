/**
 * 桥接状态数据面:同源轮询 + HostObservable({ getSnapshot, subscribe })。
 *
 * The bridge status data plane: same-origin polling wrapped as a
 * HostObservable ({ getSnapshot, subscribe }).
 *
 * 遵循客户端铁律:动态事实不进组件自订阅,而是包成可观察对象,由 apply 世界
 * 创建、经 props 穿给组件;组件只做纯渲染。
 * Following the client rules: dynamic facts are not self-subscribed inside
 * components; they are wrapped as an observable created in the apply world and
 * passed down as props, so components stay pure rendering.
 */

/** 运行状态快照(与宿主 /cms-bridge/api/status 同形)/ the runtime status snapshot (same shape as the host endpoint) */
export interface BridgeStatus {
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'awaiting-credential' | 'disposed';
  /** 稳定设备 ID(设备 ID 插件解析;未就绪为 '')/ the stable device id (resolved by the device-id plugin; '' until ready) */
  deviceId: string;
  credentialFingerprint: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  connectedAt: number | null;
  pendingEvents: number;
  inflightCommands: number;
  node: NodeIdentity;
}

/** 节点身份(名称/简介/图标/uuid)/ the node identity (name/description/icon/uuid) */
export interface NodeIdentity {
  nodeId: string;
  nodeName: string;
  nodeDescription: string;
  nodeIcon: string;
}

/** 读取节点身份(GET;POST 同路由)/ fetch the node identity (GET; POST shares the route) */
export async function fetchIdentity(): Promise<NodeIdentity> {
  const res = await fetch('/cms-bridge/api/identity');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { identity?: NodeIdentity };
  if (!body.identity) throw new Error('no identity in response');
  return body.identity;
}

/** 保存节点身份 / save the node identity */
export async function saveIdentity(identity: NodeIdentity): Promise<void> {
  const res = await fetch('/cms-bridge/api/identity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
}

/**
 * 上传图标图片:经节点代理转到 cms /v1/files(is_public),返回公开 CAS URL。
 * Uploads the icon image: the node proxy forwards it to cms /v1/files
 * (is_public) and returns the public CAS URL.
 */
export async function uploadIconImage(file: File): Promise<string> {
  const form = new FormData();
  // purpose 必须是 cms 的 8 值注册表之一(icons 归 user_data);is_public 换永久 CAS URL
  // purpose must be one of cms's 8 registry values (icons fall under user_data);
  // is_public exchanges for the permanent CAS URL.
  form.append('purpose', 'user_data');
  form.append('is_public', 'true');
  form.append('file', file);
  const res = await fetch('/cms-bridge/api/icon', { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { url?: string };
  if (typeof body.url !== 'string' || body.url === '') throw new Error('no url in response');
  return body.url;
}

/** 轮询快照:状态或拉取错误 / the polled snapshot: status or fetch error */
export interface StatusSnapshot {
  status: BridgeStatus | null;
  error: string | null;
}

/** HostObservable 契约(dsh 客户端规则 9)/ the HostObservable contract (client rule 9) */
export interface StatusStore {
  getSnapshot(): StatusSnapshot;
  subscribe(listener: () => void): () => void;
}

/** 拉取一次状态 / fetch the status once */
async function fetchStatus(signal?: AbortSignal): Promise<StatusSnapshot> {
  try {
    const res = await fetch('/cms-bridge/api/status', { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: (await res.json()) as BridgeStatus, error: null };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 创建基于 SSE 事件推送的状态可观察对象;返回句柄含 start/stop,由 apply
 * 世界登记清理。start 即取一次快照,之后由 /cms-bridge/api/events 实时推送;
 * EventSource 断线自动重连。
 * Creates the SSE-push status observable; the handle carries start/stop for
 * the apply world to register. start takes one snapshot, then
 * /cms-bridge/api/events pushes updates; EventSource reconnects itself.
 */
export function createStatusStore(): StatusStore & { start(): void; stop(): void } {
  let snapshot: StatusSnapshot = { status: null, error: null };
  const listeners = new Set<() => void>();
  let source: EventSource | null = null;
  const emit = (): void => { for (const fn of listeners) fn(); };
  const applySnapshot = (next: StatusSnapshot): void => {
    snapshot = next;
    emit();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (source) return;
      // 先取一次快照(SSE 建连前即时显示),再切到事件流实时推送
      // One snapshot fetch for instant display, then the event stream takes over.
      void fetchStatus().then(applySnapshot);
      source = new EventSource('/cms-bridge/api/events');
      source.onmessage = (e) => applySnapshot({ status: JSON.parse(e.data) as BridgeStatus, error: null });
      source.onerror = () => applySnapshot({ ...snapshot, error: 'event stream interrupted; retrying' });
    },
    stop() {
      source?.close();
      source = null;
    },
  };
}

/** 提交新凭证 / submit a new credential */
export async function rotateCredential(token: string): Promise<void> {
  const res = await fetch('/cms-bridge/api/credential', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
}
