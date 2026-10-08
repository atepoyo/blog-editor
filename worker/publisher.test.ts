import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';
import gateway from './gateway';
import { accessConfig, verifyAccess } from './access';
import { ArticleConflictError } from './github';
import { handlePublisher } from './publisher';
import type { ArticleStore, ImageBucket } from './publisher';

const configuration = {
  EDITOR_ORIGIN: 'https://editor.example.com', ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
  ACCESS_AUD: 'audience', ALLOWED_EMAILS: 'owner@example.com',
};
const config = accessConfig(configuration);
const keyPair = await generateKeyPair('RS256');
const publicKey = await exportJWK(keyPair.publicKey);
publicKey.kid = 'test';
const resolver = createLocalJWKSet({ keys: [publicKey] });
const filename = '550e8400-e29b-41d4-a716-446655440000.jpg';
const path = `images/${filename}`;

async function accessToken(options: { email?: string; issuer?: string; audience?: string; expires?: number; type?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: options.email ?? 'owner@example.com', type: options.type ?? 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(options.issuer ?? config.ACCESS_ISSUER)
    .setAudience(options.audience ?? config.ACCESS_AUD).setSubject('user-id').setIssuedAt(now)
    .setExpirationTime(options.expires ?? now + 300).sign(keyPair.privateKey);
}

function form(includeImage = true): FormData {
  const data = new FormData();
  data.set('markdown', '記事の本文');
  data.set('manifest', JSON.stringify({ version: 1, articlePath: 'posts/2026-10-08.md',
    images: includeImage ? [{ field: 'image-0', filename, path }] : [],
  }));
  if (includeImage) data.set('image-0', new File(['写真'], filename, { type: 'image/jpeg' }));
  return data;
}

function post(token: string, body = form(false), origin = configuration.EDITOR_ORIGIN): Request {
  return new Request(`${configuration.EDITOR_ORIGIN}/posts`, {
    method: 'POST', headers: { origin, 'cf-access-jwt-assertion': token }, body,
  });
}

class MemoryStore implements ArticleStore {
  articles = new Map<string, string>();
  async exists(articlePath: string): Promise<boolean> { return this.articles.has(articlePath); }
  async createArticle(articlePath: string, markdown: string): Promise<void> {
    if (this.articles.has(articlePath)) throw new ArticleConflictError();
    this.articles.set(articlePath, markdown);
  }
}

class MemoryBucket implements ImageBucket {
  objects = new Map<string, ArrayBuffer>();
  async get(imagePath: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(imagePath);
    return value ? { arrayBuffer: async () => value.slice(0) } : null;
  }
  async put(imagePath: string, data: ArrayBuffer, options: { onlyIf: Headers; httpMetadata: { contentType: string } }): Promise<object | null> {
    expect(options.onlyIf.get('if-none-match')).toBe('*');
    expect(options.httpMetadata.contentType).toBe('image/jpeg');
    if (this.objects.has(imagePath)) return null;
    this.objects.set(imagePath, data.slice(0));
    return { key: imagePath };
  }
}

function dependencies(store = new MemoryStore()) {
  const connect = vi.fn(async (): Promise<ArticleStore> => store);
  return { connect, verify: (request: Request, policy: typeof config) => verifyAccess(request, policy, resolver) };
}

it('署名・発行者・対象アプリ・期限・許可する利用者が揃った認証だけを通す', async () => {
  expect(await verifyAccess(post(await accessToken()), config, resolver)).toBe(true);
  for (const token of [
    'forged-token', await accessToken({ issuer: 'https://other.cloudflareaccess.com' }),
    await accessToken({ audience: 'other' }), await accessToken({ email: 'other@example.com' }),
    await accessToken({ expires: Math.floor(Date.now() / 1000) - 1 }), await accessToken({ type: 'org' }),
  ]) expect(await verifyAccess(post(token), config, resolver)).toBe(false);
  expect(await verifyAccess(new Request(configuration.EDITOR_ORIGIN), config, resolver)).toBe(false);
});

it('認証がないか偽造されている場合は秘密鍵と保存先へ接続しない', async () => {
  const deps = dependencies();
  const result = await handlePublisher(post('forged-token'), configuration, deps);
  expect(result.status).toBe(403);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('許可された利用者でも別サイトからの投稿は保存しない', async () => {
  const deps = dependencies();
  const result = await handlePublisher(post(await accessToken(), form(false), 'https://other.example.com'), configuration, deps);
  expect(result.status).toBe(403);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('Accessの設定が不足していても認証なしで動作する経路へ切り替えない', async () => {
  const deps = dependencies();
  const result = await handlePublisher(post(await accessToken()), {}, deps);
  expect(result.status).toBe(503);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('不正な投稿と任意パスと更新・削除は保存先へ接続する前に拒否する', async () => {
  const token = await accessToken();
  const invalid = form();
  invalid.append('repository', 'other/repo');
  const requests = [
    post(token, invalid),
    new Request(`${configuration.EDITOR_ORIGIN}/posts?path=../README.md`, { headers: { 'cf-access-jwt-assertion': token } }),
    new Request(`${configuration.EDITOR_ORIGIN}/posts?path=posts/2026-10-08.md&path=posts/2026-10-09.md`, { headers: { 'cf-access-jwt-assertion': token } }),
    new Request(`${configuration.EDITOR_ORIGIN}/posts`, { method: 'DELETE', headers: { 'cf-access-jwt-assertion': token } }),
    new Request(`${configuration.EDITOR_ORIGIN}/secret`, { headers: { 'cf-access-jwt-assertion': token } }),
  ];
  for (const request of requests) {
    const deps = dependencies();
    expect((await handlePublisher(request, configuration, deps)).status).toBeGreaterThanOrEqual(400);
    expect(deps.connect).not.toHaveBeenCalled();
  }
});

it('既存記事がある日は画像も記事も書き込まない', async () => {
  const store = new MemoryStore();
  store.articles.set('posts/2026-10-08.md', '既存の記事');
  const bucket = new MemoryBucket();
  const result = await handlePublisher(post(await accessToken(), form()), { ...configuration, IMAGES: bucket }, dependencies(store));
  expect(result.status).toBe(409);
  expect(store.articles.get('posts/2026-10-08.md')).toBe('既存の記事');
  expect(bucket.objects.size).toBe(0);
});

it('R2の写真を保存してから記事を新規作成する', async () => {
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const create = vi.spyOn(store, 'createArticle').mockImplementation(async (articlePath, markdown) => {
    expect(bucket.objects.has(path)).toBe(true);
    store.articles.set(articlePath, markdown);
  });
  const result = await handlePublisher(post(await accessToken(), form()), { ...configuration, IMAGES: bucket }, dependencies(store));
  expect(result.status).toBe(201);
  expect(await result.json()).toEqual({ articlePath: 'posts/2026-10-08.md' });
  expect(create).toHaveBeenCalledTimes(1);
});

it('R2未接続や画像保存の失敗では記事を保存しない', async () => {
  const token = await accessToken();
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  vi.spyOn(bucket, 'put').mockRejectedValue(new Error('保存失敗'));
  for (const environment of [configuration, { ...configuration, IMAGES: bucket }]) {
    expect((await handlePublisher(post(token, form()), environment, dependencies(store))).status).toBe(503);
  }
  expect(store.articles.size).toBe(0);
});

it('再送時は同じR2画像を再利用し同名の別画像は上書きしない', async () => {
  const token = await accessToken();
  for (const content of ['写真', '別の写真']) {
    const bucket = new MemoryBucket();
    bucket.objects.set(path, new TextEncoder().encode(content).buffer);
    const put = vi.spyOn(bucket, 'put');
    const store = new MemoryStore();
    const result = await handlePublisher(post(token, form()), { ...configuration, IMAGES: bucket }, dependencies(store));
    expect(result.status).toBe(content === '写真' ? 201 : 503);
    expect(put).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(bucket.objects.get(path))).toBe(content);
  }
});

it('同時投稿でも同日の記事を上書きせず一方だけ成功する', async () => {
  const token = await accessToken();
  const store = new MemoryStore();
  const deps = dependencies(store);
  const results = await Promise.all([handlePublisher(post(token), configuration, deps), handlePublisher(post(token), configuration, deps)]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(store.articles.size).toBe(1);
});

it('保存先の例外に秘密情報が含まれてもレスポンスに残さない', async () => {
  const deps = dependencies();
  deps.connect.mockRejectedValue(new Error('秘密鍵の値とアクセストークン'));
  const result = await handlePublisher(post(await accessToken()), configuration, deps);
  expect(result.status).toBe(503);
  expect(await result.text()).toBe('{"error":"save_failed"}');
  expect(result.headers.get('cache-control')).toBe('no-store');
});

it('公開Workerは元の署名付き認証情報を渡しCookieや任意ヘッダーを保存Workerへ送らない', async () => {
  const token = await accessToken();
  const request = post(token);
  request.headers.set('cookie', 'session=client-cookie');
  request.headers.set('authorization', 'Bearer untrusted');
  const binding = { fetch: vi.fn(async (forwarded: Request) => {
    expect(forwarded.headers.get('cf-access-jwt-assertion')).toBe(token);
    expect(forwarded.headers.has('cookie')).toBe(false);
    expect(forwarded.headers.has('authorization')).toBe(false);
    return handlePublisher(forwarded, configuration, dependencies());
  }) };
  const result = await gateway.fetch(request, { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(201);
  expect(binding.fetch).toHaveBeenCalledTimes(1);
});

it('公開Workerの申告だけでは保存Workerの認証を迂回できない', async () => {
  const deps = dependencies();
  const binding = { fetch: (request: Request) => handlePublisher(request, configuration, deps) };
  const result = await gateway.fetch(post('forged-token'), { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(403);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('Cloudflareが認証した実行コンテキストがない公開Workerは保存Workerを呼ばない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const result = await gateway.fetch(post(await accessToken()), { ...configuration, PUBLISHER: binding }, {});
  expect(result.status).toBe(403);
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('公開Workerは別サイトやOriginのない投稿と契約外の操作を保存Workerへ渡さない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const token = await accessToken();
  const context = { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } };
  const requests = [
    { request: post(token, form(false), 'https://other.example.com'), status: 403 },
    { request: new Request(`${configuration.EDITOR_ORIGIN}/posts`, { method: 'POST', body: form(false) }), status: 403 },
    { request: new Request(`${configuration.EDITOR_ORIGIN}/posts`, { method: 'DELETE' }), status: 405 },
    { request: new Request(`${configuration.EDITOR_ORIGIN}/secret`), status: 404 },
  ];
  for (const { request, status } of requests) {
    expect((await gateway.fetch(request, { ...configuration, PUBLISHER: binding }, context)).status).toBe(status);
  }
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('ログイン後は固定したエディタだけへ戻りリクエストの転送先を使わない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/auth/login?next=https://other.example`),
    { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(303);
  expect(result.headers.get('location')).toBe(`${configuration.EDITOR_ORIGIN}/`);
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('Accessのユーザー情報が不正または取得不能なら保存Workerを呼ばない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  for (const getIdentity of [async () => ({ email: 'other@example.com' }), async () => ({ email: 123 }), async () => { throw new Error('認証失敗'); }]) {
    const result = await gateway.fetch(post(await accessToken()), { ...configuration, PUBLISHER: binding }, { access: { getIdentity } });
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect(binding.fetch).not.toHaveBeenCalled();
});
