import { cloudDraftSchema, syncRequestSchema } from '../src/syncProtocol';
import { response } from './access';

export interface DraftBucket {
  get(key: string): Promise<{ etag: string; json(): Promise<unknown> } | null>;
  put(key: string, value: string, options: { onlyIf: Headers; httpMetadata: { contentType: string } }): Promise<object | null>;
}

export async function handleDraftSync(request: Request, bucket: DraftBucket | undefined): Promise<Response> {
  if (!bucket) return response(503, { error: 'sync_unavailable' });
  const url = new URL(request.url);
  if (url.search !== '?draft=1') return response(400, { error: 'invalid_sync' });
  if (request.method !== 'GET' && request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
  const key = 'current';
  async function current() {
    const object = await bucket?.get(key);
    return object ? { etag: object.etag, draft: cloudDraftSchema.parse(await object.json()) } : null;
  }
  try {
    if (request.method === 'GET') return response(200, { draft: (await current())?.draft ?? null });
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim();
    if (contentType !== 'application/json' && contentType !== 'text/plain') return response(400, { error: 'invalid_sync' });
    const input = syncRequestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return response(400, { error: 'invalid_sync' });
    const { baseRevision, draft } = input.data;
    const existing = await current();
    // 成功応答が届かなかった再送だけを同じ更新として扱い、写真も含めて照合する。
    if (existing?.draft.revision === draft.revision) {
      return JSON.stringify(existing.draft) === JSON.stringify(draft)
        ? response(200, { draft }) : response(400, { error: 'invalid_sync' });
    }
    if ((existing?.draft.revision ?? null) !== baseRevision) return response(409, { draft: existing?.draft ?? null });
    const condition = new Headers(existing ? { 'if-match': `"${existing.etag}"` } : { 'if-none-match': '*' });
    // タイトル・本文・写真を一度の条件付き書込みに含め、部分保存や同時更新を防ぐ。
    const saved = await bucket.put(key, JSON.stringify(draft), { onlyIf: condition, httpMetadata: { contentType: 'application/json' } });
    if (!saved) return response(409, { draft: (await current())?.draft ?? null });
    return response(200, { draft });
  } catch {
    return response(503, { error: 'sync_failed' });
  }
}
