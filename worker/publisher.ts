import { accessConfig, allowedOrigin, response, verifyAccess } from './access';
import type { AccessConfig, AccessEnvironment } from './access';
import { ArticleConflictError, GitHubStore, StorageError } from './github';
import { InvalidSubmissionError, parseArticlePath, parseSubmission } from './submission';

export interface ImageBucket {
  get(path: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(path: string, data: ArrayBuffer, options: { onlyIf: Headers; httpMetadata: { contentType: string } }): Promise<object | null>;
}

export interface PublisherEnvironment extends AccessEnvironment {
  IMAGES?: ImageBucket;
}

export interface ArticleStore {
  exists(path: string): Promise<boolean>;
  createArticle(path: string, markdown: string): Promise<void>;
}

interface PublisherDependencies {
  verify(request: Request, config: AccessConfig): Promise<boolean>;
  connect(environment: unknown): Promise<ArticleStore>;
}

const productionDependencies: PublisherDependencies = { verify: verifyAccess, connect: (environment) => GitHubStore.connect(environment) };

async function sameBytes(left: ArrayBuffer, right: ArrayBuffer): Promise<boolean> {
  const hashes = await Promise.all([left, right].map((data) => crypto.subtle.digest('SHA-256', data)));
  const first = hashes[0];
  const second = hashes[1];
  if (!first || !second) return false;
  const secondHash = new Uint8Array(second);
  return new Uint8Array(first).every((value, index) => value === secondHash[index]);
}

async function storeR2Image(bucket: ImageBucket, path: string, file: File): Promise<void> {
  const bytes = await file.arrayBuffer();
  const existing = await bucket.get(path);
  if (existing) {
    if (!await sameBytes(bytes, await existing.arrayBuffer())) throw new StorageError();
    return;
  }
  const result = await bucket.put(path, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'image/jpeg' } });
  if (result) return;
  const concurrent = await bucket.get(path);
  if (!concurrent || !await sameBytes(bytes, await concurrent.arrayBuffer())) throw new StorageError();
}

export async function handlePublisher(request: Request, environment: PublisherEnvironment, dependencies = productionDependencies): Promise<Response> {
  try {
    const config = accessConfig(environment);
    if (!await dependencies.verify(request, config) || !allowedOrigin(request, config)) return response(403, { error: 'unauthorized' });
    const url = new URL(request.url);
    if (url.pathname !== '/posts') return response(404, { error: 'not_found' });
    if (request.method === 'GET') {
      const path = parseArticlePath(url.searchParams.get('path'));
      if ([...url.searchParams.keys()].some((key) => key !== 'path') || url.searchParams.getAll('path').length !== 1) {
        throw new InvalidSubmissionError();
      }
      const store = await dependencies.connect(environment);
      return response(200, { exists: await store.exists(path) });
    }
    if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
    if (url.search) throw new InvalidSubmissionError();
    let form: FormData;
    try { form = await request.formData(); } catch { throw new InvalidSubmissionError(); }
    const submission = parseSubmission(form);
    const bucket = environment.IMAGES;
    if (submission.images.length && !bucket) throw new StorageError();
    const store = await dependencies.connect(environment);
    if (await store.exists(submission.articlePath)) throw new ArticleConflictError();
    for (const photo of submission.images) {
      if (bucket) await storeR2Image(bucket, photo.path, photo.file);
    }
    await store.createArticle(submission.articlePath, submission.markdown);
    return response(201, { articlePath: submission.articlePath });
  } catch (error) {
    if (error instanceof InvalidSubmissionError) return response(400, { error: 'invalid_submission' });
    if (error instanceof ArticleConflictError) return response(409, { error: 'conflict' });
    // 上流のエラー本文や例外には資格情報が混ざる可能性があるため、利用者へ返さない。
    return response(503, { error: 'save_failed' });
  }
}

export default {
  fetch(request: Request, environment: PublisherEnvironment): Promise<Response> {
    return handlePublisher(request, environment);
  },
};
