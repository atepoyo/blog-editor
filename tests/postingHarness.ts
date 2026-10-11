import type { BrowserContext } from '@playwright/test';

export const postingOrigin = 'http://127.0.0.1:5173';
export const postingUrl = `${postingOrigin}/publish`;

export async function preparePosting(context: BrowserContext, editorUrl: string) {
  const editorOrigin = new URL(editorUrl).origin;
  await context.route(`${postingOrigin}/publish`, async (route) => {
    const response = await fetch(new URL('/publish.html', editorOrigin));
    const html = (await response.text()).replace('__BLOG_EDITOR_ORIGIN__', editorOrigin);
    await route.fulfill({ contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: html });
  });
  await context.route(`${postingOrigin}/assets/**`, async (route) => {
    const response = await fetch(new URL(new URL(route.request().url()).pathname, editorOrigin));
    await route.fulfill({ contentType: response.headers.get('content-type') ?? 'application/octet-stream', body: Buffer.from(await response.arrayBuffer()) });
  });
  await context.route(`${postingOrigin}/posts?destination=1`, (route) => route.fulfill({ json: {
    owner: 'owner', repository: 'blog', branch: 'main',
  } }));
}
