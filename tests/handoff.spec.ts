import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { z } from 'zod';
import { postingOrigin, postingUrl, preparePosting } from './postingHarness';
import { parseSubmission } from '../worker/submission';

async function configure(page: Page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('投稿用URL').fill(postingUrl);
  await page.getByLabel('画像の公開URL').fill('https://images.example.com');
  await page.getByRole('button', { name: '設定を反映' }).click();
}
async function addPhoto(page: Page) {
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200;
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await page.getByLabel('写真を選択', { exact: true }).setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await page.getByRole('button', { name: '本文に追加' }).click();
}
async function popup(page: Page) {
  const [target] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '投稿', exact: true }).click()]);
  return target;
}
async function setup(context: BrowserContext, page: Page) {
  await page.goto('/'); await preparePosting(context, page.url()); await configure(page);
  await page.getByLabel('タイトル', { exact: true }).fill('別originの記事');
  await page.getByLabel('本文', { exact: true }).fill('本文はURLとサーバーに載せない');
  await addPhoto(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-state', 'saved');
}
async function multipart(route: Route) {
  const bytes = route.request().postDataBuffer(); const contentType = await route.request().headerValue('content-type');
  if (!bytes || !contentType) throw new Error('投稿データなし');
  const form = await new Request(route.request().url(), { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) }).formData();
  return parseSubmission(form);
}

test('異なるoriginに本文と写真を直接渡し本人の最終確認前は保存しない', async ({ page, context }) => {
  const sent: string[] = []; const messages: unknown[] = [];
  await page.exposeFunction('recordMessage', (data: unknown) => messages.push(data));
  await page.addInitScript(() => window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const recorder: unknown = Reflect.get(window, 'recordMessage');
    if (typeof recorder === 'function') recorder(event.data);
  }));
  await setup(context, page);
  await context.route(`${postingOrigin}/posts*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.search === '?destination=1') return route.fulfill({ json: { owner: 'owner', repository: 'blog', branch: 'main' } });
    sent.push(route.request().method());
    if (route.request().method() === 'GET') return route.fulfill({ json: { exists: false } });
    expect(route.request().headers().origin).toBe(postingOrigin);
    const article = await multipart(route);
    expect(article.markdown).toContain('title: "別originの記事"'); expect(article.markdown).toContain('https://images.example.com/images/');
    expect(article.images).toHaveLength(1); expect(article.images[0]?.file.type).toBe('image/jpeg');
    await route.fulfill({ status: 201, json: { articlePath: article.articlePath } });
  });
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page);
  expect(new URL(target.url()).origin).not.toBe(new URL(page.url()).origin);
  expect(target.url()).toBe(postingUrl);
  await expect(target.locator('.article-confirmation')).toContainText('別originの記事');
  await expect(target.getByRole('img')).toHaveCount(1);
  await expect(target.getByText('owner/blog', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('記事と写真を渡しました');
  expect(sent).toEqual([]);
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
  expect(await target.evaluate(() => window.opener)).toBeNull();
  await target.getByRole('button', { name: '投稿を確定', exact: true }).click();
  await expect(target.getByRole('status')).toContainText('投稿しました');
  expect(sent).toEqual(['GET', 'POST']);
  const signal = z.strictObject({ type: z.enum(['blog-md:ready', 'blog-md:received']), id: z.uuid() });
  for (const data of messages) expect(signal.safeParse(data).success).toBe(true);
  expect(messages).toHaveLength(2);
  await page.reload(); await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
});

test('同日の記事があると連番で投稿し実際の保存名を表示する', async ({ page, context }) => {
  await setup(context, page);
  const checked: string[] = [];
  const saved: string[] = [];
  await context.route(`${postingOrigin}/posts*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.search === '?destination=1') return route.fulfill({ json: { owner: 'owner', repository: 'blog', branch: 'main' } });
    if (route.request().method() === 'GET') {
      const path = url.searchParams.get('path');
      if (!path) throw new Error('確認する保存名がありません。');
      checked.push(path);
      return route.fulfill({ json: { exists: checked.length === 1 } });
    }
    const article = await multipart(route);
    saved.push(article.articlePath);
    expect(article.articlePath).toBe(checked[1]);
    expect(article.markdown).toContain(`date: "${article.articlePath.slice(6, 16)}"`);
    expect(article.images).toHaveLength(1);
    return route.fulfill({ status: 201, json: { articlePath: article.articlePath } });
  });
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page);
  await expect(target.getByText('同日の記事がある場合、保存名に -2、-3… を付けます。')).toBeVisible();
  await target.getByRole('button', { name: '投稿を確定', exact: true }).click();
  await expect(target.getByRole('status')).toContainText('投稿しました');
  const originalPath = checked[0];
  const savedPath = saved[0];
  if (!originalPath || !savedPath) throw new Error('投稿された保存名がありません。');
  expect(savedPath).toBe(originalPath.replace('.md', '-2.md'));
  await expect(target.getByRole('heading', { level: 2 })).toHaveText(savedPath);
  await expect(target.getByRole('status')).toHaveText(`投稿しました。${savedPath}`);
  await expect(target.getByRole('button', { name: '投稿を確定', exact: true })).toBeDisabled();
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
});

test('未認証の確認要求ではデータを渡さずタブを閉じても下書きと写真を保持する', async ({ page, context }) => {
  await setup(context, page);
  await context.route(`${postingOrigin}/posts?destination=1`, (route) => route.fulfill({ status: 403, json: { error: 'unauthorized' } }));
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page);
  await expect(target.getByRole('alert')).toContainText('投稿先を確認できません');
  await expect(target.locator('.article-confirmation')).toHaveCount(0);
  await expect(target.getByRole('button', { name: '投稿を確定', exact: true })).toHaveCount(0);
  await target.close(); await expect(page.getByRole('alert')).toContainText('下書きと写真は残っています');
  await page.reload(); await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
});

test('許可外origin・別Window・別ID・不正形式を拒否し正しい送信だけ受信する', async ({ page, context }) => {
  await page.goto('/'); await preparePosting(context, page.url());
  const editorOrigin = new URL(page.url()).origin;
  const [target] = await Promise.all([page.waitForEvent('popup'), page.evaluate((url) => { window.open(url, '_blank'); }, postingUrl)]);
  await expect(target.getByText('共通Editorから記事と写真を受け取るのを待っています。')).toBeVisible();
  await expect(target.getByText('GitHub', { exact: true })).toBeVisible();
  const id = '550e8400-e29b-41d4-a716-446655440000';
  await target.evaluate(({ origin, id }) => {
    const opener: Window | null = window.opener;
    const frame = document.createElement('iframe'); document.body.append(frame);
    const stranger = frame.contentWindow;
    const message = { type: 'blog-md:article', id, article: { markdown: '許可された本文', path: 'posts/2026-10-10.md', images: [] } };
    function dispatch(data: unknown, source: Window | null = opener, sender = origin) {
      window.dispatchEvent(new MessageEvent('message', { data, origin: sender, source }));
    }
    dispatch({ type: 'blog-md:hello', id }, opener, 'https://evil.example');
    dispatch(message);
    dispatch({ type: 'blog-md:hello', id }, stranger);
    dispatch(message);
    dispatch({ type: 'blog-md:hello', id });
    dispatch(message, opener, 'https://evil.example');
    dispatch(message, stranger);
    dispatch(message, null);
    dispatch({ ...message, id: '550e8400-e29b-41d4-a716-446655440001' });
    dispatch({ ...message, token: 'unexpected-token' });
    dispatch({ ...message, article: { ...message.article, path: '../README.md' } });
  }, { origin: editorOrigin, id });
  await expect(target.locator('.article-confirmation')).toHaveCount(0);
  await target.evaluate(({ origin, id }) => {
    window.dispatchEvent(new MessageEvent('message', { source: window.opener, origin,
      data: { type: 'blog-md:article', id, article: { markdown: '許可された本文', path: 'posts/2026-10-10.md', images: [] } } }));
  }, { origin: editorOrigin, id });
  await expect(target.locator('.article-confirmation')).toHaveText('許可された本文');
});

test('保存失敗と確認応答の喪失でもEditorと投稿画面の写真を保持する', async ({ page, context }) => {
  await setup(context, page);
  let posts = 0;
  await context.route(`${postingOrigin}/posts*`, async (route) => {
    if (new URL(route.request().url()).search === '?destination=1') return route.fulfill({ json: { owner: 'owner', repository: 'blog', branch: 'main' } });
    if (route.request().method() === 'GET') return route.fulfill({ json: { exists: false } });
    ++posts;
    const article = await multipart(route); expect(article.images).toHaveLength(1);
    if (posts === 1) return route.fulfill({ status: 503, json: { error: 'save_failed' } });
    return route.fulfill({ status: 201, json: { articlePath: article.articlePath } });
  });
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page); await target.getByRole('button', { name: '投稿を確定' }).click();
  await expect(target.getByRole('alert')).toContainText('入力と写真は残っています');
  await expect(target.getByRole('img')).toHaveCount(1);
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
  await target.getByRole('button', { name: '投稿を確定' }).click(); await expect(target.getByRole('status')).toContainText('投稿しました');
  expect(posts).toBe(2);
});

test('認証中のリダイレクト先へ本文写真を送らずログイン後の同じタブへ渡す', async ({ page, context }) => {
  await setup(context, page);
  let authenticated = false;
  await context.route(`${postingOrigin}/publish`, async (route) => {
    if (!authenticated) return route.fulfill({ status: 302, headers: { location: 'http://127.0.0.1:5174/login' } });
    return route.fallback();
  });
  await context.route('http://127.0.0.1:5174/login', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    '<h1>ローカル認証画面</h1><script>window.addEventListener("message",event=>{document.body.dataset.messages=String(Number(document.body.dataset.messages||0)+1)})</script>' }));
  const target = await popup(page); await expect(target.getByRole('heading', { name: 'ローカル認証画面' })).toBeVisible();
  await expect(page.getByRole('button', { name: '受け渡しを中止' })).toBeVisible();
  expect(await target.locator('body').getAttribute('data-messages')).toBeNull();
  authenticated = true; await target.goto(postingUrl);
  await expect(target.locator('.article-confirmation')).toContainText('別originの記事');
  await expect(page.getByRole('status')).toContainText('記事と写真を渡しました');
});

for (const failure of ['popup', 'timeout', 'opener']) {
  test(`${failure}による受け渡し失敗でも元の下書きと写真を再読込で復元する`, async ({ page, context }) => {
    await setup(context, page);
    const body = await page.getByLabel('本文', { exact: true }).inputValue();
    if (failure === 'popup') await page.evaluate(() => { window.open = () => null; });
    else {
      await page.clock.install();
      await context.route(`${postingOrigin}/publish`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>認証待ち</h1>' }));
    }
    if (failure === 'popup') await page.getByRole('button', { name: '投稿', exact: true }).click();
    else {
      const target = await popup(page);
      await expect(target.getByRole('heading', { name: '認証待ち' })).toBeVisible();
      if (failure === 'opener') await target.close();
      await page.clock.runFor(failure === 'timeout' ? 121_000 : 1_000);
    }
    await expect(page.getByRole('alert')).toContainText('下書きと写真は残っています');
    await page.reload(); await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
    await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
  });
}

test('確定時に認証が切れた転送では本文写真をログイン先へ再送しない', async ({ page, context }) => {
  await setup(context, page);
  let loginCalls = 0;
  await context.route('http://127.0.0.1:5174/expired', (route) => { ++loginCalls; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>再認証</h1>' }); });
  await context.route(`${postingOrigin}/posts*`, async (route) => {
    if (new URL(route.request().url()).search === '?destination=1') return route.fulfill({ json: { owner: 'owner', repository: 'blog', branch: 'main' } });
    if (route.request().method() === 'GET') return route.fulfill({ json: { exists: false } });
    return route.fulfill({ status: 307, headers: { location: 'http://127.0.0.1:5174/expired' } });
  });
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page);
  await target.getByRole('button', { name: '投稿を確定' }).click();
  await expect(target.getByRole('alert')).toContainText('入力と写真は残っています');
  expect(loginCalls).toBe(0);
  await expect(target.getByRole('img')).toHaveCount(1);
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
});

test('openerが認証中に切断された場合も受け渡し成功と扱わず下書きを残す', async ({ page, context }) => {
  await setup(context, page);
  await page.clock.install();
  await context.route(`${postingOrigin}/publish`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: '<h1>切断された投稿画面</h1><script>window.opener = null</script>' }));
  const body = await page.getByLabel('本文', { exact: true }).inputValue();
  const target = await popup(page);
  await expect(target.getByRole('heading', { name: '切断された投稿画面' })).toBeVisible();
  expect(await target.evaluate(() => window.opener)).toBeNull();
  await page.clock.runFor(121_000);
  await expect(page.getByRole('alert')).toContainText('下書きと写真は残っています');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue(body);
  await expect(page.getByText('1枚を準備済み', { exact: true })).toBeVisible();
});
