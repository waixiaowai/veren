/**
 * 指令分发器：维护 action→handler 映射表，并逐条执行收到的指令。
 *
 * The command dispatcher: owns the action→handler mapping table and runs
 * incoming commands one by one.
 *
 * 职责边界（对应需求 3/4/5/8）：
 *   - 映射与 payload 校验由插件自身声明，服务端不参与；
 *   - 未映射 action 回传明确的 UNKNOWN_ACTION 失败，绝不静默；
 *   - 每条指令有独立超时，超时按失败回执且不阻塞后续指令。
 *
 * Responsibility boundaries (requirements 3/4/5/8): the mapping and payload
 * validation are declared by the plugin alone; an unmapped action gets an
 * explicit UNKNOWN_ACTION failure, never silence; every command runs with its
 * own timeout and a timeout never blocks later commands.
 */

import type { ActionEntry, Failure, ResultFrame } from './protocol.js';
import { HANDLER_ERROR, INVALID_PAYLOAD, TIMEOUT, UNKNOWN_ACTION } from './protocol.js';

/** 分发器配置 / the dispatcher's options */
export interface DispatcherOptions {
  /** 单条指令执行超时（毫秒）/ the per-command execution timeout in ms */
  commandTimeoutMs: number;
  /** 超时提醒回调（可观测）/ notified on every timeout (for observability) */
  onTimeout?: (action: string, timeoutMs: number) => void;
  /** 开始执行提醒回调 / notified when a command starts */
  onStart?: (action: string) => void;
}

export class Dispatcher {
  /** action → 声明 / action → declared entry */
  private readonly actions = new Map<string, ActionEntry>();

  constructor(private readonly options: DispatcherOptions) {}

  /** 注册/覆盖一个 action 映射 / registers or overwrites one action mapping */
  register(action: string, entry: ActionEntry): void {
    this.actions.set(action, entry);
  }

  /** 注销一个 action 映射 / removes one action mapping */
  unregister(action: string): boolean {
    return this.actions.delete(action);
  }

  /** 查询是否已映射 / whether an action is mapped */
  has(action: string): boolean {
    return this.actions.has(action);
  }

  /** 已映射的 action 名单 / the mapped action names */
  list(): string[] {
    return [...this.actions.keys()];
  }

  /** 正在执行的指令数 / the number of commands in flight */
  get inflight(): number {
    return this.inflightCount;
  }

  private inflightCount = 0;

  /**
   * 执行一条指令并产出回执报文：任何路径都返回 ResultFrame，绝不抛出。
   * Runs one command and produces its result frame: every path returns a
   * ResultFrame and nothing throws out.
   */
  async dispatch(id: string, action: string, payload: unknown): Promise<ResultFrame> {
    const entry = this.actions.get(action);
    // 未映射/不认识的 action：明确的失败结果，不允许静默吞掉
    // An unmapped/unknown action: an explicit failure, never swallowed
    if (!entry) {
      return fail(id, UNKNOWN_ACTION, `unknown action: ${action}`);
    }
    // payload 校验由映射声明负责 / payload validation comes from the mapping
    if (entry.validate) {
      const reason = entry.validate(payload);
      if (reason) return fail(id, INVALID_PAYLOAD, reason);
    }
    return this.runMapped(id, action, entry, payload);
  }

  /**
   * 运行一个已映射的 action：套独立超时，把超时哨兵与处理器错误翻译成对应的
   * 失败回执；成功路径包成 ok:true。
   * Runs one mapped action: wraps it with its own timeout and translates the
   * timeout sentinel and handler errors into the matching failure frames; the
   * success path wraps into ok:true.
   */
  private async runMapped(id: string, action: string, entry: ActionEntry, payload: unknown): Promise<ResultFrame> {
    this.options.onStart?.(action);
    this.inflightCount++;
    try {
      const result = await withTimeout(entry.handler(payload), this.options.commandTimeoutMs, () => {
        this.options.onTimeout?.(action, this.options.commandTimeoutMs);
        // 超时抛哨兵：不能让 withTimeout 的超时产物被当作成功结果包进 ok:true
        // A timeout throws the sentinel: withTimeout's expiry product must not be
        // wrapped into an ok:true success by the caller below.
        return new TimeoutSignal(`action ${action} timed out after ${this.options.commandTimeoutMs}ms`);
      });
      return { type: 'result', id, ok: true, result };
    } catch (error) {
      if (error instanceof TimeoutSignal) {
        return fail(id, TIMEOUT, error.message);
      }
      // 其余情况才是处理器真实抛错 / anything else is a real handler error
      const err = error instanceof Error ? error : new Error(String(error));
      return fail(id, HANDLER_ERROR, err.message);
    } finally {
      this.inflightCount--;
    }
  }
}

/** 超时哨兵：withTimeout 到期时抛出，dispatch 据此产出 TIMEOUT 失败 / the timeout sentinel thrown by withTimeout so dispatch can emit a TIMEOUT failure */
class TimeoutSignal extends Error {}

/** 构造失败回执 / builds a failure result frame */
function fail(id: string, code: string, message: string): ResultFrame {
  const failure: Failure = { code, message };
  return { type: 'result', id, ok: false, ...failure };
}

/**
 * 给一个 promise 套独立超时：到时 reject 一个哨兵错误，且不取消底层执行
 * （卡死的 handler 被放弃，但分发器与后续指令完全不受影响）。
 * Wraps a promise with its own timeout: on expiry it rejects with the sentinel
 * and never cancels the underlying work (the stuck handler is abandoned while
 * the dispatcher and all later commands stay unaffected).
 */
function withTimeout<T>(promise: Promise<T> | T, timeoutMs: number, timeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeout()), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
