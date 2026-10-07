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
        <label className="field">{text.imageStorage}<select value={draft.imageStorage} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === 'r2' || value === 'github') setDraft({ ...draft, imageStorage: value });
        }}><option value="r2">Cloudflare R2</option><option value="github">GitHub</option></select></label>
        <div className="field-group">
          <label className="field">{text.publicUrl}<input aria-describedby="public-url-help" type="url" inputMode="url" placeholder="https://img.example.com/" value={draft.publicImageUrl} onChange={(event) => setDraft({ ...draft, publicImageUrl: event.currentTarget.value })} /></label>
          <div id="public-url-help" className="field-help">
            <p className="hint">{draft.imageStorage === 'r2' ? text.r2Hint : text.githubHint}</p>
          </div>
        </div>
        <div className="field-group">
          <label className="field">{text.workerUrl}<input aria-describedby="worker-url-help" type="url" inputMode="url" placeholder="https://app.me.workers.dev/posts" value={draft.workerUrl} onChange={(event) => setDraft({ ...draft, workerUrl: event.currentTarget.value })} /></label>
          <p id="worker-url-help" className="hint">{text.workerHint}</p>
        </div>
        <p className="hint">{text.sessionHint}</p>
        {error && <p role="alert" className="error">{text[error]}</p>}
        <button type="submit" className="primary full">{text.apply}</button>
      </form>
    </Modal>
  );
}
