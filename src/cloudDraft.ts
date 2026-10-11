import { parseEndpoint } from './article';
import { syncResponseSchema } from './syncProtocol';
import type { CloudDraft } from './syncProtocol';

export class SyncError extends Error {
  constructor(readonly kind: 'unauthorized' | 'unavailable' | 'invalid') { super(kind); }
}

export interface CloudStore {
  load(endpoint: string, signal: AbortSignal): Promise<CloudDraft | null>;
  save(endpoint: string, baseRevision: string | null, draft: CloudDraft, signal: AbortSignal): Promise<{ draft: CloudDraft; conflict: boolean }>;
}

export function createCloudStore(request: typeof fetch = fetch): CloudStore {
  async function send(endpoint: string, signal: AbortSignal, body?: object) {
    const url = new URL(parseEndpoint(endpoint));
    url.searchParams.set('draft', '1');
    const response = await request(url, { method: body ? 'POST' : 'GET', signal,
      credentials: 'include', cache: 'no-store', redirect: 'manual',
      // Accessの認証Cookieを送れないpreflightを避け、本文は保存先でJSONとして検証する。
      ...(body ? { headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) } : {}),
    }).catch(() => { throw new SyncError('unavailable'); });
    if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403 ||
      (response.status >= 300 && response.status < 400)) throw new SyncError('unauthorized');
    if (!response.ok && response.status !== 409) throw new SyncError('unavailable');
    const result = syncResponseSchema.safeParse(await response.json().catch(() => null));
    if (!result.success) throw new SyncError('invalid');
    return { draft: result.data.draft, conflict: response.status === 409 };
  }
  return {
    load: async (endpoint, signal) => (await send(endpoint, signal)).draft,
    save: async (endpoint, baseRevision, draft, signal) => {
      const result = await send(endpoint, signal, { baseRevision, draft });
      if (!result.draft || (!result.conflict && JSON.stringify(result.draft) !== JSON.stringify(draft))) throw new SyncError('invalid');
      return { draft: result.draft, conflict: result.conflict };
    },
  };
}
