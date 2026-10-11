import { expect, it, vi } from 'vitest';
import { handleDraftSync } from './draftSync';
import type { DraftBucket } from './draftSync';
import { encodeDraft, syncResponseSchema } from '../src/syncProtocol';

export class MemoryDraftBucket implements DraftBucket {
  value: string | null = null;
  etag = 0;
  async get() {
    const value = this.value;
    return value === null ? null : { etag: String(this.etag), json: async (): Promise<unknown> => JSON.parse(value) };
  }
  async put(_key: string, value: string, options: { onlyIf: Headers }) {
    if (this.value === null ? options.onlyIf.get('if-none-match') !== '*' : options.onlyIf.get('if-match') !== `"${this.etag}"`) return null;
    this.value = value; ++this.etag; return { etag: String(this.etag) };
  }
}
const revision = '550e8400-e29b-41d4-a716-446655440000';
function post(body: unknown) {
  return new Request('https://editor.example.com/posts?draft=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function snapshot(id = revision, body = '本文と写真') {
  return encodeDraft({ title: 'タイトル', body, photos: [{ path: `images/${revision}.jpg`, file: new File(['非公開の写真'], `${revision}.jpg`, { type: 'image/jpeg' }) }] }, id);
}
it('本文と写真の全体を保存し競合した更新を上書きしない', async () => {
  const bucket = new MemoryDraftBucket(); const draft = await snapshot();
  expect((await handleDraftSync(post({ baseRevision: null, draft }), bucket)).status).toBe(200);
  const newer = await snapshot(crypto.randomUUID(), '他端末の本文');
  expect((await handleDraftSync(post({ baseRevision: revision, draft: newer }), bucket)).status).toBe(200);
  const result = await handleDraftSync(post({ baseRevision: revision, draft: await snapshot(crypto.randomUUID(), '古い端末') }), bucket);
  expect(result.status).toBe(409);
  expect(syncResponseSchema.parse(await result.json()).draft).toEqual(newer);
});
it('同時に同じ版を保存する二端末のうち一方だけが成功する', async () => {
  const bucket = new MemoryDraftBucket();
  const drafts = await Promise.all([snapshot(), snapshot(crypto.randomUUID(), '別端末')]);
  const result = await Promise.all(drafts.map((draft) => handleDraftSync(post({ baseRevision: null, draft }), bucket)));
  expect(result.map((value) => value.status).sort()).toEqual([200, 409]);
});
it('応答を失った同内容の再送は成功し同じ版の別写真は拒否する', async () => {
  const bucket = new MemoryDraftBucket(); const draft = await snapshot();
  await handleDraftSync(post({ baseRevision: null, draft }), bucket);
  expect((await handleDraftSync(post({ baseRevision: null, draft }), bucket)).status).toBe(200);
  const photos = draft.photos.map((photo) => ({ ...photo, data: btoa('different photo') }));
  expect((await handleDraftSync(post({ baseRevision: null, draft: { ...draft, photos } }), bucket)).status).toBe(400);
  expect(bucket.etag).toBe(1);
});
it('text/plainのJSONも保存し不正な本文や契約外の値は拒否する', async () => {
  const bucket = new MemoryDraftBucket(); const draft = await snapshot();
  const plainText = (body: string) => new Request('https://editor.example.com/posts?draft=1', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body,
  });
  expect((await handleDraftSync(plainText(JSON.stringify({ baseRevision: null, draft })), bucket)).status).toBe(200);
  expect((await handleDraftSync(plainText('{'), bucket)).status).toBe(400);
  expect((await handleDraftSync(plainText(JSON.stringify({ baseRevision: null, draft: { version: 2 } })), bucket)).status).toBe(400);
  expect(bucket.etag).toBe(1);
});
it('写真を含む保存が失敗した場合は直前の完全な下書きを保持する', async () => {
  const bucket = new MemoryDraftBucket(); const draft = await snapshot();
  await handleDraftSync(post({ baseRevision: null, draft }), bucket);
  vi.spyOn(bucket, 'put').mockRejectedValue(new Error('写真を含む保存失敗'));
  expect((await handleDraftSync(post({ baseRevision: revision, draft: await snapshot(crypto.randomUUID()) }), bucket)).status).toBe(503);
  expect(syncResponseSchema.parse(await (await handleDraftSync(new Request('https://editor.example.com/posts?draft=1'), bucket)).json()).draft).toEqual(draft);
});
it('契約外の設定・重複写真・不正な写真データとパスを保存前に拒否する', async () => {
  const bucket = new MemoryDraftBucket(); const draft = await snapshot(); const put = vi.spyOn(bucket, 'put');
  const photo = draft.photos[0]; if (!photo) throw new Error('写真なし');
  for (const invalid of [{ ...draft, settings: {} }, { ...draft, photos: [photo, photo] }, { ...draft, photos: [{ ...photo, path: '../public.jpg' }] }, { ...draft, photos: [{ ...photo, data: '不正なbase64' }] }]) {
    expect((await handleDraftSync(post({ baseRevision: null, draft: invalid }), bucket)).status).toBe(400);
  }
  expect(put).not.toHaveBeenCalled();
});
