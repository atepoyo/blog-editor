import { createPrivateKey } from 'node:crypto';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ArticleConflictError, GitHubStore, StorageError } from './github';

const pair = await generateKeyPair('RS256', { extractable: true });
const pem = createPrivateKey(await exportPKCS8(pair.privateKey)).export({ type: 'pkcs1', format: 'pem' }).toString();
const environment = { GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: pem, GITHUB_OWNER: 'owner', GITHUB_REPOSITORY: 'blog', GITHUB_BRANCH: 'main' };
const tokenData = {
  token: 'installation-token', expires_at: new Date(Date.now() + 3600000).toISOString(),
  repositories: [{ name: 'blog', owner: { login: 'owner', type: 'User' } }],
  permissions: { contents: 'write', metadata: 'read' },
};

function githubRequest() {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: 1, account: { login: 'owner', type: 'User' } }))
    .mockResolvedValueOnce(Response.json(tokenData, { status: 201 }));
}

it('GitHub Appの鍵で短命JWTを署名し個人の一つのリポジトリだけのトークンを要求する', async () => {
  const request = githubRequest();
  await GitHubStore.connect(environment, request);
  const appHeaders = new Headers(request.mock.calls[0]?.[1]?.headers);
  const authorization = appHeaders.get('authorization');
  if (!authorization) throw new Error('JWTがありません。');
  const { payload } = await jwtVerify(authorization.slice(7), pair.publicKey, { issuer: environment.GITHUB_APP_ID, algorithms: ['RS256'] });
  expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(payload.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300);
  expect(request.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ repositories: ['blog'], permissions: { contents: 'write', metadata: 'read' } }));
  expect(request.mock.calls.every((call) => call[1]?.redirect === 'error')).toBe(true);
});

it('組織のインストールや別アカウントへの接続ではトークンを要求しない', async () => {
  for (const account of [{ login: 'owner', type: 'Organization' }, { login: 'other', type: 'User' }]) {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 1, account }));
    await expect(GitHubStore.connect(environment, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  }
});

it('別リポジトリや複数リポジトリのトークンを保存に使用しない', async () => {
  for (const repositories of [
    [{ name: 'other', owner: { login: 'owner', type: 'User' } }],
    [...tokenData.repositories, { name: 'other', owner: { login: 'owner', type: 'User' } }],
  ]) {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 1, account: { login: 'owner', type: 'User' } }))
      .mockResolvedValueOnce(Response.json({ ...tokenData, repositories }, { status: 201 }));
    await expect(GitHubStore.connect(environment, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  }
});

it('記事保存ではSHAを渡さず指定されたブランチに新規作成だけを要求する', async () => {
  const request = githubRequest().mockResolvedValueOnce(new Response(null, { status: 201 }));
  const store = await GitHubStore.connect(environment, request);
  await store.createArticle('posts/2026-10-08.md', '本文');
  const body = request.mock.calls[2]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('送信内容がありません。');
  const parsed = z.strictObject({ message: z.string(), content: z.string(), branch: z.literal('main') }).parse(JSON.parse(body));
  expect(parsed.message).toContain('ため');
  expect(String(request.mock.calls[2]?.[0])).toBe('https://api.github.com/repos/owner/blog/contents/posts/2026-10-08.md');
  expect(new Headers(request.mock.calls[2]?.[1]?.headers).get('authorization')).toBe('Bearer installation-token');
});

it('要求を超える権限を含むトークンは保存に使用しない', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: 1, account: { login: 'owner', type: 'User' } }))
    .mockResolvedValueOnce(Response.json({ ...tokenData, permissions: { ...tokenData.permissions, workflows: 'write' } }, { status: 201 }));
  await expect(GitHubStore.connect(environment, request)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});

it('存在確認後の409と422も既存記事があれば競合として扱い更新を試みない', async () => {
  for (const status of [409, 422]) {
    const request = githubRequest().mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const store = await GitHubStore.connect(environment, request);
    await expect(store.createArticle('posts/2026-10-08.md', '本文')).rejects.toThrow(ArticleConflictError);
    expect(request.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(1);
  }
});

it('既存記事のない422や想定外の成功応答を保存成功にしない', async () => {
  for (const status of [200, 422]) {
    const request = githubRequest().mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const store = await GitHubStore.connect(environment, request);
    await expect(store.createArticle('posts/2026-10-08.md', '本文')).rejects.toThrow(StorageError);
  }
});

it('存在確認は接続失敗や認証拒否を存在しない記事として扱わない', async () => {
  const request = githubRequest().mockResolvedValueOnce(new Response(null, { status: 403 }));
  const store = await GitHubStore.connect(environment, request);
  await expect(store.exists('posts/2026-10-08.md')).rejects.toThrow(StorageError);
});
