/**
 * API Key 配置表单组件(纯渲染 + 行为回调经 props 注入)。
 * The API Key form component (pure rendering; the rotate behavior arrives via props).
 *
 * 保存走 owner site 注入的 rotate 回调;原文绝不回显,成功后只清空输入框。
 * 眼睛图标切换明文/密文显示。
 * Saving goes through the injected rotate callback; the raw value is never
 * rendered back — on success the input just clears. An eye icon toggles
 * between masked and plain text.
 */
import { useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Translate } from './i18n.ts';
import styles from './panel.module.css';

/** 组件返回类型:React 元素 / component return type: a React element */
type Jsx = import('react').ReactElement;

/** 眼睛图标(睁眼:可见)/ the eye icon (open: visible) */
function EyeIcon(): Jsx {
  return (
    <svg className={styles.eyeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 眼睛斜杠图标(闭眼:隐藏)/ the eye-off icon (closed: hidden) */
function EyeOffIcon(): Jsx {
  return (
    <svg className={styles.eyeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function ApiKeyForm({ rotate, t }: {
  /** owner site 注入的换凭证行为 / the rotate behavior injected from the owner site */
  rotate: (token: string) => Promise<void>;
  t: Translate;
}): Jsx {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [message, setMessage] = useState('');

  const save = async (): Promise<void> => {
    setPhase('saving');
    setMessage('');
    try {
      await rotate(token);
      setToken('');
      setVisible(false);
      setPhase('saved');
    } catch (error) {
      setPhase('idle');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('apiKeyTitle')}</div>
      <div className={styles.hint}>{t('apiKeyHint')}</div>
      <div className={styles.formRow}>
        <Input
          className={styles.input}
          type={visible ? 'text' : 'password'}
          value={token}
          placeholder="cmsk_..."
          onChange={(e) => { setToken(e.target.value); setPhase('idle'); }}
        />
        <Button
          variant="ghost"
          size="sm"
          className={styles.eyeToggle}
          title={visible ? t('hide') : t('show')}
          aria-label={visible ? t('hide') : t('show')}
          onClick={() => { setVisible((v) => !v); }}
        >
          {visible ? <EyeIcon /> : <EyeOffIcon />}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={phase === 'saving' || token.length === 0}
          onClick={() => { void save(); }}
        >
          {phase === 'saving' ? t('saving') : t('save')}
        </Button>
      </div>
      {phase === 'saved' ? <div className={styles.saved}>{t('saved')}</div> : null}
      {message !== '' ? <div className={styles.errorText}>{t('saveFailed', { message })}</div> : null}
    </div>
  );
}
