import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import type { Article } from './article';
import { decodeArticle, decodeDraftMessage, expectedWindow, handoffSignal } from './handoffProtocol';
import { destinationSchema } from '../worker/destination';
import type { Destination } from '../worker/destination';
import { SyncConfirmation } from './SyncConfirmation';
import type { SyncSession } from './SyncConfirmation';
import { MarkdownPreview } from './MarkdownPreview';
import { EditorError, messages } from './messages';
import { postArticle } from './post';
import './style.css';

const originSchema = z.url().refine((value) => new URL(value).origin === value);

function Publish() {
  const [article, setArticle] = useState<Article | null>(null);
  const [syncSession, setSyncSession] = useState<SyncSession | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOrigin, setEditorOrigin] = useState('');
  useEffect(() => {
    let active = true;
    const opener: Window | null = window.opener;
    const origin = originSchema.safeParse(document.querySelector('meta[name="blog-editor-origin"]')?.getAttribute('content'));
    if (origin.success) setEditorOrigin(origin.data);
    if (!opener || !origin.success) {
      setError('共通Editorの「投稿」から開き直してください。元の下書きと写真は残っています。');
      return;
    }
    let id: string | null = null;
    let received = false;
    let ready = false;
    function receive(event: MessageEvent<unknown>) {
      if (!origin.success || received || !ready || !expectedWindow(event, origin.data, opener)) return;
      const result = handoffSignal.safeParse(event.data);
      if (result.success && result.data.type === 'blog-md:hello' && (!id || id === result.data.id)) {
        id = result.data.id;
        opener?.postMessage({ type: 'blog-md:ready', id }, origin.data);
      } else if (id) {
        const incoming = decodeArticle(event.data, id);
        const incomingDraft = decodeDraftMessage(event.data, id);
        if (!incoming && !incomingDraft) return;
        received = true;
        if (incoming) {
          setArticle(incoming);
          opener?.postMessage({ type: 'blog-md:received', id }, origin.data);
          window.opener = null;
        } else if (incomingDraft) {
          const sessionId = id;
          setSyncSession({ ...incomingDraft, returnDraft: (draft, action) => {
            opener?.postMessage({ type: 'blog-md:sync-result', id: sessionId, action, draft }, origin.data);
            window.opener = null;
          } });
        }
        window.removeEventListener('message', receive);
      }
    }
    window.addEventListener('message', receive);
    void fetch('/posts?destination=1', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
      .then(async (response) => {
        if (!response.ok) throw new Error('投稿先の認証と設定を確認し、共通Editorから開き直してください。');
        const config = destinationSchema.parse(await response.json());
        if (active) { setDestination(config); ready = true; }
      }).catch(() => {
        if (active) setError('投稿先を確認できません。ログインとWorker設定を確認し、共通Editorから開き直してください。');
      });
    return () => { active = false; window.removeEventListener('message', receive); };
  }, []);

  return <main className="publish-page">
    <header className="app-header"><h1>{syncSession ? '下書きの同期' : '投稿の確認'}</h1></header>
    {!syncSession && <p>投稿先と本文・写真を確認してから、投稿を確定してください。</p>}
    {destination && !syncSession && <dl>
      <dt>投稿先</dt><dd>GitHub {destination.owner}/{destination.repository}</dd>
    </dl>}
    {!article && !syncSession && !error && <p role="status">共通Editorから記事と写真を受け取るのを待っています。</p>}
    {syncSession && <SyncConfirmation session={syncSession} />}
    {article && <>
      <MarkdownPreview article={article} />
      <button className="primary full" disabled={!destination || busy || saved} onClick={async () => {
        if (busy || saved) return;
        setBusy(true); setError(null);
        try {
          await postArticle(article, new URL('/posts', location.origin).href);
          setSaved(true);
        }
        catch (reason) { setError(reason instanceof EditorError ? messages.ja[reason.key] : messages.ja.operationFailed); }
        finally { setBusy(false); }
      }}>投稿を確定</button>
    </>}
    {busy && <p role="status">投稿中…</p>}
    {saved && <p role="status">投稿しました。</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {editorOrigin && <button className="quiet full" type="button" onClick={() => {
      window.close();
      if (!window.closed) window.location.assign(editorOrigin);
    }}>元の画面に戻る</button>}
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('投稿画面の表示先がありません。');
createRoot(root).render(<Publish />);
