import { useState } from 'react';
import { Modal } from './Modal';
import { parseEndpoint } from './article';
import type { Settings } from './article';
import { EditorError, messages } from './messages';
import type { Language, MessageKey } from './messages';

export function SettingsDialog({ settings, language, onSave, onClose }: { settings: Settings; language: Language; onSave: (settings: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState<MessageKey | null>(null);
  const text = messages[language];
  let loginUrl: string | undefined;
  try {
    const endpoint = new URL(parseEndpoint(draft.workerUrl));
    if (endpoint.origin === location.origin && endpoint.pathname === '/posts') {
      loginUrl = new URL('/auth/login', endpoint).href;
    }
  } catch { /* 入力途中のURLではログイン先を表示しない。 */ }
  return (
    <Modal title={text.settings} closeLabel={text.close} onClose={onClose}>
      <form className="settings-form" onSubmit={(event) => {
        event.preventDefault();
        try {
          if (draft.publicImageUrl.trim()) parseEndpoint(draft.publicImageUrl);
          if (draft.workerUrl.trim()) parseEndpoint(draft.workerUrl);
          onSave({ ...draft, publicImageUrl: draft.publicImageUrl.trim(), workerUrl: draft.workerUrl.trim() });
        } catch (reason) {
          setError(reason instanceof EditorError ? reason.key : 'invalidUrl');
        }
      }}>
        <div className="field-group">
          <label className="field">{text.publicUrl}<input aria-describedby="public-url-help" type="url" inputMode="url" placeholder="https://img.example.com/" value={draft.publicImageUrl} onChange={(event) => setDraft({ ...draft, publicImageUrl: event.currentTarget.value })} /></label>
          <div id="public-url-help" className="field-help">
            <p className="hint">{text.r2Hint}</p>
          </div>
        </div>
        <div className="field-group">
          <label className="field">{text.workerUrl}<input aria-describedby="worker-url-help" type="url" inputMode="url" placeholder="https://editor.example.com/posts" value={draft.workerUrl} onChange={(event) => setDraft({ ...draft, workerUrl: event.currentTarget.value })} /></label>
          <p id="worker-url-help" className="hint">{text.workerHint}</p>
          {loginUrl && <a href={loginUrl} target="_blank" rel="noopener noreferrer">{text.signIn}</a>}
        </div>
        <p className="hint">{text.sessionHint}</p>
        {error && <p role="alert" className="error">{text[error]}</p>}
        <button type="submit" className="primary full">{text.apply}</button>
      </form>
    </Modal>
  );
}
