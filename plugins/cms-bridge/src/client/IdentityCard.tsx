/**
 * 节点信息卡片(纯渲染):名称/简介/图标/uuid 四个可编辑字段 + 保存。
 * The node identity card (pure rendering): name/description/icon/uuid fields + save.
 *
 * 加载与保存行为由 owner site 注入(铁律 10);图标字段实时预览 emoji。
 * 渲染按职责拆成子组件:加载占位、字段组、图标行、保存行。
 * Load/save behaviors are injected from the owner site (rule 10); the icon
 * field renders a live emoji preview. Rendering is split by responsibility
 * into sub-components: loading placeholder, field group, icon row, save row.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { NodeIdentity } from './bridge.ts';
import { fetchIdentity, saveIdentity, uploadIconImage } from './bridge.ts';
import type { Translate } from './i18n.ts';
import styles from './panel.module.css';

/** 组件返回类型:React 元素 / component return type: a React element */
type Jsx = import('react').ReactElement;

/** 翻译文案里的错误文本 / the error text out of a thrown value */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 保存阶段的相位 / the save phase */
type SavePhase = 'idle' | 'saving' | 'saved';

/**
 * 拉取当前身份;返回取消函数,组件卸载/重载时丢弃迟到结果。
 * Fetches the current identity; returns a cancel function so late results are
 * dropped on unmount/reload.
 *
 * @param onLoaded 加载成功回调 / called with the fetched identity
 * @param onError 加载失败回调 / called with the failure text
 * @returns 取消函数 / the cancel function
 */
function reloadIdentity(
  onLoaded: (identity: NodeIdentity) => void,
  onError: (message: string) => void,
): () => void {
  let alive = true;
  fetchIdentity()
    .then((data) => { if (alive) onLoaded(data); })
    .catch((error) => { if (alive) onError(errorMessage(error)); });
  return () => { alive = false; };
}

/**
 * 选图后经节点代理上传到 cms,成功即把公开 URL 写进图标字段(保持 null 不动)。
 * After picking a file, uploads it to cms through the node proxy and writes
 * the public URL into the icon field (a null identity is left untouched).
 */
async function applyIconUpload(
  file: File | undefined,
  setUploading: (uploading: boolean) => void,
  setMessage: (message: string) => void,
  setIdentity: (update: (current: NodeIdentity | null) => NodeIdentity | null) => void,
): Promise<void> {
  if (!file) return;
  setUploading(true);
  setMessage('');
  try {
    const url = await uploadIconImage(file);
    setIdentity((current) => (current === null ? current : { ...current, nodeIcon: url }));
  } catch (error) {
    setMessage(errorMessage(error));
  } finally {
    setUploading(false);
  }
}

/**
 * 保存身份:成功标记 saved;失败回 idle 并携带文案。
 * Saves the identity: success marks the saved phase; failure returns to idle
 * carrying the message text.
 */
async function applyIdentitySave(
  identity: NodeIdentity,
  persist: (identity: NodeIdentity) => Promise<void>,
  setPhase: (phase: SavePhase) => void,
  setMessage: (message: string) => void,
): Promise<void> {
  setPhase('saving');
  setMessage('');
  try {
    await persist(identity);
    setPhase('saved');
  } catch (error) {
    setPhase('idle');
    setMessage(errorMessage(error));
  }
}

/** 单字段行:标签 + 控件 / one field row: label + control */
function Field({ label, children }: { label: string; children: Jsx | string }): Jsx {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

/** 图标预览:URL 渲染图片,否则按 emoji 文本 / the icon preview: URLs render as images, anything else as emoji text */
function IconPreview({ nodeIcon }: { nodeIcon: string }): Jsx {
  if (nodeIcon.startsWith('http://') || nodeIcon.startsWith('https://') || nodeIcon.startsWith('data:')) {
    return <img className={styles.iconImg} src={nodeIcon} alt="" />;
  }
  return <span className={styles.iconPreview} aria-hidden="true">{nodeIcon}</span>;
}

/** 图标字段行:预览 + 隐藏文件选择 + 上传按钮 / the icon field row: preview + hidden file picker + upload button */
function IconField({ nodeIcon, uploading, t, onPick }: {
  nodeIcon: string;
  uploading: boolean;
  t: Translate;
  onPick: (file: File | undefined) => void;
}): Jsx {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <Field label={t('nodeIcon')}>
      <span className={styles.iconRow}>
        <IconPreview nodeIcon={nodeIcon} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? t('uploading') : t('uploadIcon')}
        </Button>
      </span>
    </Field>
  );
}

/** 四个可编辑字段 + 设备 ID 只读行 / the four editable fields + the read-only device id row */
function IdentityFields({ identity, uploading, t, onPatch, onPickIcon }: {
  identity: NodeIdentity;
  uploading: boolean;
  t: Translate;
  onPatch: (key: keyof NodeIdentity, value: string) => void;
  onPickIcon: (file: File | undefined) => void;
}): Jsx {
  return (
    <>
      <Field label={t('nodeName')}>
        <Input
          className={styles.input}
          value={identity.nodeName}
          onChange={(e) => onPatch('nodeName', e.target.value)}
        />
      </Field>
      <Field label={t('nodeDescription')}>
        <Input
          className={styles.input}
          value={identity.nodeDescription}
          placeholder={t('nodeDescriptionPlaceholder')}
          onChange={(e) => onPatch('nodeDescription', e.target.value)}
        />
      </Field>
      <IconField nodeIcon={identity.nodeIcon} uploading={uploading} t={t} onPick={onPickIcon} />
      <Field label={t('nodeId')}>
        <Input
          className={styles.input}
          type="text"
          value={identity.nodeId}
          spellCheck={false}
          onChange={(e) => onPatch('nodeId', e.target.value)}
        />
      </Field>
    </>
  );
}

/** 设备 ID 行 + 保存按钮与结果反馈 / the device id row + save button with result feedback */
function SaveRow({ deviceId, phase, message, t, onSave }: {
  deviceId: string;
  phase: SavePhase;
  message: string;
  t: Translate;
  onSave: () => void;
}): Jsx {
  return (
    <>
      <Field label={t('deviceId')}>
        <span className={`${styles.deviceId} ${styles.mono}`}>{deviceId !== '' ? deviceId : t('loading')}</span>
      </Field>
      <div className={styles.formRow}>
        <Button
          variant="primary"
          size="sm"
          disabled={phase === 'saving'}
          onClick={onSave}
        >
          {phase === 'saving' ? t('saving') : t('save')}
        </Button>
        {phase === 'saved' ? <div className={styles.saved}>{t('saved')}</div> : null}
        {message !== '' ? <div className={styles.errorText}>{t('saveFailed', { message })}</div> : null}
      </div>
    </>
  );
}

/** 加载占位卡片(或错误文案)/ the loading placeholder card (or the error text) */
function IdentityLoading({ message, t }: { message: string, t: Translate }): Jsx {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('identityTitle')}</div>
      <div className={styles.hint}>{message !== '' ? message : t('loading')}</div>
    </div>
  );
}

/** IdentityCard 的入参 / the IdentityCard props */
interface IdentityCardProps {
  /** 稳定设备 ID(device-id 插件解析;只读展示)/ the stable device id (resolved by the device-id plugin; shown read-only) */
  deviceId: string;
  /** 上次保存时间(变化触发重载)/ when the identity was last saved (a change reloads) */
  savedAt: number;
  t: Translate;
}

export function IdentityCard({ deviceId, savedAt, t }: IdentityCardProps): Jsx {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => reloadIdentity(setIdentity, setMessage), [savedAt]);

  if (identity === null) {
    return <IdentityLoading message={message} t={t} />;
  }

  const patch = (key: keyof NodeIdentity, value: string): void => {
    setIdentity({ ...identity, [key]: value });
    setPhase('idle');
  };
  const save = (): Promise<void> => applyIdentitySave(identity, saveIdentity, setPhase, setMessage);
  const upload = (file: File | undefined): Promise<void> => applyIconUpload(file, setUploading, setMessage, setIdentity);

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('identityTitle')}</div>
      <IdentityFields identity={identity} uploading={uploading} t={t}
        onPatch={patch} onPickIcon={(file) => { void upload(file); }} />
      <SaveRow deviceId={deviceId} phase={phase} message={message} t={t}
        onSave={() => { void save(); }} />
      <div className={styles.hint}>{t('identityHint')}</div>
    </div>
  );
}
