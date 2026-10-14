/**
 * 节点信息卡片(纯渲染):名称/简介/图标/uuid 四个可编辑字段 + 保存。
 * The node identity card (pure rendering): name/description/icon/uuid fields + save.
 *
 * 加载与保存行为由 owner site 注入(铁律 10);图标字段实时预览 emoji。
 * Load/save behaviors are injected from the owner site (rule 10); the icon
 * field renders a live emoji preview.
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

export function IdentityCard({ savedAt, t }: {
  /** 上次保存时间(变化触发重载)/ when the identity was last saved (a change reloads) */
  savedAt: number;
  t: Translate;
}): Jsx {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** 选图后经节点代理上传到 cms,成功即把公开 URL 写进图标字段 */
  /** After picking a file, uploads it to cms through the node proxy and writes the public URL into the icon field */
  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const url = await uploadIconImage(file);
      setIdentity((current) => (current === null ? current : { ...current, nodeIcon: url }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchIdentity()
      .then((data) => { if (alive) setIdentity(data); })
      .catch((error) => { if (alive) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [savedAt]);

  if (identity === null) {
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>{t('identityTitle')}</div>
        <div className={styles.hint}>{message !== '' ? message : t('loading')}</div>
      </div>
    );
  }

  const patch = (key: keyof NodeIdentity, value: string): void => {
    setIdentity({ ...identity, [key]: value });
    setPhase('idle');
  };
  const save = async (): Promise<void> => {
    setPhase('saving');
    setMessage('');
    try {
      await saveIdentity(identity);
      setPhase('saved');
    } catch (error) {
      setPhase('idle');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('identityTitle')}</div>
      <Field label={t('nodeName')}>
        <Input
          className={styles.input}
          value={identity.nodeName}
          onChange={(e) => patch('nodeName', e.target.value)}
        />
      </Field>
      <Field label={t('nodeDescription')}>
        <Input
          className={styles.input}
          value={identity.nodeDescription}
          placeholder={t('nodeDescriptionPlaceholder')}
          onChange={(e) => patch('nodeDescription', e.target.value)}
        />
      </Field>
      <Field label={t('nodeIcon')}>
        <span className={styles.iconRow}>
          <IconPreview nodeIcon={identity.nodeIcon} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }}
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
      <Field label={t('nodeId')}>
        <Input
          className={styles.input}
          type="text"
          value={identity.nodeId}
          spellCheck={false}
          onChange={(e) => patch('nodeId', e.target.value)}
        />
      </Field>
      <div className={styles.formRow}>
        <Button
          variant="primary"
          size="sm"
          disabled={phase === 'saving'}
          onClick={() => { void save(); }}
        >
          {phase === 'saving' ? t('saving') : t('save')}
        </Button>
        {phase === 'saved' ? <div className={styles.saved}>{t('saved')}</div> : null}
        {message !== '' ? <div className={styles.errorText}>{t('saveFailed', { message })}</div> : null}
      </div>
      <div className={styles.hint}>{t('identityHint')}</div>
    </div>
  );
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
