import { expect, it, vi } from 'vitest';
import { articleFormData, postArticle } from './post';
import type { Article } from './article';

const article: Article = {
  markdown: '---\ntitle: "記事"\ndate: "2026-10-07"\n---\n\n本文',
  path: 'posts/2026-10-07.md',
  images: [{ file: new File(['resized-jpeg'], 'fixed.jpg', { type: 'image/jpeg' }), path: 'images/fixed.jpg' }],
};
const endpoint = 'https://worker.example.com/posts';

it('投稿時にMarkdownと縮小画像と保存先情報を一つのFormDataへまとめる', () => {
  const form = articleFormData(article);
  expect(form.get('markdown')).toBe(article.markdown);
  expect(form.get('manifest')).toBe(JSON.stringify({ version: 1, articlePath: article.path, images: [{ field: 'image-0', filename: 'fixed.jpg', path: 'images/fixed.jpg' }] }));
  const image = form.get('image-0');
  expect(image).toBeInstanceOf(File);
  if (!(image instanceof File)) throw new Error('送信画像がありません。');
  expect(image.name).toBe('fixed.jpg');
  expect(image.type).toBe('image/jpeg');
  expect([...form.keys()]).toEqual(['markdown', 'manifest', 'image-0']);
});

it('投稿先が未設定なら画像を送らない', async () => {
  const request = vi.fn<typeof fetch>();
  await expect(postArticle(article, '', request)).rejects.toMatchObject({ key: 'workerRequired' });
  expect(request).not.toHaveBeenCalled();
});

it('保存した写真のFileを直接送らず同じ内容と種類のBlobにして元の名前を付ける', async () => {
  const append = vi.spyOn(FormData.prototype, 'append');
  try {
    const photo = article.images[0];
    if (!photo) throw new Error('確認用の写真がありません。');
    const form = articleFormData(article);
    const imagePart = append.mock.calls.find(([field]) => field === 'image-0');
    const blob = imagePart?.[1];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).not.toBeInstanceOf(File);
    if (!(blob instanceof Blob)) throw new Error('送信用の写真がありません。');
    expect(blob.type).toBe(photo.file.type);
    expect(blob.size).toBe(photo.file.size);
    expect(await blob.arrayBuffer()).toEqual(await photo.file.arrayBuffer());
    expect(imagePart?.[2]).toBe(photo.file.name);
    const sent = form.get('image-0');
    if (!(sent instanceof File)) throw new Error('フォームの写真がありません。');
    expect(sent.name).toBe(photo.file.name);
    expect(sent.type).toBe(photo.file.type);
    expect(await sent.arrayBuffer()).toEqual(await photo.file.arrayBuffer());
    expect(photo.file.name).toBe('fixed.jpg');
    expect(await photo.file.text()).toBe('resized-jpeg');
  } finally { append.mockRestore(); }
});

it('同日の記事がある場合は空いている連番で本文と写真を変えずに投稿する', async () => {
  const path = 'posts/2026-10-07-3.md';
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ exists: true }))
    .mockResolvedValueOnce(Response.json({ exists: true }))
    .mockResolvedValueOnce(Response.json({ exists: false }))
    .mockResolvedValueOnce(Response.json({ articlePath: path }, { status: 201 }));
  await expect(postArticle(article, endpoint, request)).resolves.toBe(path);
  expect(request.mock.calls.slice(0, 3).map(([url]) => new URL(String(url)).searchParams.get('path')))
    .toEqual([article.path, 'posts/2026-10-07-2.md', path]);
  expect(request.mock.calls.slice(0, 3).every(([, init]) => init?.method === 'GET')).toBe(true);
  const body = request.mock.calls[3]?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error('投稿フォームがありません。');
  expect(body.get('markdown')).toBe(article.markdown);
  expect(body.get('manifest')).toBe(JSON.stringify({ version: 1, articlePath: path,
    images: [{ field: 'image-0', filename: 'fixed.jpg', path: 'images/fixed.jpg' }] }));
  const photo = body.get('image-0');
  if (!(photo instanceof File)) throw new Error('送信画像がありません。');
  expect(await photo.text()).toBe('resized-jpeg');
  expect(article.path).toBe('posts/2026-10-07.md');
});

it('存在確認が成功してから一度だけmultipartで投稿する', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ exists: false }))
    .mockResolvedValueOnce(Response.json({ articlePath: article.path }, { status: 201 }));
  await expect(postArticle(article, endpoint, request)).resolves.toBe(article.path);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[1]?.method).toBe('POST');
  expect(request.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);
});

it('存在確認後に競合した場合も次の空いている番号へ投稿する', async () => {
  const path = 'posts/2026-10-07-3.md';
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ exists: false }))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ exists: true }))
    .mockResolvedValueOnce(Response.json({ exists: false }))
    .mockResolvedValueOnce(Response.json({ articlePath: path }, { status: 201 }));
  await expect(postArticle(article, endpoint, request)).resolves.toBe(path);
  expect(request.mock.calls.filter(([, init]) => init?.method === 'GET')
    .map(([url]) => new URL(String(url)).searchParams.get('path')))
    .toEqual([article.path, 'posts/2026-10-07-2.md', path]);
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  expect(article.images[0]?.file.name).toBe('fixed.jpg');
});

it('連番を選んだ後の確認失敗では記事と写真を送らない', async () => {
  for (const response of [Response.json({ exists: 'false' }), new Response(null, { status: 403 }), new Response(null, { status: 500 })]) {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ exists: true }))
      .mockResolvedValueOnce(response);
    await expect(postArticle(article, endpoint, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  }
});

it('連番を選んだ後の保存失敗や不正な成功応答で次の記事を作らない', async () => {
  for (const response of [new Response(null, { status: 503 }), Response.json({ articlePath: article.path }, { status: 201 })]) {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ exists: true }))
      .mockResolvedValueOnce(Response.json({ exists: false }))
      .mockResolvedValueOnce(response);
    await expect(postArticle(article, endpoint, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
    expect(article.path).toBe('posts/2026-10-07.md');
  }
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
