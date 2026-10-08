import { useEffect, useRef, useState } from 'react';
import { createDraftStore } from './draft';
import type { Draft } from './draft';

export type DraftStatus = 'loading' | 'saving' | 'saved' | 'readFailed' | 'saveFailed';

export function useDraft() {
  const [store] = useState(createDraftStore);
  const [draft, setDraft] = useState<Draft>({
    title: '', body: '', photos: [],
    settings: { publicImageUrl: '', workerUrl: '' },
  });
  const initial = useRef(draft);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState<DraftStatus>('loading');
  const pending = useRef<Draft | null>(null);
  const writing = useRef(false);
  const persisted = useRef<Draft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store.load().then((saved) => {
      if (cancelled) return;
      persisted.current = saved ?? initial.current;
      if (saved) setDraft(saved);
      setRestored(true);
      setStatus('saved');
    }).catch(() => {
      if (cancelled) return;
      setStatus('readFailed');
    });
    return () => { cancelled = true; pending.current = null; store.close(); };
  }, [store]);

  useEffect(() => {
    // 復元自体は編集ではない。古い復元結果で他タブの新しい保存を上書きしない。
    if (!restored || draft === persisted.current) return;
    pending.current = draft;
    if (writing.current) return;

    async function flush() {
      writing.current = true;
      setStatus('saving');
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        try { await store.save(next); persisted.current = next; }
        catch { setStatus('saveFailed'); writing.current = false; return; }
      }
      writing.current = false;
      setStatus('saved');
    }
    void flush();
  }, [draft, restored, store]);

  return { draft, setDraft, loading: status === 'loading', status };
}
