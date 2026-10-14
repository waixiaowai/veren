/**
 * 连接状态卡片组件(纯渲染):悬浮状态角标 + 关键指标行。
 * The connection status card component (pure rendering): a floating state
 * badge on the card corner + metric rows.
 *
 * 状态不再占卡片内一行,而是以 Tag 角标悬浮于卡片右上边缘(悬浮角标);
 * 数据经 props 从 owner site 穿入(铁律 10),组件不接触 ctx、不自订阅。
 * The state is not an in-card row anymore — it floats on the top-right edge
 * as a Tag badge; data arrives via props (rule 10), never touching ctx.
 */
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStatus } from './bridge.ts';
import type { Translate } from './i18n.ts';
import styles from './panel.module.css';

/** 组件返回类型:React 元素 / component return type: a React element */
type Jsx = import('react').ReactElement;

/** 状态 → 悬浮角标配色 / state → floating badge tone */
const BADGE_TONE: Record<BridgeStatus['state'], TagTone> = {
  connected: 'success',
  connecting: 'warning',
  reconnecting: 'warning',
  'awaiting-credential': 'danger',
  disposed: 'neutral',
  idle: 'neutral',
};

/** 在线时长文案 / uptime label */
function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:');
}
function uptime(connectedAt: number | null): string {
  if (!connectedAt) return '-';
  const s = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
  const m = Math.floor(s / 60);
  const hh = Math.floor(m / 60);
  return hh > 0 ? `${hh}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function StatusCard({ status, error, t }: {
  status: BridgeStatus | null;
  error: string | null;
  t: Translate;
}): Jsx {
  const state = status?.state ?? 'idle';
  return (
    <div className={styles.card}>
      {/* 悬浮角标:跨压卡片上边缘 / floating badge straddling the card's top edge */}
      <Tag tone={BADGE_TONE[state]} className={styles.badge}>{t(`state.${state}`)}</Tag>
      <div className={styles.cardTitle}>
        {status
          ? (
              <>
                {isUrl(status.node.nodeIcon)
                  ? <img className={styles.iconImgSmall} src={status.node.nodeIcon} alt="" />
                  : <span aria-hidden="true">{status.node.nodeIcon}</span>}
                <span>{status.node.nodeName}</span>
              </>
            )
          : t('statusTitle')}
      </div>
      {error !== null ? (
        <div className={styles.errorText}>{t('apiUnreachable', { error })}</div>
      ) : (
        <div>
          <Row label={t('credential')} value={status?.credentialFingerprint ?? t('notSet')} />
          <Row label={t('uptime')} value={uptime(status?.connectedAt ?? null)} />
          <Row label={t('reconnects')} value={String(status?.reconnectAttempts ?? 0)} />
          <Row label={t('pending')} value={String(status?.pendingEvents ?? 0)} />
          <Row label={t('inflight')} value={String(status?.inflightCommands ?? 0)} />
          {status?.lastError ? <Row label={t('lastError')} value={status.lastError} /> : null}
        </div>
      )}
      <div className={styles.hint}>{t('refreshHint')}</div>
    </div>
  );
}

/** 单行指标 / one metric row */
function Row({ label, value }: { label: string; value: string }): Jsx {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  );
}
