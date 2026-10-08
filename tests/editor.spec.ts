import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';

test('同じオリジンの投稿APIだけに別タブのログイン導線を表示する', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('ログイン前の下書き');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const input = page.getByLabel('Worker URL');
  const link = page.getByRole('link', { name: '投稿先にログイン（別タブ）' });
  const origin = new URL(page.url()).origin;
  await input.fill(`${origin}/posts`);
  await expect(link).toHaveAttribute('href', `${origin}/auth/login`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: '設定を反映' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in to post (new tab)' })).toBeVisible();
  await input.fill('https://other.example/posts');
  await expect(page.getByRole('link')).toHaveCount(0);
  await input.fill(`${origin}/other-api`);
  await expect(page.getByRole('link')).toHaveCount(0);
  await input.fill('https://');
  await expect(page.getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('ログイン前の下書き');
});

async function settings(page: Page, publicUrl = 'https://images.example.com/', workerUrl = '') {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('画像の公開URL').fill(publicUrl);
  await page.getByLabel('Worker URL').fill(workerUrl);
  await page.getByRole('button', { name: '設定を反映' }).click();
}

async function sourcePhoto(page: Page, rotated = false) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('テスト画像を生成できません。');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 1200, 1200);
    context.fillStyle = '#0000ff';
    context.fillRect(1200, 0, 1200, 1200);
    return canvas.toDataURL('image/jpeg', 1).split(',')[1] ?? '';
  });
  const jpeg = Buffer.from(encoded, 'base64');
  // EXIF Orientation=6の実画像を使い、撮影方向をブラウザが反映することを検証する。
  const orientation = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  const buffer = rotated ? Buffer.concat([jpeg.subarray(0, 2), orientation, jpeg.subarray(2)]) : jpeg;
  await page.getByLabel('写真を選択', { exact: true }).setInputFiles({ name: 'source.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByRole('dialog', { name: 'キャプション', exact: true })).toBeVisible();
  await page.getByLabel('写真の説明（任意）').fill('朝の写真 [青] "空"');
  await page.getByRole('button', { name: '本文に追加' }).click();
}

async function decodedImage(page: Page, image: File) {
  const bytes = [...new Uint8Array(await image.arrayBuffer())];
  return page.evaluate(async (values) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(values)], { type: 'image/jpeg' }));
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('送信画像を読み込めません。');
    context.drawImage(picture, 0, 0);
    const top = [...context.getImageData(canvas.width / 2, canvas.height / 4, 1, 1).data];
    const bottom = [...context.getImageData(canvas.width / 2, canvas.height * 3 / 4, 1, 1).data];
    URL.revokeObjectURL(url);
    return { width: canvas.width, height: canvas.height, top, bottom };
  }, bytes);
}

test('未接続でも記事を書けて投稿操作だけを表示する', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('今日の日記');
  await page.getByRole('textbox', { name: '本文', exact: true }).fill('本文です。');
  await expect(page.getByRole('button', { name: /Markdownをコピー|Copy Markdown/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未接続');
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue('本文です。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('日英を切り替えても記事・写真・設定を保ち案内とエラーを翻訳する', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('タイトル', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('本文', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/editor-ja.png', fullPage: true });
  await page.getByRole('textbox', { name: 'タイトル', exact: true }).fill('私の日記');
  await page.getByRole('textbox', { name: '本文', exact: true }).fill('記事の内容');
  await sourcePhoto(page);
  const body = await page.getByRole('textbox', { name: '本文', exact: true }).inputValue();
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('公開URL');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue('私の日記');
  await expect(page.getByPlaceholder('Body', { exact: true })).toHaveValue(body);
  await expect(page.getByRole('alert')).toContainText('Set the public R2 image URL');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Worker URL')).toHaveAttribute('placeholder', 'https://editor.example.com/posts');
  await expect(page.getByText('Your R2 custom domain without an image filename.', { exact: true })).toBeVisible();
  await page.getByLabel('Public image URL').fill('https://images.example.com/');
  await page.screenshot({ path: 'test-results/settings-en.png', fullPage: true });
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No posting service connected');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('alert')).toContainText('投稿先が未接続');
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue(body);
  await settings(page, 'https://images.example.com/');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const textArea = page.getByRole('textbox', { name: 'Body', exact: true });
  await textArea.dispatchEvent('pointerdown', { button: 0, clientX: 50, clientY: 100 });
  await expect(page.getByRole('dialog', { name: 'Add photo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose photo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Public image URL')).toHaveValue('https://images.example.com/');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('使い方を日英のポップアップで表示し閉じても記事・写真・設定を保つ', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Blog.md');
  await expect(page.locator('.brand')).toHaveText('Blog.md');
  await page.getByLabel('タイトル', { exact: true }).fill('使い方を見ても残る記事');
  await page.getByRole('textbox', { name: '本文', exact: true }).fill('書きかけの本文');
  await sourcePhoto(page);
  await settings(page);
  const body = await page.getByRole('textbox', { name: '本文', exact: true }).inputValue();
  const help = page.getByRole('button', { name: '使い方', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: '使い方', exact: true })).toBeVisible();
  await expect(page.getByText('本文の長押しか、「写真を追加」で挿入します。キャプションは任意です。', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '使い方', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '使う前に', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'よく使うMarkdown', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Help', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Help', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Before you start', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Common Markdown', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('使い方を見ても残る記事');
  await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue(body);
  await expect(page.getByText('1 photo(s) ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue(body);
});

test('長押しで写真追加画面を開き移動操作では開かない', async ({ page }) => {
  await page.goto('/');
  const body = page.getByRole('textbox', { name: '本文', exact: true });
  await body.dispatchEvent('pointerdown', { button: 0, clientX: 50, clientY: 100 });
  await body.dispatchEvent('pointermove', { clientX: 50, clientY: 130 });
  await page.waitForTimeout(650);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await body.dispatchEvent('pointerdown', { button: 0, clientX: 50, clientY: 100 });
  await expect(page.getByRole('dialog', { name: '写真を追加', exact: true })).toBeVisible();
});

test('写真の準備は公開URL未設定でも行え未設定のまま投稿はしない', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('タイトル', { exact: true }).fill('写真の記事');
  await sourcePhoto(page);
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue(/images\/[\da-f-]+\.jpg/);
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('公開URL');
  await settings(page);
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未接続');
});

test('縮小JPEGだけを同一Markdownとともに送り保存失敗後も再送できる', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      document.documentElement.dataset.jpegQuality = String(quality);
      return original.call(this, callback, type, quality);
    };
  });
  await page.goto('/');
  await settings(page, 'https://images.example.com/', 'http://127.0.0.1:5173/worker');
  await page.getByLabel('タイトル', { exact: true }).fill('写真の記事');
  await page.getByRole('textbox', { name: '本文', exact: true }).fill('前の文章');
  await sourcePhoto(page);
  expect(await page.locator('html').getAttribute('data-jpeg-quality')).toBe('1');
  const originalBody = await page.getByRole('textbox', { name: '本文', exact: true }).inputValue();
  const sent: FormData[] = [];
  await page.route('**/worker**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { exists: false } });
      return;
    }
    const request = route.request();
    const buffer = request.postDataBuffer();
    const contentType = await request.headerValue('content-type');
    if (!buffer || !contentType) throw new Error('送信データがありません。');
    const multipart = new Request(request.url(), { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(buffer) });
    sent.push(await multipart.formData());
    if (sent.length === 1) await route.fulfill({ status: 500, json: { error: 'image storage failed' } });
    else {
      const manifest = z.object({ articlePath: z.string() }).parse(JSON.parse(String(sent.at(-1)?.get('manifest'))));
      await route.fulfill({ status: 201, json: { articlePath: manifest.articlePath } });
    }
  });
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('入力と写真は残っています');
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue(originalBody);
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('投稿しました');
  expect(sent).toHaveLength(2);
  expect(sent[1]?.get('markdown')).toBe(sent[0]?.get('markdown'));
  expect(sent[0]?.get('markdown')).toContain('title: "写真の記事"');
  expect(sent[0]?.get('markdown')).toContain('https://images.example.com/images/');
  expect(sent[0]?.get('markdown')).toContain('前の文章');
  const image = sent[0]?.get('image-0');
  const retryImage = sent[1]?.get('image-0');
  if (!(image instanceof File) || !(retryImage instanceof File)) throw new Error('送信画像がありません。');
  expect(image.name).toMatch(/^[\da-f-]+\.jpg$/);
  expect(retryImage.name).toBe(image.name);
  expect(image.type).toBe('image/jpeg');
  expect(await decodedImage(page, image)).toMatchObject({ width: 1920, height: 960 });
});

test('EXIF付き写真の向きを反映して縮小JPEGを送る', async ({ page }) => {
  await page.goto('/');
  await settings(page, 'https://images.example.com/', 'http://127.0.0.1:5173/worker');
  await page.getByLabel('タイトル', { exact: true }).fill('縦の写真');
  await sourcePhoto(page, true);
  let uploaded: File | undefined;
  await page.route('**/worker**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { exists: false } });
    const buffer = route.request().postDataBuffer();
    const contentType = await route.request().headerValue('content-type');
    if (!buffer || !contentType) throw new Error('送信データがありません。');
    const form = await new Request(route.request().url(), { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(buffer) }).formData();
    const image = form.get('image-0');
    if (!(image instanceof File)) throw new Error('送信画像がありません。');
    uploaded = image;
    const manifest = z.object({ articlePath: z.string() }).parse(JSON.parse(String(form.get('manifest'))));
    await route.fulfill({ status: 201, json: { articlePath: manifest.articlePath } });
  });
  await page.getByRole('button', { name: '投稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('投稿しました');
  if (!uploaded) throw new Error('画像が送信されていません。');
  const image = await decodedImage(page, uploaded);
  expect(image).toMatchObject({ width: 960, height: 1920 });
  expect(image.top[0]).toBeGreaterThan(240);
  expect(image.bottom[2]).toBeGreaterThan(240);
});

test('読めない写真は本文へ追加せず再選択できる', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('写真を選択', { exact: true }).setInputFiles({ name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('この写真を読み込めません');
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue('');
  await sourcePhoto(page);
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue(/images\//);
});
