import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { createRequire } from 'node:module';
import { cloudDraftSchema, syncRequestSchema, syncResponseSchema } from '../src/syncProtocol';
import type { CloudDraft } from '../src/syncProtocol';
import { z } from 'zod';
import { postingOrigin, postingUrl, preparePosting } from './postingHarness';

const require = createRequire(import.meta.url);
const workerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, NoOpLog, convertV4MiniflareOptions } = workerRequire('miniflare');
const { build } = workerRequire('esbuild');
interface Runtime { dispatchFetch(url: string, options?: RequestInit): Promise<Response>; dispose(): Promise<void> }
let runtime: Runtime | undefined;
function localRuntime() { if (!runtime) throw new Error('ローカルWorker未初期化'); return runtime; }
let authenticated = true;
let failSaves = false;
let dropResponse = false;
let syncPosts: CloudDraft[] = [];
let syncGets = 0;
let articleCalls = 0;
const origin = 'https://publish.example.com';
const config = { EDITOR_ORIGIN: origin, COMMON_EDITOR_ORIGIN: origin, ACCESS_ISSUER: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'local', ALLOWED_EMAILS: 'owner@example.com',
  GITHUB_OWNER: 'owner', GITHUB_REPOSITORY: 'blog', GITHUB_BRANCH: 'main' };

async function bundle(contents: string) {
  const result: unknown = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'sync-browser-worker.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:crypto', 'node:buffer'], logLevel: 'silent' });
  const output = z.object({ outputFiles: z.array(z.object({ text: z.string() })).nonempty() }).parse(result).outputFiles[0];
  if (!output) throw new Error('Workerのバンドルがありません');
  return output.text;
}

test.beforeEach(async () => {
  authenticated = true; failSaves = false; dropResponse = false; syncPosts = []; syncGets = 0; articleCalls = 0;
  const gateway = await bundle(`import gateway from './worker/gateway';export default {fetch:(request,environment)=>gateway.fetch(request,environment,{access:{getIdentity:async()=>request.headers.get('cf-access-jwt-assertion')==='local-test-token'?{email:'owner@example.com'}:null}})};`);
  const publisher = await bundle(`import {handlePublisher} from './worker/publisher';export default {fetch:(request,environment)=>handlePublisher(request,environment,{verify:async request=>request.headers.get('cf-access-jwt-assertion')==='local-test-token',connect:async()=>{throw new Error('Draft sync must not publish')}})};`);
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'sync-gateway', modules: true, script: gateway, compatibilityDate: '2026-10-10', bindings: config, serviceBindings: { PUBLISHER: 'sync-publisher' } },
    { name: 'sync-publisher', modules: true, script: publisher, compatibilityDate: '2026-10-10', compatibilityFlags: ['nodejs_compat'], bindings: config, r2Buckets: { DRAFTS: 'private-sync-test-bucket' } },
  ], r2Persist: false, log: new NoOpLog() }));
});
test.afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

async function routeRequest(route: Route) {
  const request = route.request(); const url = new URL(request.url());
  if (url.search !== '?destination=1' && url.search !== '?draft=1') {
    ++articleCalls; return route.fulfill({ status: 503, json: { error: 'publishing_forbidden_in_sync_test' } });
  }
  if (url.search === '?draft=1' && request.method() !== 'OPTIONS') {
    if (request.method() === 'POST') {
      syncPosts.push(syncRequestSchema.parse(request.postDataJSON()).draft);
      if (failSaves) return route.fulfill({ status: 503, json: { error: 'local_failure' } });
    } else ++syncGets;
  }
  const requestHeaders = request.headers();
  const result = await localRuntime().dispatchFetch(`${origin}/posts${url.search}`, { method: request.method(),
    headers: { origin: origin,
      ...(request.method() === 'OPTIONS' ? {
        'access-control-request-method': requestHeaders['access-control-request-method'] ?? 'POST',
        'access-control-request-headers': requestHeaders['access-control-request-headers'] ?? 'content-type',
      } : requestHeaders['content-type'] ? { 'content-type': requestHeaders['content-type'] } : {}),
      ...(authenticated ? { 'cf-access-jwt-assertion': 'local-test-token' } : {}) },
    ...(request.method() === 'POST' ? { body: request.postData() } : {}),
  });
  if (request.method() === 'POST' && dropResponse) { dropResponse = false; return route.abort('failed'); }
  const responseHeaders = Object.fromEntries(result.headers.entries());
  if (requestHeaders.origin) responseHeaders['access-control-allow-origin'] = requestHeaders.origin;
  responseHeaders['access-control-allow-credentials'] = 'true';
  await route.fulfill({ status: result.status, headers: responseHeaders, body: await result.text() });
}
async function configure(page: Page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('投稿用URL').fill(postingUrl);
  await page.getByLabel('画像の公開URL').fill('https://public-images.example.com');
  await page.getByRole('button', { name: '設定を反映' }).click();
}
async function connect(context: BrowserContext) {
  const page = await context.newPage(); await page.goto('/');
  await preparePosting(context, page.url());
  await context.route(`${postingOrigin}/posts?*`, routeRequest);
  await configure(page); return page;
}
async function saveSync(page: Page) {
  await locallySaved(page);
  await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText('本文と写真を同期しました');
}
async function loadSync(page: Page, conflict = true) {
  await locallySaved(page);
  await page.getByRole('button', { name: 'クラウドから取得', exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText(conflict ? '内容を残しています。使う内容を確認' : '本文と写真を同期しました');
}
async function locallySaved(page: Page) { await expect(page.getByTestId('draft-status')).toHaveAttribute('data-state', 'saved'); }
async function addPhoto(page: Page, caption: string) {
  const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 5; return canvas.toDataURL().split(',')[1] ?? ''; });
  await page.getByLabel('写真を選択', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.getByLabel('写真の説明（任意）').fill(caption);
  await page.getByRole('button', { name: '本文に追加' }).click();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('blog-md-draft', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const transaction = db.transaction(['drafts', 'photos'], 'readonly');
    const record = transaction.objectStore('drafts').get('current'); const photos = transaction.objectStore('photos').getAll();
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    const value: unknown = record.result; const files: unknown = photos.result;
    if (typeof value !== 'object' || value === null || !('title' in value) || !('body' in value) || !Array.isArray(files)) throw new Error('保存内容が不正');
    const images = await Promise.all(files.map(async (file: unknown) => {
      if (typeof file !== 'object' || file === null || !('path' in file) || !('file' in file) || !(file.file instanceof File)) throw new Error('写真が不正');
      return { path: file.path, name: file.file.name, bytes: [...new Uint8Array(await file.file.arrayBuffer())] };
    }));
    return { title: value.title, body: value.body, images };
  });
}
async function remote() {
  const result = await localRuntime().dispatchFetch(`${origin}/posts?draft=1`, { headers: { 'cf-access-jwt-assertion': 'local-test-token' } });
  return syncResponseSchema.parse(await result.json()).draft;
}

test('独立した端末間で本人操作の保存と取得によって本文と全写真を双方向に引き継ぐ', async ({ browser, baseURL }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  const pc = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  try {
    const mobile = await connect(phone);
    await mobile.getByLabel('タイトル', { exact: true }).fill('スマホの写真日記'); await mobile.getByLabel('本文', { exact: true }).fill('スマホの本文');
    await addPhoto(mobile, 'スマホの写真'); await locallySaved(mobile);
    expect(syncGets).toBe(0); expect(syncPosts).toHaveLength(0);
    const mobilePageCount = phone.pages().length;
    await saveSync(mobile);
    expect(phone.pages()).toHaveLength(mobilePageCount);
    await mobile.screenshot({ path: 'test-results/direct-sync-390-ja.png', fullPage: true });
    const desktop = await connect(pc); await loadSync(desktop, false);
    await expect(desktop.getByLabel('タイトル', { exact: true })).toHaveValue('スマホの写真日記');
    await expect(desktop.getByRole('button', { name: '別の端末の内容を使う', exact: true })).toHaveCount(0);
    expect(await stored(desktop)).toEqual(await stored(mobile));
    await desktop.getByLabel('本文', { exact: true }).press('End'); await desktop.getByLabel('本文', { exact: true }).pressSequentially('\nPCで追記');
    await addPhoto(desktop, 'PCの写真'); await saveSync(desktop);
    const before = await stored(mobile); await loadSync(mobile); expect(await stored(mobile)).toEqual(before);
    await mobile.getByRole('button', { name: '別の端末の内容を使う', exact: true }).click(); await locallySaved(mobile);
    expect(await stored(mobile)).toEqual(await stored(desktop));
    const counts = { get: syncGets, post: syncPosts.length };
    await mobile.reload(); await locallySaved(mobile); expect(await stored(mobile)).toEqual(await stored(desktop));
    expect({ get: syncGets, post: syncPosts.length }).toEqual(counts);
    expect((await remote())?.photos).toHaveLength(2); expect(articleCalls).toBe(0);
  } finally { await phone.close(); await pc.close(); }
});

test('オフラインの再起動と写真を保持し復帰や保存失敗で自動送信せず本人が再試行する', async ({ context }) => {
  const page = await connect(context);
  await expect(page.getByText('下書きはオフラインでも開けます。', { exact: true })).toBeVisible();
  await context.setOffline(true); await page.getByLabel('タイトル', { exact: true }).fill('オフラインの下書き'); await addPhoto(page, '未送信写真'); await locallySaved(page);
  const before = await stored(page); await page.reload(); await locallySaved(page); expect(await stored(page)).toEqual(before);
  await context.setOffline(false); failSaves = true;
  expect(syncPosts).toHaveLength(0);
  await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同期できませんでした');
  expect(await remote()).toBeNull(); expect(await stored(page)).toEqual(before);
  failSaves = false; await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText('本文と写真を同期しました');
  expect((await remote())?.photos).toHaveLength(1); expect(articleCalls).toBe(0);
});

test('同時編集を上書きせず両方の本文と写真を保持し使う内容を選択できる', async ({ browser, baseURL }) => {
  const one = await browser.newContext({ baseURL }); const two = await browser.newContext({ baseURL });
  try {
    const local = await connect(one); await local.getByLabel('タイトル', { exact: true }).fill('共通の下書き'); await saveSync(local);
    const other = await connect(two); await loadSync(other, false); await locallySaved(other);
    await local.getByLabel('本文', { exact: true }).fill('この端末の本文'); await addPhoto(local, '端末の写真'); await locallySaved(local);
    await other.getByLabel('本文', { exact: true }).fill('他端末の本文'); await addPhoto(other, '他端末の写真'); await saveSync(other);
    const cloudBefore = await remote(); const localBefore = await stored(local);
    await local.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
    await expect(local.getByTestId('sync-status')).toContainText('内容を残しています。使う内容を確認');
    expect(await stored(local)).toEqual(localBefore); expect(await remote()).toEqual(cloudBefore);
    await local.reload(); await locallySaved(local);
    await expect(local.getByRole('button', { name: '別の端末の内容を使う', exact: true })).toBeVisible();
    for (const width of [320, 390, 1440]) {
      await local.setViewportSize({ width, height: 844 });
      for (const language of ['ja', 'en']) {
        if (language === 'en') await local.getByRole('button', { name: 'English', exact: true }).click();
        const panel = local.locator('.sync-panel');
        const choices = panel.locator('.conflict-actions button');
        await expect(choices).toHaveCount(2);
        for (const choice of await choices.all()) {
          await choice.scrollIntoViewIfNeeded();
          await expect(choice).toBeInViewport();
          await expect(choice).toBeEnabled();
        }
        expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
        expect(await local.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await local.screenshot({ path: `test-results/conflict-${width}-${language}.png`, fullPage: true });
        if (language === 'en') await local.getByRole('button', { name: '日本語', exact: true }).click();
      }
    }
    await expect(local.getByRole('button', { name: '双方の本文・写真を保存' })).toHaveCount(0);
    await local.getByRole('button', { name: '別の端末の内容を使う', exact: true }).click(); await locallySaved(local);
    expect(await stored(local)).toEqual(await stored(other));
    await expect(local.getByRole('button', { name: '双方の本文・写真を保存' })).toHaveCount(0); expect(articleCalls).toBe(0);
  } finally { await one.close(); await two.close(); }
});

test('未認証では同期データを受け取らず本文と写真を端末内に保持する', async ({ context }) => {
  const page = await connect(context); authenticated = false;
  await page.getByLabel('本文', { exact: true }).fill('端末だけの本文'); await addPhoto(page, '端末だけの写真'); await locallySaved(page);
  const before = await stored(page);
  const pageCount = context.pages().length;
  await page.getByRole('button', { name: 'クラウドから取得', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('設定の「Cloudflareで認証」からログイン');
  expect(context.pages()).toHaveLength(pageCount);
  expect(await stored(page)).toEqual(before); expect(syncGets).toBe(1); expect(syncPosts).toHaveLength(0);
  for (const method of ['GET', 'POST']) {
    const response = await localRuntime().dispatchFetch(`${origin}/posts?draft=1`, { method,
      ...(method === 'POST' ? { headers: { origin, 'content-type': 'application/json' }, body: '{}' } : {}),
    });
    expect(response.status).toBe(403);
  }
  expect(articleCalls).toBe(0);
});

test('保存応答を失っても下書きを保持し手動の同じ更新の再送で復旧する', async ({ context }) => {
  const page = await connect(context); await page.getByLabel('タイトル', { exact: true }).fill('応答を失う下書き'); await addPhoto(page, '保持する写真');
  const before = await stored(page); dropResponse = true;
  await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同期できませんでした');
  expect(await stored(page)).toEqual(before); const first = await remote(); expect(first?.photos).toHaveLength(1);
  await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText('本文と写真を同期しました');
  expect(await remote()).toEqual(first); expect(syncPosts[0]?.revision).toBe(syncPosts[1]?.revision); expect(articleCalls).toBe(0);
});

test('取得した写真が同じパスでも選択した版の実体を保存し元の版を保持する', async ({ context }) => {
  const page = await connect(context); await addPhoto(page, '同じ参照の写真'); await saveSync(page);
  const original = await remote(); if (!original) throw new Error('共有下書きなし');
  const updated = cloudDraftSchema.parse({ ...original, revision: crypto.randomUUID(), photos: original.photos.map(photo => ({ ...photo,
    data: Buffer.concat([Buffer.from(photo.data, 'base64'), Buffer.from('new-version')]).toString('base64'),
  })) });
  const result = await localRuntime().dispatchFetch(`${origin}/posts?draft=1`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-access-jwt-assertion': 'local-test-token' }, body: JSON.stringify({ baseRevision: original.revision, draft: updated }) });
  expect(result.status).toBe(200);
  const before = await stored(page); await loadSync(page); expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: '別の端末の内容を使う', exact: true }).click(); await locallySaved(page);
  const local = await stored(page); expect(local.body).toBe(updated.body);
  expect(local.images[0]?.bytes).toEqual([...Buffer.from(updated.photos[0]?.data ?? '', 'base64')]);
  await page.reload(); await locallySaved(page); expect(await stored(page)).toEqual(local);
  await expect(page.getByRole('button', { name: '双方の本文・写真を保存' })).toHaveCount(0);
});
