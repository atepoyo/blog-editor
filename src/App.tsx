import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { generateArticle, insertPhoto } from './article';
import type { Photo } from './article';
import { Modal } from './Modal';
import { SettingsDialog } from './SettingsDialog';
import { HelpDialog } from './HelpDialog';
import { resizePhoto } from './photo';
import { postArticle } from './post';
import { EditorError, messages } from './messages';
import type { Language, MessageKey } from './messages';
import { useDraft } from './useDraft';
import type { DraftStatus } from './useDraft';
import { registerOffline } from './offline';

const draftMessages = { loading: 'draftLoading', saving: 'draftSaving', saved: 'draftSaved', readFailed: 'draftReadFailed', saveFailed: 'draftSaveFailed' } satisfies Record<DraftStatus, MessageKey>;

export function App() {
  const [language, setLanguage] = useState<Language>('ja');
  const [helpOpen, setHelpOpen] = useState(false);
  const text = messages[language];
  const { draft, setDraft, loading, status } = useDraft();
  const { title, body, photos, settings } = draft;
  const [pendingPhoto, setPendingPhoto] = useState<Photo | null>(null);
  const [caption, setCaption] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const disabled = busy || loading;
  const [offline, setOffline] = useState<'offlinePreparing' | 'offlineReady' | 'offlineFailed' | null>(import.meta.env.PROD ? 'offlinePreparing' : null);
  const draftMessage = draftMessages[status];
  const [notice, setNotice] = useState<{ path: string } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cursor = useRef(0);
  const operation = useRef(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  useEffect(() => cancelPress, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;
    void registerOffline().then(() => { if (!cancelled) setOffline('offlineReady'); })
      .catch(() => { if (!cancelled) setOffline('offlineFailed'); });
    return () => { cancelled = true; };
  }, []);

  function beginPress(event: PointerEvent<HTMLTextAreaElement>) {
    if (disabled || event.button !== 0) return;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        cursor.current = textArea.current?.selectionStart ?? body.length;
        setPhotoMenuOpen(true);
        cancelPress();
      }, 550),
    };
  }

  function pickPhoto() {
    setPhotoMenuOpen(false);
    fileInput.current?.click();
  }

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof EditorError ? reason.key : 'operationFailed');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  function currentArticle() {
    return generateArticle(title, body, photos, settings, new Date());
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand">Blog<span className="brand-extension">.md</span></div>
        <nav aria-label={text.navigation}>
          <button className="quiet language" type="button" disabled={disabled} onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}>{language === 'ja' ? 'English' : '日本語'}</button>
          <button className="quiet" type="button" aria-haspopup="dialog" disabled={disabled} onClick={() => setHelpOpen(true)}>{text.help}</button>
          <button className="quiet" type="button" disabled={disabled} onClick={() => setSettingsOpen(true)}>{text.settings}</button>
        </nav>
      </header>
      <section className="editor" aria-label={text.editor}>
        <input aria-label={text.title} className="title-input" placeholder={text.title} value={title} disabled={disabled} onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, title: value })); setNotice(null); }} />
        <textarea className="body-input" aria-label={text.body} ref={textArea} placeholder={text.body} value={body} disabled={disabled}
          onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, body: value })); setNotice(null); }}
          onSelect={(event) => { cursor.current = event.currentTarget.selectionStart; }}
          onPointerDown={beginPress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
          onPointerMove={(event) => {
            if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!disabled) { cursor.current = event.currentTarget.selectionStart; setPhotoMenuOpen(true); }
          }}
        />
        <div className="photo-toolbar"><button className="quiet" type="button" disabled={disabled} onClick={pickPhoto}>＋ {text.addPhoto}</button><span>{photos.length ? text.photoCount.replace('{count}', String(photos.length)) : text.photoHint}</span></div>
        <input ref={fileInput} type="file" accept="image/*,.heic,.heif" aria-label={text.photoInput} className="file-input" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void run(async () => { const photo = await resizePhoto(file); setCaption(''); setPendingPhoto(photo); });
        }} />
      </section>
      <footer className="editor-footer">
        <div className="field-help">
          <p className="hint">{text.imageHint}</p>
          <p className={status === 'readFailed' || status === 'saveFailed' ? 'error' : 'hint'} aria-live="polite">{text[draftMessage]}</p>
          {offline && <p className={offline === 'offlineFailed' ? 'error' : 'hint'} aria-live="polite">{text[offline]}</p>}
        </div>
        {error && <p className="error" role="alert">{text[error]}</p>}
        {notice && <p className="notice" role="status">{text.posted} {notice.path}</p>}
        {busy && <p className="hint" role="status">{text.processing}</p>}
        <div className="actions">
          <button type="button" className="primary" disabled={disabled} onClick={() => void run(async () => {
            if (!navigator.onLine) throw new EditorError('offlinePost');
            const article = currentArticle();
            await postArticle(article, settings.workerUrl);
            setNotice({ path: article.path });
          })}>{text.post}</button>
        </div>
        <p className="connection">{settings.workerUrl ? text.connectionPending : text.disconnected}</p>
      </footer>
      {helpOpen && <HelpDialog language={language} onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsDialog settings={settings} language={language} onClose={() => setSettingsOpen(false)} onSave={(next) => { setDraft((current) => ({ ...current, settings: next })); setSettingsOpen(false); setNotice(null); setError(null); }} />}
      {photoMenuOpen && <Modal title={text.addPhoto} closeLabel={text.close} onClose={() => setPhotoMenuOpen(false)}>
        <div className="photo-menu">
          <p className="hint">{text.insertHint}</p>
          <button className="primary full" type="button" onClick={pickPhoto}>{text.choosePhoto}</button>
        </div>
      </Modal>}
      {pendingPhoto && <Modal title={text.caption} closeLabel={text.close} onClose={() => setPendingPhoto(null)}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const inserted = insertPhoto(body, cursor.current, pendingPhoto, caption);
          setDraft((current) => ({ ...current, body: inserted.body, photos: [...current.photos, pendingPhoto] }));
          setPendingPhoto(null);
          cursor.current = inserted.cursor;
          requestAnimationFrame(() => { textArea.current?.focus(); textArea.current?.setSelectionRange(inserted.cursor, inserted.cursor); });
        }}>
          <label>{text.captionLabel}<input autoFocus value={caption} placeholder={text.captionPlaceholder} onChange={(event) => setCaption(event.currentTarget.value)} /></label>
          <p className="hint">{pendingPhoto.file.name} · {Math.round(pendingPhoto.file.size / 1024)} KB</p>
          <button className="primary full" type="submit">{text.insert}</button>
        </form>
      </Modal>}
    </main>
  );
}
