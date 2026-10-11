import { z } from 'zod';
import { accessConfig, allowedOrigin, response } from './access';
import type { AccessEnvironment } from './access';

export interface GatewayEnvironment extends AccessEnvironment {
  PUBLISHER: { fetch(request: Request): Promise<Response> };
  POSTING_UI?: { fetch(request: Request): Promise<Response> };
  COMMON_EDITOR_ORIGIN?: string;
}

const commonEditorOriginSchema = z.url().refine((value) => {
  const origin = new URL(value);
  return origin.protocol === 'https:' && origin.origin === value;
});

function draftSyncResponse(result: Response, corsOrigin?: string): Response {
  const headers = new Headers(result.headers);
  headers.set('cache-control', 'no-store');
  headers.append('vary', 'Origin');
  if (corsOrigin) {
    headers.set('access-control-allow-origin', corsOrigin);
    headers.set('access-control-allow-credentials', 'true');
  }
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}

export default {
  async fetch(request: Request, environment: GatewayEnvironment, context: { access?: { getIdentity(): Promise<unknown> } }): Promise<Response> {
    try {
      const config = accessConfig(environment);
      const url = new URL(request.url);
      if (url.pathname === '/posts' && url.search === '?draft=1') {
        const requestOrigin = request.headers.get('origin');
        const configuredCommonOrigin = commonEditorOriginSchema.safeParse(environment.COMMON_EDITOR_ORIGIN);
        const commonOrigin = configuredCommonOrigin.success ? configuredCommonOrigin.data : undefined;
        const isCommonOrigin = requestOrigin !== null && requestOrigin === commonOrigin;
        const legacyRequest = requestOrigin === config.EDITOR_ORIGIN || (request.method === 'GET' && requestOrigin === null);
        const respond = (result: Response) => draftSyncResponse(result, isCommonOrigin ? commonOrigin : undefined);
        if (!isCommonOrigin && !legacyRequest) return respond(response(403, { error: 'unauthorized' }));
        if (request.method !== 'GET' && request.method !== 'POST') return respond(response(405, { error: 'method_not_allowed' }));
        let accessIdentity: unknown;
        try { accessIdentity = await context.access?.getIdentity(); } catch { accessIdentity = undefined; }
        const identity = z.object({ email: z.email() }).safeParse(accessIdentity);
        if (!identity.success || !config.ALLOWED_EMAILS.includes(identity.data.email.toLowerCase())) {
          return respond(response(403, { error: 'unauthorized' }));
        }
        const headers = new Headers();
        for (const name of ['cf-access-jwt-assertion', 'content-type']) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        if (request.method === 'POST') headers.set('origin', config.EDITOR_ORIGIN);
        try {
          return respond(await environment.PUBLISHER.fetch(new Request(request, { headers })));
        } catch {
          return respond(response(503, { error: 'unavailable' }));
        }
      }
      // 古い画面のリンクも、投稿APIと同じAccessの対象パスへ送る。
      if (url.pathname === '/auth/login' && request.method === 'GET') {
        const login = new URL('/posts?login=1', config.EDITOR_ORIGIN);
        if (url.searchParams.get('lang') === 'en') login.searchParams.set('lang', 'en');
        return new Response(null, { status: 303, headers: { location: login.href, 'cache-control': 'no-store' } });
      }
      const identity = z.object({ email: z.email() }).safeParse(await context.access?.getIdentity());
      if (!identity.success || !config.ALLOWED_EMAILS.includes(identity.data.email.toLowerCase())) {
        return response(403, { error: 'unauthorized' });
      }
      if ((url.pathname === '/publish' || url.pathname.startsWith('/assets/')) && request.method === 'GET') {
        if (!environment.POSTING_UI) return response(503, { error: 'unavailable' });
        const assetUrl = new URL(url.pathname === '/publish' ? '/publish.html' : url.pathname, config.EDITOR_ORIGIN);
        // Static Assetsの内部routerではAccessコンテキストが届かないため、認証後に別Workerから取得する。
        const asset = await environment.POSTING_UI.fetch(new Request(assetUrl));
        if (url.pathname !== '/publish') return asset;
        const editorOrigin = z.url().refine((value) => {
          const origin = new URL(value);
          return origin.protocol === 'https:' && origin.origin === value;
        }).parse(environment.COMMON_EDITOR_ORIGIN);
        if (!asset.ok) return response(503, { error: 'unavailable' });
        const headers = new Headers(asset.headers);
        headers.set('cache-control', 'no-store');
        headers.delete('etag'); headers.delete('content-length');
        const escapedOrigin = editorOrigin.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        return new Response((await asset.text()).replace('__BLOG_EDITOR_ORIGIN__', escapedOrigin), { headers });
      }
      if (url.pathname === '/posts' && url.searchParams.get('login') === '1' && request.method === 'GET') {
        const english = url.searchParams.get('lang') === 'en';
        const title = english ? 'Signed in' : 'ログイン完了';
        const instruction = english ? 'Close this tab and return to the original editor.' : 'このタブを閉じて、元の編集画面に戻ってください。';
        return new Response(`<!doctype html>
<html lang="${english ? 'en' : 'ja'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Blog.md</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;line-height:1.5;color:#302e2b;background:#f6f4f1}
main{max-width:440px;margin:15vh auto;padding:32px 24px}
h1{font-size:24px;color:#a84228}p{font-size:16px}
</style></head>
<body><main><h1>${title}</h1><p>${instruction}</p></main></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (url.pathname !== '/posts') return response(404, { error: 'not_found' });
      if (request.method !== 'GET' && request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
      if (!allowedOrigin(request, config)) return response(403, { error: 'unauthorized' });
      // Cookieを保存Workerへ渡さず、Cloudflareが署名した元の認証情報だけを再検証させる。
      const headers = new Headers();
      for (const name of ['cf-access-jwt-assertion', 'content-type', 'origin']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      const forwarded = new Request(request, { headers });
      return await environment.PUBLISHER.fetch(forwarded);
    } catch {
      return response(503, { error: 'unavailable' });
    }
  },
};
