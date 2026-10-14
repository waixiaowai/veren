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
  credentialFingerprint: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  connectedAt: number | null;
  pendingEvents: number;
  inflightCommands: number;
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
 * 创建 3s 轮询的状态可观察对象;返回句柄含 stop(),由 apply 世界登记清理。
 * Creates the 3s-polling status observable; the handle carries stop() so the
 * apply world registers its cleanup.
 */
export function createStatusStore(intervalMs = 3000): StatusStore & { start(): void; stop(): void } {
  let snapshot: StatusSnapshot = { status: null, error: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const emit = (): void => { for (const fn of listeners) fn(); };
  const poll = async (): Promise<void> => {
    const next = await fetchStatus();
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
      if (timer) return;
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
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
