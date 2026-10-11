import { useEffect, useState } from 'react';
import { createCloudStore } from './cloudDraft';
import { encodeDraft } from './syncProtocol';
import type { CloudDraft, SharedDraft } from './syncProtocol';

export interface SyncSession {
  draft: SharedDraft;
  baseRevision: string | null;
  revision: string;
  returnDraft(draft: CloudDraft, action: 'saved' | 'loaded' | 'conflict'): void;
}

export function SyncConfirmation({ session }: { session: SyncSession }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CloudDraft | null>(null);
  const [abort] = useState(() => new AbortController());
  const [cloud] = useState(() => createCloudStore());
  useEffect(() => () => abort.abort(), [abort]);
  const endpoint = new URL('/posts', location.origin).href;
  async function run(action: () => Promise<void>) {
    if (busy || done) return;
    setBusy(true); setError(null);
    try { await action(); }
    catch { setError('同期できませんでした。ログインと下書きバケットの設定を確認してください。元の下書きと写真は残っています。'); }
    finally { setBusy(false); }
  }
  function returnDraft(draft: CloudDraft, action: 'saved' | 'loaded' | 'conflict') {
    session.returnDraft(draft, action);
    setDone(true);
  }
  return <section className="publish-page" aria-label="下書きの同期">
    <button className="primary full" disabled={busy || done || conflict !== null} onClick={() => void run(async () => {
      const encoded = await encodeDraft(session.draft, session.revision);
      const result = await cloud.save(endpoint, session.baseRevision, encoded, abort.signal);
      if (result.conflict) { setConflict(result.draft); return; }
      returnDraft(result.draft, 'saved');
    })}>この端末の下書きをクラウドに保存</button>
    <button className="secondary full" disabled={busy || done} onClick={() => void run(async () => {
      const value = await cloud.load(endpoint, abort.signal);
      if (!value) { setError('クラウドに下書きがありません。'); return; }
      returnDraft(value, 'loaded');
    })}>クラウドの下書きをEditorへ取得</button>
    {conflict && <section>
      <p>別の端末の更新があります。上書きせず止めました。</p>
      <button className="secondary full" disabled={busy || done} onClick={() => returnDraft(conflict, 'conflict')}>双方の下書きをEditorで確認</button>
    </section>}
    {busy && <p role="status">同期中…</p>}
    {done && <p role="status">Editorへ同期結果を送りました。元のタブで確認してください。</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
