import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';
import { postArticle } from '../src/post';
import type { Article } from '../src/article';
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

it('同じ記事パスが既存なら画像も記事も書き込まない', async () => {
  const store = new MemoryStore();
  store.articles.set('posts/2026-10-08.md', '既存の記事');
  const bucket = new MemoryBucket();
  const result = await handlePublisher(post(await accessToken(), form()), { ...configuration, IMAGES: bucket }, dependencies(store));
  expect(result.status).toBe(409);
  expect(store.articles.get('posts/2026-10-08.md')).toBe('既存の記事');
  expect(bucket.objects.size).toBe(0);
});

it('同じ日付の記事を続けて投稿すると連番パスに保存し本文と写真を保つ', async () => {
  const token = await accessToken();
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const deps = dependencies(store);
  const filename = '550e8400-e29b-41d4-a716-446655440000.jpg';
  const photo = { path: `images/${filename}`, file: new File(['写真'], filename, { type: 'image/jpeg' }) };
  const article: Article = {
    markdown: ['---', 'title: "記事"', 'date: "2026-10-08"', '---', '', '本文'].join('\r\n'),
    path: 'posts/2026-10-08.md',
    images: [photo],
  };
  const localFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('origin', configuration.EDITOR_ORIGIN);
    request.headers.set('cf-access-jwt-assertion', token);
    return handlePublisher(request, { ...configuration, IMAGES: bucket }, deps);
  };

  const paths = [
    await postArticle(article, `${configuration.EDITOR_ORIGIN}/posts`, localFetch),
    await postArticle(article, `${configuration.EDITOR_ORIGIN}/posts`, localFetch),
    await postArticle(article, `${configuration.EDITOR_ORIGIN}/posts`, localFetch),
  ];

  expect(paths).toEqual(['posts/2026-10-08.md', 'posts/2026-10-08-2.md', 'posts/2026-10-08-3.md']);
  expect([...store.articles.keys()]).toEqual(paths);
  expect([...store.articles.values()]).toEqual([article.markdown, article.markdown, article.markdown]);
  expect(bucket.objects.size).toBe(1);
});

it('同時投稿で保存時に競合しても別々の連番パスへ両方を保存する', async () => {
  const token = await accessToken();
  const store = new MemoryStore();
  const deps = dependencies(store);
  let releaseChecks: () => void = () => {};
  const bothChecks = new Promise<void>((resolve) => { releaseChecks = resolve; });
  let initialChecks = 0;
  const exists = vi.spyOn(store, 'exists').mockImplementation(async (articlePath) => {
    if (initialChecks < 2) {
      initialChecks += 1;
      if (initialChecks === 2) releaseChecks();
      await bothChecks;
    }
    return store.articles.has(articlePath);
  });
  const article: Article = {
    markdown: ['---', 'title: "記事A"', 'date: "2026-10-08"', '---', '', '本文A'].join('\r\n'),
    path: 'posts/2026-10-08.md',
    images: [],
  };
  const anotherArticle: Article = {
    ...article,
    markdown: ['---', 'title: "記事B"', 'date: "2026-10-08"', '---', '', '本文B'].join('\r\n'),
  };
  const localFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('origin', configuration.EDITOR_ORIGIN);
    request.headers.set('cf-access-jwt-assertion', token);
    return handlePublisher(request, configuration, deps);
  };

  const paths = await Promise.all([
    postArticle(article, `${configuration.EDITOR_ORIGIN}/posts`, localFetch),
    postArticle(anotherArticle, `${configuration.EDITOR_ORIGIN}/posts`, localFetch),
  ]);

  expect(paths.sort()).toEqual(['posts/2026-10-08-2.md', 'posts/2026-10-08.md']);
  expect(store.articles.size).toBe(2);
  expect([article.markdown, anotherArticle.markdown]).toContain(store.articles.get('posts/2026-10-08.md'));
  expect([article.markdown, anotherArticle.markdown]).toContain(store.articles.get('posts/2026-10-08-2.md'));
  expect(store.articles.get('posts/2026-10-08.md')).not.toBe(store.articles.get('posts/2026-10-08-2.md'));
  expect(exists).toHaveBeenCalled();
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

it('認証後は編集画面を増やさずログイン完了だけを表示し指定された転送先も使わない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?login=1&next=https://other.example`),
    { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(200);
  expect(result.headers.has('location')).toBe(false);
  expect(result.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(result.headers.get('cache-control')).toBe('no-store');
  const html = await result.text();
  expect(html).toContain('<h1>ログイン完了</h1>');
  expect(html).toContain('このタブを閉じて、元の編集画面に戻ってください。');
  expect(html).not.toContain('https://other.example');
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('英語のログイン導線では英語の完了表示だけを返す', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?login=1&lang=en`),
    { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(200);
  const html = await result.text();
  expect(html).toContain('<h1>Signed in</h1>');
  expect(html).toContain('Close this tab and return to the original editor.');
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('認証されていない利用者や許可外のメールにはログイン完了を表示しない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  const contexts = [{}, { access: { getIdentity: async () => ({ email: 'other@example.com' }) } },
    { access: { getIdentity: async () => ({ email: 123 }) } }];
  for (const context of contexts) {
    const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?login=1`),
      { ...configuration, PUBLISHER: binding }, context);
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain('ログイン完了');
  }
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('古いログインURLは認証状態によらず同じサイトの投稿パスへ転送し任意の転送先を引き継がない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  for (const context of [{}, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } }]) {
    for (const language of ['ja', 'en']) {
      const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/auth/login?lang=${language}&next=https://other.example`),
        { ...configuration, PUBLISHER: binding }, context);
      expect(result.status).toBe(303);
      expect(result.headers.get('location')).toBe(`${configuration.EDITOR_ORIGIN}/posts?login=1${language === 'en' ? '&lang=en' : ''}`);
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(await result.text()).toBe('');
    }
  }
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('ログイン用クエリが付いてもPOSTは完了表示で済ませず保存Workerの認証と投稿契約で拒否する', async () => {
  const deps = dependencies();
  const binding = { fetch: vi.fn((request: Request) => handlePublisher(request, configuration, deps)) };
  const request = post(await accessToken());
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?login=1`, request),
    { ...configuration, PUBLISHER: binding }, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(400);
  expect(await result.json()).toEqual({ error: 'invalid_submission' });
  expect(binding.fetch).toHaveBeenCalledTimes(1);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('Accessのユーザー情報が不正または取得不能なら保存Workerを呼ばない', async () => {
  const binding = { fetch: vi.fn(async () => new Response()) };
  for (const getIdentity of [async () => ({ email: 'other@example.com' }), async () => ({ email: 123 }), async () => { throw new Error('認証失敗'); }]) {
    const result = await gateway.fetch(post(await accessToken()), { ...configuration, PUBLISHER: binding }, { access: { getIdentity } });
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect(binding.fetch).not.toHaveBeenCalled();
});

it('下書きと写真も有効な署名・許可メールがなければ取得や保存ができずGitHubに接続しない', async () => {
  const bucket = { get: vi.fn(async () => null), put: vi.fn(async () => ({})) };
  const deps = dependencies();
  const token = await accessToken();
  for (const jwt of ['', 'forged-token', await accessToken({ audience: 'other' }), await accessToken({ email: 'other@example.com' }),
    await accessToken({ expires: Math.floor(Date.now() / 1000) - 1 })]) {
    for (const method of ['GET', 'POST']) {
      const request = new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, { method,
        headers: { origin: configuration.EDITOR_ORIGIN, 'cf-access-jwt-assertion': jwt, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect((await handlePublisher(request, { ...configuration, DRAFTS: bucket }, deps)).status).toBe(403);
    }
  }
  expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled();
  const good = new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, { headers: { 'cf-access-jwt-assertion': token } });
  expect((await handlePublisher(good, { ...configuration, DRAFTS: bucket }, deps)).status).toBe(200);
  expect(deps.connect).not.toHaveBeenCalled();
});

it('下書き同期も別サイトからの保存を拒否し公開画像のバケットを流用しない', async () => {
  const token = await accessToken(); const deps = dependencies(); const images = new MemoryBucket();
  const draft = { version: 1, revision: '550e8400-e29b-41d4-a716-446655440000', title: '未公開', body: '秘密の本文', photos: [] };
  const bucket = { get: vi.fn(async () => null), put: vi.fn(async () => ({})) };
  const request = (origin: string) => new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, { method: 'POST',
    headers: { origin, 'cf-access-jwt-assertion': token, 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: null, draft }) });
  expect((await handlePublisher(request('https://other.example.com'), { ...configuration, DRAFTS: bucket }, deps)).status).toBe(403);
  expect(bucket.put).not.toHaveBeenCalled();
  expect((await handlePublisher(request(configuration.EDITOR_ORIGIN), { ...configuration, IMAGES: images }, deps)).status).toBe(503);
  expect(images.objects.size).toBe(0);
  expect((await handlePublisher(request(configuration.EDITOR_ORIGIN), { ...configuration, IMAGES: images, DRAFTS: bucket }, deps)).status).toBe(200);
  expect(images.objects.size).toBe(0); expect(deps.connect).not.toHaveBeenCalled();
});

it('共通Editorの下書き同期だけに資格情報付きCORSを許可し署名を保持して保存Workerへ渡す', async () => {
  const publisher = { fetch: vi.fn(async (request: Request) => {
    expect(request.headers.get('origin')).toBe(configuration.EDITOR_ORIGIN);
    expect(request.headers.get('cf-access-jwt-assertion')).toBe('signed-token');
    expect(request.headers.get('cookie')).toBeNull();
    return Response.json({ draft: null });
  }) };
  const environment = { ...configuration, COMMON_EDITOR_ORIGIN: 'https://common.example.com', PUBLISHER: publisher };
  const getIdentity = vi.fn(async () => ({ email: 'owner@example.com' }));
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    method: 'POST', headers: { origin: environment.COMMON_EDITOR_ORIGIN, 'content-type': 'text/plain',
      'cf-access-jwt-assertion': 'signed-token', cookie: 'private-cookie' }, body: '{}',
  }), environment, { access: { getIdentity } });
  expect(result.status).toBe(200);
  expect(result.headers.get('access-control-allow-origin')).toBe(environment.COMMON_EDITOR_ORIGIN);
  expect(result.headers.get('access-control-allow-credentials')).toBe('true');
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(publisher.fetch).toHaveBeenCalledTimes(1);
});

it('共通origin設定がなくても既存の同一origin下書きGET・POSTを維持する', async () => {
  const publisher = { fetch: vi.fn(async (request: Request) => {
    expect(request.headers.get('cf-access-jwt-assertion')).toBe('signed-token');
    if (request.method === 'GET') expect(request.headers.get('origin')).toBeNull();
    else expect(request.headers.get('origin')).toBe(configuration.EDITOR_ORIGIN);
    return Response.json({ draft: null });
  }) };
  const environment = { ...configuration, PUBLISHER: publisher };
  const context = { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } };
  const get = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    headers: { 'cf-access-jwt-assertion': 'signed-token' },
  }), environment, context);
  expect(get.status).toBe(200);
  expect(get.headers.has('access-control-allow-origin')).toBe(false);
  const post = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    method: 'POST', headers: { origin: configuration.EDITOR_ORIGIN, 'cf-access-jwt-assertion': 'signed-token', 'content-type': 'text/plain' }, body: '{}',
  }), environment, context);
  expect(post.status).toBe(200);
  expect(post.headers.has('access-control-allow-origin')).toBe(false);
  expect(publisher.fetch).toHaveBeenCalledTimes(2);
});

it('共通Editor向け保存Workerの失敗にも資格情報付きCORSとno-storeを返す', async () => {
  const publisher = { fetch: vi.fn(async () => { throw new Error('upstream failed'); }) };
  const commonOrigin = 'https://common.example.com';
  const result = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    method: 'POST', headers: { origin: commonOrigin, 'cf-access-jwt-assertion': 'signed-token', 'content-type': 'text/plain' }, body: '{}',
  }), { ...configuration, COMMON_EDITOR_ORIGIN: commonOrigin, PUBLISHER: publisher },
  { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(result.status).toBe(503);
  expect(result.headers.get('access-control-allow-origin')).toBe(commonOrigin);
  expect(result.headers.get('access-control-allow-credentials')).toBe('true');
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.headers.get('vary')).toContain('Origin');
});

it('下書き同期は他のOriginと認証のない実リクエストを拒否し通常投稿へCORSを広げない', async () => {
  const publisher = { fetch: vi.fn(async () => new Response()) };
  const environment = { ...configuration, COMMON_EDITOR_ORIGIN: 'https://common.example.com', PUBLISHER: publisher };
  const unauthorized = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    headers: { origin: 'https://attacker.example.com' },
  }), environment, {});
  expect(unauthorized.status).toBe(403);
  expect(unauthorized.headers.has('access-control-allow-origin')).toBe(false);
  expect(unauthorized.headers.get('cache-control')).toBe('no-store');
  expect(unauthorized.headers.get('vary')).toContain('Origin');

  const missingIdentity = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts?draft=1`, {
    headers: { origin: environment.COMMON_EDITOR_ORIGIN },
  }), environment, {});
  expect(missingIdentity.status).toBe(403);
  expect(missingIdentity.headers.get('access-control-allow-origin')).toBe(environment.COMMON_EDITOR_ORIGIN);

  const ordinaryPost = await gateway.fetch(new Request(`${configuration.EDITOR_ORIGIN}/posts`, {
    method: 'POST', headers: { origin: environment.COMMON_EDITOR_ORIGIN }, body: new FormData(),
  }), environment, { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } });
  expect(ordinaryPost.status).toBe(403);
  expect(ordinaryPost.headers.has('access-control-allow-origin')).toBe(false);
  expect(publisher.fetch).not.toHaveBeenCalled();
});
