import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { z } from 'zod';

async function saved(page: Page) {
  await expect(page.getByText('下書きはこのブラウザに保存済みです。', { exact: true })).toBeVisible();
}

async function addPhoto(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1200;
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await page.getByLabel('写真を選択', { exact: true }).setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.getByLabel('写真の説明（任意）').fill('保存する写真');
  await page.getByRole('button', { name: '本文に追加' }).click();
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blog-md-draft', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['drafts', 'photos'], 'readonly');
    const record = transaction.objectStore('drafts').get('current');
    const photos = transaction.objectStore('photos').getAll();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    const draft: unknown = record.result;
    const values: unknown = photos.result;
    if (!Array.isArray(values)) throw new Error('保存画像の配列がありません。');
    const images = await Promise.all(values.map(async (value: unknown) => {
      if (typeof value !== 'object' || value === null || !('path' in value) || !('file' in value) || !(value.file instanceof File)) throw new Error('保存画像が不正です。');
      const image = await createImageBitmap(value.file);
      const dimensions = { width: image.width, height: image.height };
      image.close();
      return { path: value.path, name: value.file.name, type: value.file.type, bytes: [...new Uint8Array(await value.file.arrayBuffer())], ...dimensions };
    }));
    return { draft, images };
  });
}

test('通信を切ってタブを開き直しても記事・縮小写真・設定を復元し明示操作でだけ投稿する', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
  await page.getByLabel('タイトル', { exact: true }).fill('オフラインの記事');
  await page.getByLabel('本文', { exact: true }).fill('書きかけの本文');
  await addPhoto(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('画像の公開URL').fill('https://img.example.com/');
  const workerUrl = new URL('/worker', page.url()).href;
  await page.getByLabel('Worker URL').fill(workerUrl);
  await page.getByRole('button', { name: '設定を反映' }).click();
  await saved(page);
  const before = await stored(page);
  expect(before.images).toHaveLength(1);
  expect(before.images[0]).toMatchObject({ type: 'image/jpeg', width: 1920, height: 960 });
  expect(before.images[0]?.name).toMatch(/^[\da-f-]+\.jpg$/);
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const url = page.url();
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel('タイトル', { exact: true })).toHaveValue('オフラインの記事');
  await expect(reopened.getByLabel('本文', { exact: true })).toHaveValue(body);
  await expect(reopened.getByText('1枚を準備済み', { exact: true })).toBeVisible();
  expect(await stored(reopened)).toEqual(before);
  await reopened.getByRole('button', { name: '設定', exact: true }).click();
  await expect(reopened.getByLabel('Worker URL')).toHaveValue(workerUrl);
  await expect(reopened.getByLabel('画像の公開URL')).toHaveValue('https://img.example.com/');
  await reopened.getByRole('button', { name: '閉じる', exact: true }).click();
  await reopened.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(reopened.getByRole('alert')).toContainText('オフラインでは投稿できません');
  await reopened.getByLabel('本文', { exact: true }).fill(`${body}\nオフラインで追記`);
  await addPhoto(reopened);
  await saved(reopened);
  const offlineDraft = await stored(reopened);
  await reopened.reload();
  await saved(reopened);
  expect(await stored(reopened)).toEqual(offlineDraft);
  await expect(reopened.getByLabel('本文', { exact: true })).toHaveValue(/オフラインで追記/);
  const methods: string[] = [];
  await context.route('**/worker**', async (route) => {
    methods.push(route.request().method());
    if (route.request().method() === 'GET') return route.fulfill({ json: { exists: false } });
    const contentType = await route.request().headerValue('content-type');
    const bytes = route.request().postDataBuffer();
    if (!contentType || !bytes) throw new Error('投稿データがありません。');
    const form = await new Request(workerUrl, { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) }).formData();
    const markdown = z.string().parse(form.get('markdown'));
    expect(markdown).toContain('title: "オフラインの記事"');
    expect(markdown).toContain('オフラインで追記');
    const uploads = [...form.values()].filter((value) => value instanceof File);
    expect(uploads).toHaveLength(offlineDraft.images.length);
    for (const photo of offlineDraft.images) {
      const file = uploads.find((value) => value.name === photo.name);
      if (!(file instanceof File)) throw new Error('復元した写真が送信されていません。');
      expect(file.name).toBe(photo.name);
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual(photo.bytes);
      expect(markdown).toContain(`https://img.example.com/${photo.path}`);
    }
    const manifest = z.object({ articlePath: z.string() }).parse(JSON.parse(String(form.get('manifest'))));
    await route.fulfill({ status: 201, json: { articlePath: manifest.articlePath } });
  });
  await context.setOffline(false);
  await expect.poll(() => reopened.evaluate(() => navigator.onLine)).toBe(true);
  await reopened.waitForTimeout(300);
  expect(methods).toEqual([]);
  await reopened.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(reopened.getByRole('status')).toContainText('投稿しました');
  expect(methods).toEqual(['GET', 'POST']);
  const cachePaths = await reopened.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    return paths;
  });
  expect(cachePaths).toContain('/index.html');
  expect(cachePaths.some((path) => path.endsWith('.css'))).toBe(true);
  expect(cachePaths.some((path) => path.endsWith('.js'))).toBe(true);
  expect(cachePaths.every((path) => path === '/index.html' || path.startsWith('/assets/'))).toBe(true);
  await reopened.screenshot({ path: 'test-results/offline-restored.png', fullPage: true });
});

test('連続入力の最新内容を保存し既存JPEGは入力のたびに書き直さない', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      document.documentElement.dataset.databaseOpens = String(Number(document.documentElement.dataset.databaseOpens ?? 0) + 1);
      return open.call(this, name, version);
    };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      if (this.name === 'photos') document.documentElement.dataset.photoReads = String(Number(document.documentElement.dataset.photoReads ?? 0) + 1);
      return get.call(this, query);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (query, count) {
      if (this.name === 'photos') document.documentElement.dataset.photoReads = String(Number(document.documentElement.dataset.photoReads ?? 0) + 1);
      return getAll.call(this, query, count);
    };
    const keys = IDBObjectStore.prototype.getAllKeys;
    IDBObjectStore.prototype.getAllKeys = function (query, count) {
      if (this.name === 'photos') document.documentElement.dataset.photoReads = String(Number(document.documentElement.dataset.photoReads ?? 0) + 1);
      return keys.call(this, query, count);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'photos') document.documentElement.dataset.photoWrites = String(Number(document.documentElement.dataset.photoWrites ?? 0) + 1);
      return put.call(this, value, key);
    };
  });
  await page.goto('/');
  await addPhoto(page);
  await saved(page);
  expect(await page.locator('html').getAttribute('data-photo-writes')).toBe('1');
  const photo = (await stored(page)).images;
  await page.evaluate(() => { document.documentElement.dataset.databaseOpens = '0'; document.documentElement.dataset.photoReads = '0'; });
  const title = page.getByLabel('タイトル', { exact: true });
  const input = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWX';
  await title.pressSequentially(input, { delay: 50 });
  await page.getByLabel('本文', { exact: true }).pressSequentially('最後の文章');
  await saved(page);
  expect(await page.locator('html').getAttribute('data-photo-writes')).toBe('1');
  expect(await page.locator('html').getAttribute('data-database-opens')).toBe('0');
  expect(await page.locator('html').getAttribute('data-photo-reads')).toBe('0');
  await page.reload();
  await expect(title).toHaveValue(input);
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(/最後の文章/);
  expect((await stored(page)).images).toEqual(photo);
});

for (const oldStorage of ['r2', 'github']) {
  test(`旧${oldStorage}設定の下書きと写真を復元し画像URLを安全に引き継ぐ`, async ({ page }) => {
    await page.goto('/');
    await addPhoto(page);
    await saved(page);
    const before = await stored(page);
    const imagePath = before.images[0]?.path;
    if (typeof imagePath !== 'string') throw new Error('保存した写真のパスがありません。');
    const record = {
      version: 1, title: '旧設定の記事', body: `![](<${imagePath}>)`, photoPaths: [imagePath],
      settings: { imageStorage: oldStorage, publicImageUrl: 'https://old-images.example.com/', workerUrl: new URL('/posts', page.url()).href },
    };
    await page.evaluate(async (record) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('blog-md-draft', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(record, 'current');
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    }, record);
    await page.reload();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(record.title);
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue(record.body);
    expect((await stored(page)).images).toEqual(before.images);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.getByLabel('画像の公開URL')).toHaveValue(oldStorage === 'r2' ? record.settings.publicImageUrl : '');
    await expect(page.getByLabel('Worker URL')).toHaveValue(record.settings.workerUrl);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByLabel('タイトル', { exact: true }).fill('新設定で保存');
    await saved(page);
    z.object({ settings: z.strictObject({ publicImageUrl: z.string(), workerUrl: z.string() }) }).parse((await stored(page)).draft);
    await page.reload();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('新設定で保存');
    await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
  });
}

test('読み込みが遅れた別タブは未編集の復元結果で新しい記事と写真を上書きしない', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('古いタイトル');
  await addPhoto(page);
  await saved(page);
  const old = await stored(page);
  const other = await context.newPage();
  await other.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    let held = false;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const current = transaction.call(this, stores, mode, options);
      if (mode === 'readwrite') document.documentElement.dataset.restoreWrites = String(Number(document.documentElement.dataset.restoreWrites ?? 0) + 1);
      if (!held && current.mode === 'readonly' && current.objectStoreNames.contains('photos')) {
        held = true;
        Object.defineProperty(current, 'oncomplete', {
          set(handler: IDBTransaction['oncomplete']) {
            current.addEventListener('complete', (event) => {
              document.documentElement.dataset.restoreHeld = 'true';
              window.addEventListener('resume-draft-read', () => handler?.call(current, event), { once: true });
            });
          },
        });
      }
      return current;
    };
  });
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-restore-held', 'true');
  await page.getByLabel('タイトル', { exact: true }).fill('新しいタイトル');
  await addPhoto(page);
  await saved(page);
  const current = await stored(page);
  expect(current.images).toHaveLength(2);
  await other.evaluate(() => window.dispatchEvent(new Event('resume-draft-read')));
  await expect(other.getByLabel('タイトル', { exact: true })).toHaveValue('古いタイトル');
  await saved(other);
  await other.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await other.locator('html').getAttribute('data-restore-writes')).toBeNull();
  expect(await stored(page)).toEqual(current);
  // 編集を始めたタブが最後の保存者になっても、残す写真を欠落させない。
  await other.getByLabel('タイトル', { exact: true }).fill('別タブで明示的に編集');
  await saved(other);
  expect((await stored(other)).images).toEqual(old.images);
  await page.reload();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('別タブで明示的に編集');
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
});

test('再利用中のDB接続はバージョン変更を妨げず保存エラー後も入力を保つ', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('接続の更新前');
  await saved(page);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blog-md-draft', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('画面のDB接続が更新を妨げています。'));
    });
    database.close();
  });
  await page.getByLabel('タイトル', { exact: true }).fill('画面には残す');
  await expect(page.getByText(/下書きを保存できませんでした/)).toBeVisible();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('画面には残す');
});

test('消失した画面キャッシュはオンラインで復旧した後にオフライン準備完了を表示する', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
  await page.getByLabel('タイトル', { exact: true }).fill('キャッシュ復旧');
  await saved(page);
  const before = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) paths.push(request.url);
    return paths.sort();
  });
  await page.evaluate(async () => { for (const name of await caches.keys()) await caches.delete(name); });
  await page.reload();
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
  const restored = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) paths.push(request.url);
    return paths.sort();
  });
  expect(restored).toEqual(before);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('キャッシュ復旧');
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
});

test('オフラインで不足するキャッシュを復旧できないときは準備完了にしない', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) if (new URL(request.url).pathname.endsWith('.css')) await cache.delete(request);
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/オフライン用の画面を準備できませんでした/)).toBeVisible();
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toHaveCount(0);
  await page.getByLabel('タイトル', { exact: true }).fill('オフラインで編集は続ける');
  await saved(page);
});

for (const broken of ['schema', 'photo']) {
  test(`${broken === 'schema' ? '形式不正' : '写真欠落'}の下書きを空の初期値で上書きしない`, async ({ page }) => {
    await page.goto('/');
    await saved(page);
    const record = { version: broken === 'schema' ? 999 : 1, title: '壊れた下書き', body: '保護対象', photoPaths: broken === 'photo' ? ['images/missing.jpg'] : [], settings: { publicImageUrl: '', workerUrl: '' } };
    await page.evaluate(async (record) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('blog-md-draft', 1);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(record, 'current');
      await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
      database.close();
    }, record);
    await page.reload();
    await expect(page.getByText(/下書きを読み込めませんでした/)).toBeVisible();
    await page.getByLabel('タイトル', { exact: true }).fill('画面だけの編集');
    expect((await stored(page)).draft).toEqual(record);
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByText(/Could not load the draft/)).toBeVisible();
  });
}

test('写真保存の失敗では下書き全体を巻き戻し画面の内容を保って次の編集で再保存する', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === 'photos' && document.documentElement.dataset.failSave === 'true') this.transaction.abort();
      return request;
    };
  });
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('保存済み');
  await saved(page);
  const before = await stored(page);
  await page.evaluate(() => { document.documentElement.dataset.failSave = 'true'; });
  await addPhoto(page);
  await expect(page.getByText(/下書きを保存できませんでした/)).toBeVisible();
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(/images\//);
  expect(await stored(page)).toEqual(before);
  await page.evaluate(() => { document.documentElement.dataset.failSave = 'false'; });
  await page.getByLabel('タイトル', { exact: true }).fill('保存を再試行');
  await saved(page);
  await page.reload();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('保存を再試行');
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
});

test('端末の保存機能が使えなくても警告を表示して書く操作を続けられる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.getByText(/下書きを読み込めませんでした/)).toBeVisible();
  await page.getByLabel('タイトル', { exact: true }).fill('保存不可でも編集');
  await page.getByLabel('本文', { exact: true }).fill('保存できなくても本文は残る');
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未接続');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('保存できなくても本文は残る');
});

test('Service Workerのインストール失敗をオフライン準備完了と表示しない', async ({ page, context }) => {
  await context.route('**/sw.js', (route) => route.fulfill({ contentType: 'application/javascript', body: "self.addEventListener('install', event => event.waitUntil(Promise.reject(new Error('failed'))));" }));
  await page.goto('/');
  await expect(page.getByText(/オフライン用の画面を準備できませんでした/)).toBeVisible();
  await expect(page.getByText('オフラインでも開けます。', { exact: true })).toHaveCount(0);
  await page.getByLabel('タイトル', { exact: true }).fill('オンラインでは使える');
  await saved(page);
});

test('新版は編集中の画面を更新せずタブを閉じた後に切り替えて旧キャッシュを削除する', async ({ page, context }) => {
  const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../dist/index.html', import.meta.url));
  const files = new Map<string, { body: Buffer; type: string }>([
    ['/', { body: index, type: 'text/html' }], ['/index.html', { body: index, type: 'text/html' }],
  ]);
  for (const name of await readdir(new URL('../dist/assets/', import.meta.url))) {
    files.set(`/assets/${name}`, { body: await readFile(new URL(`../dist/assets/${name}`, import.meta.url)), type: name.endsWith('.js') ? 'application/javascript' : 'text/css' });
  }
  let workerSource = source;
  // Worker更新のブラウザ内部リクエストはルートモックされないため、実際のHTTP応答を切り替える。
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    if (path === '/sw.js') { response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); response.end(workerSource); return; }
    const file = files.get(path);
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': file.type });
    response.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('テスト用HTTPサーバーを開けません。');
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByText('オフラインでも開けます。', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await page.getByLabel('タイトル', { exact: true }).fill('更新中も保持');
    await page.getByLabel('本文', { exact: true }).fill('編集中の本文');
    await saved(page);
    await page.evaluate(() => { document.documentElement.dataset.updateCheck = 'keep'; });
    const previousCaches = await page.evaluate(() => caches.keys());
    const updated = source.replace(/const CACHE = "[^"]+";/, 'const CACHE = "blog-md-shell-test-update";');
    expect(updated).not.toBe(source);
    workerSource = updated;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('Workerが登録されていません。');
      await registration.update();
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('更新中も保持');
    await expect(page.getByLabel('本文', { exact: true })).toHaveValue('編集中の本文');
    expect(await page.locator('html').getAttribute('data-update-check')).toBe('keep');
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(previousCaches));
    const url = page.url();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(url);
    await expect.poll(() => reopened.evaluate(() => caches.keys())).toEqual(['blog-md-shell-test-update']);
    await expect(reopened.getByLabel('タイトル', { exact: true })).toHaveValue('更新中も保持');
    await expect(reopened.getByLabel('本文', { exact: true })).toHaveValue('編集中の本文');
    await reopened.close();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
