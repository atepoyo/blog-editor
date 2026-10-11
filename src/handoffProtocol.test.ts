import { expect, it } from 'vitest';
import { decodeArticle, decodeDraftMessage, encodeArticle, encodeDraftMessage, expectedWindow } from './handoffProtocol';
import type { Article } from './article';

const id = '550e8400-e29b-41d4-a716-446655440000';
const revision = '550e8400-e29b-41d4-a716-446655440001';
const filename = '550e8400-e29b-41d4-a716-446655440002.jpg';
const article: Article = { markdown: '記事', path: 'posts/2026-10-10.md', images: [
  { path: `images/${filename}`, file: new File(['写真'], filename, { type: 'image/jpeg' }) },
] };

it('記事をBlobで渡し受信後も本文と写真の実体を保つ', async () => {
  const message = encodeArticle(article, id);
  expect(message.article.images[0]?.blob).toBeInstanceOf(Blob);
  const decoded = decodeArticle(message, id);
  expect(decoded?.path).toBe(article.path);
  expect(await decoded?.images[0]?.file.text()).toBe('写真');
});

it('不正な記事パス・写真・重複フィールド・追加tokenを受け付けない', () => {
  const message = encodeArticle(article, id);
  const photo = message.article.images[0];
  if (!photo) throw new Error('写真なし');
  const rejected = [
    { ...message, article: { ...message.article, path: '../secret.md' } },
    { ...message, article: { ...message.article, images: [{ ...photo, path: 'images/other.jpg' }] } },
    { ...message, article: { ...message.article, images: [{ ...photo, blob: new Blob(['x'], { type: 'text/plain' }) }] } },
    { ...message, token: 'unexpected' },
  ];
  for (const invalid of rejected) expect(decodeArticle(invalid, id)).toBeNull();
  expect(decodeArticle(message, revision)).toBeNull();
});

it('送信元Windowがnullならoriginが合っていても拒否する', () => {
  const event = new MessageEvent<unknown>('message', { origin: 'https://editor.example.com' });
  expect(expectedWindow(event, 'https://editor.example.com', null)).toBe(false);
  expect(expectedWindow(event, 'https://other.example.com', null)).toBe(false);
});

it('下書き写真のパス・UUID・MIME・重複・追加tokenを厳密に検証する', async () => {
  const photo = { path: `images/${filename}`, file: new File(['写真'], filename, { type: 'image/jpeg' }) };
  const message = encodeDraftMessage({ title: '題', body: '本文', photos: [photo] }, id, null, revision);
  const decoded = decodeDraftMessage(message, id);
  expect(decoded?.draft.title).toBe('題');
  expect(await decoded?.draft.photos[0]?.file.text()).toBe('写真');
  const item = message.photos[0];
  if (!item) throw new Error('写真なし');
  const rejected = [
    { ...message, photos: [{ ...item, path: '../photo.jpg' }] },
    { ...message, photos: [{ ...item, filename: 'not-a-uuid.jpg' }] },
    { ...message, photos: [{ ...item, blob: new Blob(['写真'], { type: 'text/plain' }) }] },
    { ...message, photos: [item, item] },
    { ...message, token: 'unexpected' },
  ];
  for (const invalid of rejected) expect(decodeDraftMessage(invalid, id)).toBeNull();
  expect(decodeDraftMessage(message, revision)).toBeNull();
});
