import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import type { Article } from './article';
import { decodeArticle, decodeDraftMessage, encodeEditArticle, expectedWindow, handoffSignal, isEditRequest } from './handoffProtocol';
import { destinationSchema } from '../worker/destination';
import type { Destination } from '../worker/destination';
import { SyncConfirmation } from './SyncConfirmation';
import type { SyncSession } from './SyncConfirmation';
import { MarkdownPreview } from './MarkdownPreview';
import { EditorError, messages } from './messages';
import { postArticle } from './post';
import { parsePublishedArticle } from './article';
import './style.css';

const originSchema = z.url().refine((value) => new URL(value).origin === value);
const articleListSchema = z.object({ articles: z.array(z.object({ path: z.string(), title: z.string() })) });
const publishedArticleSchema = z.object({ path: z.string(), markdown: z.string(), sha: z.string() });

function Publish() {
  const [article, setArticle] = useState<Article | null>(null);
  const [syncSession, setSyncSession] = useState<SyncSession | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOrigin, setEditorOrigin] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [editArticles, setEditArticles] = useState<{ path: string; title: string }[] | null>(null);
  const [selectingPath, setSelectingPath] = useState<string | null>(null);
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
        if (isEditRequest(event.data, id)) {
          received = true;
          setEditMode(true);
          setEditSessionId(id);
          void fetch('/posts?articles=1', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
            .then(async (response) => {
              if (!response.ok) throw new Error('過去の記事を取得できません。投稿先の設定を確認してください。');
              const parsed = articleListSchema.safeParse(await response.json());
              if (!parsed.success) throw new Error('過去の記事の一覧を読み取れません。');
              setEditArticles(parsed.data.articles);
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '過去の記事を取得できません。'));
          window.removeEventListener('message', receive);
          return;
        }
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
    <header className="app-header"><h1>{editMode ? '過去の記事を編集' : syncSession ? '下書きの同期' : '投稿の確認'}</h1></header>
    {!syncSession && !editMode && <p>投稿先と本文・写真を確認してから、投稿を確定してください。</p>}
    {destination && !syncSession && !editMode && <dl>
      <dt>投稿先</dt><dd>GitHub {destination.owner}/{destination.repository}</dd>
    </dl>}
    {!article && !syncSession && !editMode && !error && <p role="status">共通Editorから記事と写真を受け取るのを待っています。</p>}
    {editMode && <section aria-label="編集する記事">
      <p>編集する記事を選んでください。</p>
      {editArticles === null ? <p role="status">過去の記事を読み込んでいます…</p> : editArticles.length === 0
        ? <p role="status">記事がありません。</p>
        : <ul className="published-articles">
          {editArticles.map((item) => <li key={item.path}>
            <button className="quiet full" type="button" disabled={selectingPath !== null} onClick={async () => {
              if (!editSessionId || selectingPath) return;
              setSelectingPath(item.path); setError(null);
              try {
                const response = await fetch(`/posts?article=${encodeURIComponent(item.path)}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
                if (!response.ok) throw new Error('記事を取得できません。もう一度選んでください。');
                const result = publishedArticleSchema.safeParse(await response.json());
                if (!result.success || result.data.path !== item.path) throw new Error('記事を読み取れません。');
                parsePublishedArticle(result.data.markdown, result.data.path, result.data.sha);
                const opener = window.opener;
                if (!opener || !editorOrigin) throw new Error('元の編集画面に戻れません。');
                opener.postMessage(encodeEditArticle(result.data, editSessionId), editorOrigin);
                window.opener = null;
                setSaved(true);
                setTimeout(() => window.close(), 50);
              } catch (reason) { setError(reason instanceof Error ? reason.message : '記事を取得できません。'); }
              finally { setSelectingPath(null); }
            }}>
              {item.title}<span className="article-path">{item.path}</span>
              {selectingPath === item.path && <span role="status">読み込み中…</span>}
            </button>
          </li>)}
        </ul>}
      {saved && <p role="status">記事を編集画面に読み込みました。</p>}
    </section>}
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
