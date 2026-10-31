/**
 * The reply form: the centered modal, its body/notify/error fields, and the
 * shared footer. The form owns only its draft state; a successful submit
 * closes the modal, a failure is shown inline.
 *
 * 回复表单：居中模态框、正文/通知方式/错误字段与共享脚部。表单只持有草稿状态；
 * 提交成功即关闭模态框，失败则内联展示。
 *
 * @module @veren/forum-ui/client/panel-reply
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { messageOf } from './catalog.ts'
import type { ForumKey } from './locales.ts'
import { Modal, ModalActions, NotifySegmented } from './panel-kit.tsx'

/** The reply fields: the body textarea, the notify choice, and the inline error. 回复字段：正文输入、通知方式与内联错误。 */
function ReplyFields(props: {
  readonly t: (key: ForumKey) => string
  readonly body: string
  readonly onBody: (value: string) => void
  readonly notify: 'inbox' | 'wake'
  readonly onNotify: (value: 'inbox' | 'wake') => void
  readonly error: string
}) {
  const { t, body, onBody, notify, onNotify, error } = props
  return (
    <>
      <label className="forum-field">
        <span className="forum-label">{t('replyBody')}</span>
        <textarea
          className="forum-textarea" value={body} rows={5} autoFocus aria-label={t('replyBody')}
          placeholder={t('replyPlaceholder')}
          onChange={event => { onBody(event.target.value) }}
        />
      </label>
      <NotifySegmented t={t} notify={notify} onNotify={onNotify} />
      {error !== '' && <p className="forum-form-error" role="alert">{error}</p>}
    </>
  )
}

/** The reply box, in a centered modal. 居中模态框里的回复框。 */
export function ReplyModal(props: {
  readonly t: (key: ForumKey) => string
  readonly author: string | undefined
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly onClose: () => void
  readonly onSubmit: (body: string, notify: 'inbox' | 'wake') => Promise<boolean>
}) {
  const { t, author, actor, readOnly, onClose, onSubmit } = props
  const [body, setBody] = useState('')
  const [notify, setNotify] = useState<'inbox' | 'wake'>('inbox')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const canSubmit = !readOnly && !pending && actor !== undefined && body.trim() !== ''
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    setPending(true)
    void onSubmit(body, notify)
      .then((ok) => { if (ok) onClose() }, (cause: unknown) => { setError(messageOf(cause)) })
      .finally(() => { setPending(false) })
  }
  return (
    <Modal
      title={author === undefined ? t('writeReply') : `${t('replyingTo')} @${author}`}
      subtitle={t('replyPlaceholder')} closeLabel={t('close')} onClose={onClose}
    >
      <form className="forum-form" onSubmit={submit}>
        <div className="forum-modal-body">
          <ReplyFields t={t} body={body} onBody={setBody} notify={notify} onNotify={setNotify} error={error} />
        </div>
        <ModalActions cancelLabel={t('cancel')} confirmLabel={t('send')} disabled={!canSubmit} onCancel={onClose} />
      </form>
    </Modal>
  )
}
