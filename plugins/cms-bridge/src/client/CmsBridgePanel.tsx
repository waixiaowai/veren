/**
 * 插件页组合面板:状态卡片 + API Key 表单。
 * The plugin-page composite panel: the status card + the API Key form.
 *
 * 数据经 useSyncExternalStore 订阅 owner site 传入的 HostObservable(铁律 9/12:
 * 订阅集中在框架钩子,组件保持纯渲染)。
 * Data is consumed through useSyncExternalStore over the HostObservable passed
 * from the owner site (rules 9/12: subscription lives in the framework hook;
 * the component stays pure/derived).
 */
import { useSyncExternalStore } from 'react';
import type { StatusStore } from './bridge.ts';
import type { Translate } from './i18n.ts';
import { ApiKeyForm } from './ApiKeyForm.tsx';
import { IdentityCard } from './IdentityCard.tsx';
import { StatusCard } from './StatusCard.tsx';
import styles from './panel.module.css';

/** 组件返回类型:React 元素 / component return type: a React element */
type Jsx = import('react').ReactElement;

export function CmsBridgePanel({ store, rotate, t }: {
  store: StatusStore;
  rotate: (token: string) => Promise<void>;
  t: Translate;
}): Jsx {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className={styles.panel}>
      <StatusCard status={snapshot.status} error={snapshot.error} t={t} />
      <ApiKeyForm rotate={rotate} t={t} />
      <IdentityCard savedAt={snapshot.status?.connectedAt ?? 0} t={t} />
    </div>
  );
}
