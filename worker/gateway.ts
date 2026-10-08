import { z } from 'zod';
import { accessConfig, allowedOrigin, response } from './access';
import type { AccessEnvironment } from './access';

export interface GatewayEnvironment extends AccessEnvironment {
  PUBLISHER: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, environment: GatewayEnvironment, context: { access?: { getIdentity(): Promise<unknown> } }): Promise<Response> {
    try {
      const config = accessConfig(environment);
      const identity = z.object({ email: z.email() }).safeParse(await context.access?.getIdentity());
      if (!identity.success || !config.ALLOWED_EMAILS.includes(identity.data.email.toLowerCase())) {
        return response(403, { error: 'unauthorized' });
      }
      const url = new URL(request.url);
      if (url.pathname === '/auth/login' && request.method === 'GET') {
        return new Response(null, { status: 303, headers: { location: `${config.EDITOR_ORIGIN}/`, 'cache-control': 'no-store' } });
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
