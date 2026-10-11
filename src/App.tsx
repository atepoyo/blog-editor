import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { generateArticle, insertPhoto } from './article';
import type { Photo } from './article';
import { Modal } from './Modal';
import { SettingsDialog } from './SettingsDialog';
import { HelpDialog } from './HelpDialog';
import { resizePhoto } from './photo';
import { handoffArticle } from './handoff';
import { createCloudStore, SyncError } from './cloudDraft';
import { encodeDraft } from './syncProtocol';
import { EditorError, messages } from './messages';
import type { Language, MessageKey } from './messages';
import { useDraft } from './useDraft';
import type { DraftStatus, SyncStatus } from './useDraft';
import { registerOffline } from './offline';

const draftMessages = { loading: 'draftLoading', saving: 'draftSaving', readFailed: 'draftReadFailed', saveFailed: 'draftSaveFailed' } satisfies Record<Exclude<DraftStatus, 'saved'>, MessageKey>;
const syncMessages = { disconnected: 'syncDisconnected', checking: 'syncChecking', pending: 'syncPending', syncing: 'syncSending',
  synced: 'syncSaved', offline: 'syncOffline', failed: 'syncFailed', unauthorized: 'syncUnauthorized', conflict: 'syncConflict' } satisfies Record<SyncStatus, MessageKey>;

export function App() {
  const [language, setLanguage] = useState<Language>('ja');
  const [helpOpen, setHelpOpen] = useState(false);
  const [clearDraftOpen, setClearDraftOpen] = useState(false);
  const text = messages[language];
  const { draft, setDraft, clearDraft, loading, status, syncStatus, acceptManualSync, resolveConflict, exportConflict } = useDraft();
  const { title, body, photos, settings } = draft;
  const [pendingPhoto, setPendingPhoto] = useState<Photo | null>(null);
  const [caption, setCaption] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const disabled = busy || loading;
  const [offline, setOffline] = useState<'offlinePreparing' | 'offlineReady' | 'offlineFailed' | null>(import.meta.env.PROD ? 'offlinePreparing' : null);
  const draftMessage = status === 'saved' ? null : draftMessages[status];
  const [notice, setNotice] = useState<{ path: string } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cursor = useRef(0);
  const operation = useRef(false);
  const handoff = useRef<AbortController | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  useEffect(() => cancelPress, []);
  useEffect(() => () => handoff.current?.abort(), []);
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

  async function syncDraft(action: 'save' | 'load') {
    if (!navigator.onLine) throw new EditorError('syncOffline');
    const expected = draft;
    const endpoint = new URL('/posts', settings.workerUrl).href;
    const cloud = createCloudStore();
    const controller = new AbortController();
    try {
      if (action === 'load') {
        const result = await cloud.load(endpoint, controller.signal);
        if (!result) throw new EditorError('syncEmpty');
        await acceptManualSync(result, 'loaded', expected);
      } else {
        const sameEndpoint = expected.sync?.endpoint === settings.workerUrl || expected.sync?.endpoint === endpoint;
        const revision = sameEndpoint ? expected.sync?.changeId ?? crypto.randomUUID() : crypto.randomUUID();
        const value = await encodeDraft(expected, revision);
        const result = await cloud.save(endpoint, sameEndpoint ? expected.sync?.baseRevision ?? null : null, value, controller.signal);
        await acceptManualSync(result.draft, result.conflict ? 'conflict' : 'saved', expected);
      }
    } catch (reason) {
      if (reason instanceof SyncError) throw new EditorError(reason.kind === 'unauthorized' ? 'syncUnauthorized' : 'syncFailed');
      throw reason;
    }
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand">Blog.md</div>
        <nav aria-label={text.navigation}>
          <button className="quiet language" type="button" disabled={disabled} onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}>{language === 'ja' ? 'English' : '日本語'}</button>
          <button className="quiet" type="button" aria-haspopup="dialog" disabled={disabled} onClick={() => setHelpOpen(true)}>{text.help}</button>
          <button className="quiet" type="button" aria-haspopup="dialog" disabled={disabled} onClick={() => setSettingsOpen(true)}>{text.settings}</button>
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
        <input ref={fileInput} type="file" accept="image/*,.heic,.heif" aria-label={text.photoInput} className="file-input" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void run(async () => { const photo = await resizePhoto(file); setCaption(''); setPendingPhoto(photo); });
        }} />
      </section>
      <footer className="editor-footer">
        {error && <p className="error" role="alert">{text[error]}</p>}
        {notice && <p className="notice" role="status">{text.handedOff} {notice.path}</p>}
        {busy && <p className="hint" role="status">{text.processing}</p>}
        <div className="publish-row">
          <button className="quiet photo-add" type="button" disabled={disabled} onClick={pickPhoto}>＋ {text.addPhoto}</button>
          <button type="button" className="primary" disabled={disabled} onClick={() => void run(async () => {
            if (!navigator.onLine) throw new EditorError('offlinePost');
            const article = currentArticle();
            const controller = new AbortController();
            handoff.current = controller;
            try { await handoffArticle(article, settings.workerUrl, controller.signal); }
            finally { handoff.current = null; }
            setNotice({ path: article.path });
          })}>{text.post}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></button>
        </div>
        <div className="editor-notes">
          <p className="hint"><span>{photos.length ? text.photoCount.replace('{count}', String(photos.length)) : text.photoHint}</span></p>
          <p className="hint">{text.imageHint}</p>
          <div className="local-status" data-testid="draft-status" data-state={status}>
            {draftMessage && <p className={status === 'readFailed' || status === 'saveFailed' ? 'error' : 'hint'} aria-live="polite">{text[draftMessage]}</p>}
            {offline && (offline !== 'offlineReady' || status === 'saved') && <p className={offline === 'offlineFailed' ? 'error' : 'hint'} aria-live="polite">{text[offline]}</p>}
          </div>
        </div>
        {busy && handoff.current && <button type="button" className="quiet" onClick={() => handoff.current?.abort()}>{text.cancelHandoff}</button>}
        <div className="sync-panel">
          <div className="sync-summary">
            <div className="sync-description">
              <p className={['failed', 'unauthorized', 'conflict'].includes(syncStatus) ? 'error' : 'hint'} aria-live="polite" data-testid="sync-status">{text[syncStatus === 'disconnected' ? 'disconnected' : syncMessages[syncStatus]]}</p>
            </div>
          </div>
          {settings.workerUrl && <div className="sync-actions">
            <button className="quiet" type="button" disabled={disabled || status !== 'saved'} onClick={() => void run(() => syncDraft('save'))}>{text.syncSave}</button>
            <button className="quiet" type="button" disabled={disabled || status !== 'saved'} onClick={() => void run(() => syncDraft('load'))}>{text.syncLoad}</button>
          </div>}
          {draft.sync?.conflict && <section className="sync-conflict" aria-label={text.syncConflict}>
            <div className="conflict-actions">
              <button className="quiet" type="button" disabled={status !== 'saved'} onClick={() => void run(() => resolveConflict('local'))}>{text.syncUseLocal}</button>
              <button className="quiet" type="button" disabled={status !== 'saved'} onClick={() => void run(() => resolveConflict('cloud'))}>{text.syncUseCloud}</button>
            </div>
          </section>}
          {(draft.sync?.conflict || draft.sync?.backup) && <button className="quiet sync-export" type="button" onClick={() => void run(async () => {
            const data = await exportConflict();
            const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url; link.download = 'blog-md-conflict.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>{text.syncExport}</button>}
        </div>
        <div className="draft-management">
          <button type="button" className="quiet danger-text" aria-haspopup="dialog"
            disabled={disabled || status !== 'saved'}
            onClick={() => setClearDraftOpen(true)}>{text.clearDraft}</button>
        </div>
      </footer>
      {clearDraftOpen && <Modal title={text.confirmClearDraft} closeLabel={text.close} onClose={() => setClearDraftOpen(false)}>
        <p>{text.clearDraftWarning}</p>
        <div className="dialog-actions">
          <button className="quiet" type="button" onClick={() => setClearDraftOpen(false)}>{text.cancel}</button>
          <button className="danger" type="button" onClick={() => {
            setClearDraftOpen(false);
            void run(async () => { await clearDraft(); cursor.current = 0; });
          }}>{text.confirmDelete}</button>
        </div>
      </Modal>}
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
