import { expect, it, vi } from 'vitest';
import { articleFormData, postArticle } from './post';
import type { Article } from './article';

const article: Article = {
  markdown: '---\ntitle: "記事"\ndate: "2026-10-07"\n---\n\n本文',
  path: 'posts/2026-10-07.md',
  imageStorage: 'r2',
  images: [{ file: new File(['resized-jpeg'], 'fixed.jpg', { type: 'image/jpeg' }), path: 'images/fixed.jpg' }],
};
const endpoint = 'https://worker.example.com/posts';

it('投稿時にMarkdownと縮小画像と保存先情報を一つのFormDataへまとめる', () => {
  const form = articleFormData(article);
  expect(form.get('markdown')).toBe(article.markdown);
  expect(form.get('manifest')).toBe(JSON.stringify({ version: 1, articlePath: article.path, imageStorage: 'r2', images: [{ field: 'image-0', filename: 'fixed.jpg', path: 'images/fixed.jpg' }] }));
  const image = form.get('image-0');
  expect(image).toBeInstanceOf(File);
  if (!(image instanceof File)) throw new Error('送信画像がありません。');
  expect(image.name).toBe('fixed.jpg');
  expect(image.type).toBe('image/jpeg');
  expect([...form.keys()]).toEqual(['markdown', 'manifest', 'image-0']);
});

it('投稿先が未接続なら画像を送らない', async () => {
  const request = vi.fn<typeof fetch>();
  await expect(postArticle(article, '', request)).rejects.toThrow('未接続');
  expect(request).not.toHaveBeenCalled();
});

it('同日の記事が存在する場合は画像も記事も送らない', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ exists: true }));
  await expect(postArticle(article, endpoint, request)).rejects.toThrow('上書きせず');
  expect(request).toHaveBeenCalledTimes(1);
  const url = request.mock.calls[0]?.[0];
  expect(String(url)).toContain('path=posts%2F2026-10-07.md');
});

it('存在確認が成功してから一度だけmultipartで投稿する', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ exists: false }))
    .mockResolvedValueOnce(Response.json({ articlePath: article.path }, { status: 201 }));
  await postArticle(article, endpoint, request);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[1]?.method).toBe('POST');
  expect(request.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);
});

it('存在確認後の競合も上書きせず利用者に伝える', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ exists: false })).mockResolvedValueOnce(new Response(null, { status: 409 }));
  await expect(postArticle(article, endpoint, request)).rejects.toThrow('上書きせず');
  expect(article.images[0]?.file.name).toBe('fixed.jpg');
});

it('存在確認の外部入力が不正なら画像を送らない', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ exists: 'false' }));
  await expect(postArticle(article, endpoint, request)).rejects.toThrow('応答が正しくありません');
  expect(request).toHaveBeenCalledTimes(1);
});

it('認証拒否・保存失敗・不正な成功応答を投稿成功にしない', async () => {
  for (const response of [new Response(null, { status: 401 }), new Response(null, { status: 500 }), Response.json({ articlePath: article.path }), Response.json({ articlePath: 'posts/other.md' }, { status: 201 })]) {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ exists: false })).mockResolvedValueOnce(response);
    await expect(postArticle(article, endpoint, request)).rejects.toThrow();
  }
});
