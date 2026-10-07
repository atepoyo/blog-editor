import { z } from 'zod';
import { parseEndpoint } from './article';
import type { Article } from './article';
import { EditorError } from './messages';

const existenceResponse = z.object({ exists: z.boolean() });
const savedResponse = z.object({ articlePath: z.string() });

export function articleFormData(article: Article): FormData {
  const form = new FormData();
  form.append('markdown', article.markdown);
  form.append('manifest', JSON.stringify({
    version: 1,
    articlePath: article.path,
    imageStorage: article.imageStorage,
    images: article.images.map((photo, index) => ({ field: `image-${index}`, filename: photo.file.name, path: photo.path })),
  }));
  article.images.forEach((photo, index) => form.append(`image-${index}`, photo.file, photo.file.name));
  return form;
}

function requireResponse(response: Response): void {
  if (response.status === 409) throw new EditorError('conflict');
  if (response.status === 401 || response.status === 403) throw new EditorError('unauthorized');
  if (!response.ok) throw new EditorError('saveFailed');
}

export async function postArticle(article: Article, endpoint: string, request: typeof fetch = fetch): Promise<void> {
  if (!endpoint.trim()) throw new EditorError('workerRequired');
  const url = parseEndpoint(endpoint);
  const checkUrl = new URL(url);
  checkUrl.searchParams.set('path', article.path);
  const check = await request(checkUrl, { method: 'GET' });
  requireResponse(check);
  const existence = existenceResponse.safeParse(await check.json().catch(() => null));
  if (!existence.success) throw new EditorError('invalidExistence');
  if (existence.data.exists) throw new EditorError('conflict');
  const saved = await request(url, { method: 'POST', body: articleFormData(article) });
  requireResponse(saved);
  const result = savedResponse.safeParse(await saved.json().catch(() => null));
  if (saved.status !== 201 || !result.success || result.data.articlePath !== article.path) {
    throw new EditorError('unconfirmedSave');
  }
}
