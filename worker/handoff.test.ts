import { expect, it, vi } from 'vitest';
import gateway from './gateway';
import type { GatewayEnvironment } from './gateway';
import { handlePublisher } from './publisher';
import type { ArticleStore } from './publisher';

const configuration = {
  EDITOR_ORIGIN: 'https://publish.example.com', COMMON_EDITOR_ORIGIN: 'https://editor.example.com',
  ACCESS_ISSUER: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'audience', ALLOWED_EMAILS: 'owner@example.com',
  GITHUB_OWNER: 'owner', GITHUB_REPOSITORY: 'articles', GITHUB_BRANCH: 'main',
  PUBLISHER: { fetch: async () => new Response(null, { status: 500 }) },
} satisfies GatewayEnvironment & { GITHUB_OWNER: string; GITHUB_REPOSITORY: string; GITHUB_BRANCH: string };
const context = { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } };
const page = '<html><script>const editor="__BLOG_EDITOR_ORIGIN__";</script></html>';

it('認証前や許可外メールには投稿画面・写真assetを返さない', async () => {
  const ui = { fetch: vi.fn(async () => new Response(page)) };
  const requests = [
    { url: 'https://gateway.example.com/publish', context: {} },
    { url: 'https://gateway.example.com/publish', context: { access: { getIdentity: async () => ({ email: 'other@example.com' }) } } },
    { url: 'https://gateway.example.com/assets/publish.js', context: {} },
  ];
  for (const item of requests) {
    const result = await gateway.fetch(new Request(item.url), { ...configuration, POSTING_UI: ui }, item.context);
    expect(result.status).toBe(403);
  }
  expect(ui.fetch).not.toHaveBeenCalled();
});

it('認証後だけ投稿画面とassetを取得し画面へ共通編集originを注入する', async () => {
  const ui = { fetch: vi.fn(async (request: Request) => {
    expect(new URL(request.url).origin).toBe(configuration.EDITOR_ORIGIN);
    return new Response(new URL(request.url).pathname === '/publish.html' ? page : 'asset', {
      headers: { 'content-type': 'text/html', etag: 'private-etag', 'content-length': '9' },
    });
  }) };
  const publish = await gateway.fetch(new Request('https://gateway.example.com/publish'), { ...configuration, POSTING_UI: ui }, context);
  expect(publish.status).toBe(200);
  expect(await publish.text()).toContain('https://editor.example.com');
  expect(publish.headers.get('cache-control')).toBe('no-store');
  expect(publish.headers.has('etag')).toBe(false);
  expect(publish.headers.has('content-length')).toBe(false);
  const asset = await gateway.fetch(new Request('https://gateway.example.com/assets/publish.js'), { ...configuration, POSTING_UI: ui }, context);
  expect(await asset.text()).toBe('asset');
  expect(ui.fetch).toHaveBeenCalledTimes(2);
});

it('投稿画面のHTML内に認証Cookieやtokenを渡さない', async () => {
  const ui = { fetch: vi.fn(async () => new Response(page)) };
  const request = new Request('https://gateway.example.com/publish', { headers: {
    cookie: 'cf-access=secret-cookie', authorization: 'Bearer private-token', 'cf-access-jwt-assertion': 'signed-token',
  } });
  const result = await gateway.fetch(request, { ...configuration, POSTING_UI: ui }, context);
  const html = await result.text();
  expect(html).not.toContain('secret-cookie');
  expect(html).not.toContain('private-token');
  expect(html).not.toContain('signed-token');
});

it('Publisherは未認証destination要求を拒否し接続先を作らない', async () => {
  const connect = vi.fn(async (): Promise<ArticleStore> => ({ exists: async () => false, createArticle: async () => {} }));
  const request = new Request('https://publisher.example.com/posts?destination=1');
  const result = await handlePublisher(request, configuration, { verify: async () => false, connect });
  expect(result.status).toBe(403);
  expect(connect).not.toHaveBeenCalled();
});

it('Publisherは認証後にowner・repository・branchだけを返しGitHub接続を作らない', async () => {
  const connect = vi.fn(async (): Promise<ArticleStore> => { throw new Error('接続してはいけない'); });
  const request = new Request('https://publisher.example.com/posts?destination=1');
  const result = await handlePublisher(request, configuration, { verify: async () => true, connect });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ owner: 'owner', repository: 'articles', branch: 'main' });
  expect(connect).not.toHaveBeenCalled();
});

it('投稿画面以外のoriginからの投稿は共通Editorも含め保存先接続前に拒否する', async () => {
  const connect = vi.fn(async (): Promise<ArticleStore> => ({ exists: async () => false, createArticle: async () => {} }));
  for (const origin of [configuration.COMMON_EDITOR_ORIGIN, 'https://other.example.com']) {
    const request = new Request('https://publisher.example.com/posts', { method: 'POST',
      headers: { origin }, body: new FormData() });
    const result = await handlePublisher(request, configuration, { verify: async () => true, connect });
    expect(result.status).toBe(403);
  }
  expect(connect).not.toHaveBeenCalled();
});
