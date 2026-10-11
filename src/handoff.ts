import { parseEndpoint } from './article';
import type { Article } from './article';
import type { Draft } from './draft';
import { EditorError } from './messages';
import { encodeArticle, encodeDraftMessage, expectedWindow, handoffSignal, syncResultSchema } from './handoffProtocol';
import type { SyncResult } from './handoffProtocol';

function transfer<T>(endpoint: string, signal: AbortSignal, messageFor: (id: string) => unknown,
  popup: boolean,
  resultFrom: (data: unknown, id: string) => { result: T } | null): Promise<T> {
  if (!endpoint.trim()) throw new EditorError('workerRequired');
  const url = new URL(parseEndpoint(endpoint));
  // ユーザー操作の同期部分で開き、認証先に移動しても同じWindowを待つ。
  const target = window.open(url.href, '_blank', popup ? 'popup,width=720,height=900,resizable=yes,scrollbars=yes' : undefined);
  if (!target) throw new EditorError('popupBlocked');
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let sent = false;
    const message = messageFor(id);
    function finish(outcome: { result: T } | null) {
      clearInterval(poll); clearTimeout(timeout);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', cancel);
      if (outcome) resolve(outcome.result); else reject(new EditorError('handoffFailed'));
    }
    function cancel() { finish(null); }
    function receive(event: MessageEvent<unknown>) {
      if (!expectedWindow(event, url.origin, target)) return;
      const result = handoffSignal.safeParse(event.data);
      if (result.success && result.data.id === id && result.data.type === 'blog-md:ready' && !sent) {
        sent = true;
        try { target?.postMessage(message, url.origin); } catch { cancel(); }
      } else if (sent) {
        const outcome = resultFrom(event.data, id);
        if (outcome) finish(outcome);
      }
    }
    window.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, { once: true });
    const poll = setInterval(() => {
      if (target.closed) { cancel(); return; }
      // 認証ページには本文・写真を送らず、投稿画面の準備完了だけを待つ。
      if (!sent) target.postMessage({ type: 'blog-md:hello', id }, url.origin);
    }, 300);
    const timeout = setTimeout(cancel, 120_000);
    if (signal.aborted) cancel();
  });
}

export function handoffArticle(article: Article, endpoint: string, signal: AbortSignal): Promise<void> {
  return transfer(endpoint, signal, (id) => encodeArticle(article, id), true, (data, id) => {
    const result = handoffSignal.safeParse(data);
    return result.success && result.data.id === id && result.data.type === 'blog-md:received' ? { result: undefined } : null;
  });
}

export function handoffDraft(draft: Draft, endpoint: string, signal: AbortSignal): Promise<SyncResult> {
  if (!endpoint.trim()) throw new EditorError('workerRequired');
  const url = parseEndpoint(endpoint);
  // 旧同一originの同期先も、同じ投稿APIならrevisionを引き継ぐ。
  const sameEndpoint = draft.sync?.endpoint === url || draft.sync?.endpoint === new URL('/posts', url).href;
  const baseRevision = sameEndpoint ? draft.sync?.baseRevision ?? null : null;
  const revision = sameEndpoint ? draft.sync?.changeId ?? crypto.randomUUID() : crypto.randomUUID();
  return transfer(url, signal, (id) => encodeDraftMessage(draft, id, baseRevision, revision), false, (data, id) => {
    const result = syncResultSchema.safeParse(data);
    return result.success && result.data.id === id ? { result: result.data } : null;
  });
}
