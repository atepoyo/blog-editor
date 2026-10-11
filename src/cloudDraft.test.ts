import { expect, it } from 'vitest';
import { createCloudStore, SyncError } from './cloudDraft';
import { encodeDraft } from './syncProtocol';
const endpoint = 'https://editor.example.com/posts';
const signal = new AbortController().signal;
it('直接同期では認証Cookieを送る簡易リクエストで本文を保存する', async () => {
  const draft = await encodeDraft({ title: '題', body: '本文', photos: [] }, crypto.randomUUID());
  const cloud = createCloudStore(async (input, init) => {
    expect(String(input)).toBe(`${endpoint}?draft=1`);
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('content-type')).toBe('text/plain');
    expect(JSON.parse(String(init?.body))).toEqual({ baseRevision: null, draft });
    return Response.json({ draft });
  });
  await expect(cloud.save(endpoint, null, draft, signal)).resolves.toEqual({ draft, conflict: false });
});
it('保存の成功応答に本文や写真が欠けていれば同期済みと認めない', async () => {
  const filename = '550e8400-e29b-41d4-a716-446655440000.jpg';
  const draft = await encodeDraft({ title: '題', body: '本文', photos: [{ path: `images/${filename}`, file: new File(['写真'], filename, { type: 'image/jpeg' }) }] }, crypto.randomUUID());
  for (const value of [null, { ...draft, photos: [] }, { ...draft, body: '別の本文' }, { ...draft, photos: [{ name: filename, path: '../photo.jpg', data: 'broken!' }] }]) {
    const cloud = createCloudStore(async () => Response.json({ draft: value }));
    await expect(cloud.save(endpoint, null, draft, signal)).rejects.toEqual(new SyncError('invalid'));
  }
});
it('Accessへのリダイレクトと未認証応答は再認証が必要な状態として扱う', async () => {
  for (const status of [302, 401, 403]) {
    const cloud = createCloudStore(async () => new Response(null, { status }));
    await expect(cloud.load(endpoint, signal)).rejects.toEqual(new SyncError('unauthorized'));
  }
});
