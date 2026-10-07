import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { generateArticle, insertPhoto } from './article';
import type { Photo, Settings } from './article';
import { Modal } from './Modal';
import { SettingsDialog } from './SettingsDialog';
import { HelpDialog } from './HelpDialog';
import { resizePhoto } from './photo';
import { postArticle } from './post';
import { EditorError, messages } from './messages';
import type { Language, MessageKey } from './messages';

export function App() {
  const [language, setLanguage] = useState<Language>('ja');
  const [helpOpen, setHelpOpen] = useState(false);
  const text = messages[language];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pendingPhoto, setPendingPhoto] = useState<Photo | null>(null);
  const [caption, setCaption] = useState('');
  const [settings, setSettings] = useState<Settings>({ imageStorage: 'r2', publicImageUrl: '', workerUrl: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: 'copied' | 'posted'; path: string } | null>(null);
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

  function beginPress(event: PointerEvent<HTMLTextAreaElement>) {
    if (busy || event.button !== 0) return;
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
          <button className="quiet language" type="button" disabled={busy} onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}>{language === 'ja' ? 'English' : '日本語'}</button>
          <button className="quiet" type="button" aria-haspopup="dialog" disabled={busy} onClick={() => setHelpOpen(true)}>{text.help}</button>
          <button className="quiet" type="button" disabled={busy} onClick={() => setSettingsOpen(true)}>{text.settings}</button>
        </nav>
      </header>
      <section className="editor" aria-label={text.editor}>
        <input aria-label={text.title} className="title-input" placeholder={text.title} value={title} disabled={busy} onChange={(event) => { setTitle(event.currentTarget.value); setNotice(null); }} />
        <textarea className="body-input" aria-label={text.body} ref={textArea} placeholder={text.body} value={body} disabled={busy}
          onChange={(event) => { setBody(event.currentTarget.value); setNotice(null); }}
          onSelect={(event) => { cursor.current = event.currentTarget.selectionStart; }}
          onPointerDown={beginPress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
          onPointerMove={(event) => {
            if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!busy) { cursor.current = event.currentTarget.selectionStart; setPhotoMenuOpen(true); }
          }}
        />
        <div className="photo-toolbar"><button className="quiet" type="button" disabled={busy} onClick={pickPhoto}>＋ {text.addPhoto}</button><span>{photos.length ? text.photoCount.replace('{count}', String(photos.length)) : text.photoHint}</span></div>
        <input ref={fileInput} type="file" accept="image/*,.heic,.heif" aria-label={text.photoInput} className="file-input" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void run(async () => { const photo = await resizePhoto(file); setCaption(''); setPendingPhoto(photo); });
        }} />
      </section>
      <footer className="editor-footer">
        <p className="hint">{text.imageHint}</p>
        {error && <p className="error" role="alert">{text[error]}</p>}
        {notice && <p className="notice" role="status">{text[notice.key]} {notice.path}</p>}
        {busy && <p className="hint" role="status">{text.processing}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const article = currentArticle();
            if (!navigator.clipboard?.writeText) throw new EditorError('clipboardUnavailable');
            await navigator.clipboard.writeText(article.markdown);
            setNotice({ key: 'copied', path: article.path });
          })}>{text.copy}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
            const article = currentArticle();
            await postArticle(article, settings.workerUrl);
            setNotice({ key: 'posted', path: article.path });
          })}>{text.post}</button>
        </div>
        <p className="connection">{settings.workerUrl ? text.connectionPending : text.disconnected}</p>
      </footer>
      {helpOpen && <HelpDialog language={language} onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsDialog settings={settings} language={language} onClose={() => setSettingsOpen(false)} onSave={(next) => { setSettings(next); setSettingsOpen(false); setNotice(null); setError(null); }} />}
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
          setBody(inserted.body);
          setPhotos([...photos, pendingPhoto]);
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
