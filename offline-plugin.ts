import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export function offlineCache(): Plugin {
  return {
    name: 'blog-md-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle).filter((entry) => !entry.fileName.endsWith('.map')).sort((a, b) => a.fileName.localeCompare(b.fileName));
      const hash = createHash('sha256');
      for (const entry of entries) hash.update(entry.fileName).update(entry.type === 'chunk' ? entry.code : entry.source);
      const cacheName = `blog-md-shell-${hash.digest('hex').slice(0, 16)}`;
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: `const CACHE = ${JSON.stringify(cacheName)};
const ROOT = new URL(self.registration.scope);
const INDEX = new URL('index.html', ROOT).href;
const FILES = ${JSON.stringify(entries.map((entry) => entry.fileName))}.map((file) => new URL(file, ROOT).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

// 新版は編集中の旧画面が閉じるまで待つ。未保存の入力を強制リロードしない。
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('blog-md-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return;
  if (url.href === new URL('__blog-md-offline-ready', ROOT).href) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(CACHE);
        const missing = [];
        for (const file of FILES) if (!(await cache.match(file))) missing.push(file);
        // Workerのactive状態だけでは、削除・退避された画面キャッシュの存在は保証されない。
        if (missing.length) await cache.addAll(missing);
        return Response.json({ ready: true }, { headers: { 'cache-control': 'no-store' } });
      } catch {
        return Response.json({ ready: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
      }
    })());
    return;
  }
  const isPage = request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.href.split('?')[0] === INDEX);
  const asset = FILES.find((file) => new URL(file).pathname === url.pathname);
  // ビルドした画面ファイルだけを扱い、投稿APIやユーザー画像はキャッシュしない。
  if (!isPage && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(isPage ? INDEX : asset)) || fetch(request);
  })());
});
`,
      });
    },
  };
}
