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
    images: article.images.map((photo, index) => ({ field: `image-${index}`, filename: photo.file.name, path: photo.path })),
  }));
  // WebKitでは保存済みFileを直接送るとフォーム全体が空になる場合があるため、同じ内容のBlobを渡す。
  article.images.forEach((photo, index) => form.append(`image-${index}`,
    photo.file.slice(0, photo.file.size, photo.file.type), photo.file.name));
  return form;
}

function requireResponse(response: Response): void {
  if (response.status === 409) throw new EditorError('conflict');
  if (response.status === 401 || response.status === 403) throw new EditorError('unauthorized');
  if (!response.ok) throw new EditorError('saveFailed');
}

export async function postArticle(article: Article, endpoint: string, request: typeof fetch = fetch): Promise<string> {
  if (!endpoint.trim()) throw new EditorError('workerRequired');
  const url = parseEndpoint(endpoint);
  const datedPath = article.path.slice(0, 16);
  for (let number = 1; ; number++) {
    const path = `${datedPath}${number === 1 ? '' : `-${number}`}.md`;
    const checkUrl = new URL(url);
    checkUrl.searchParams.set('path', path);
    const check = await request(checkUrl, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    requireResponse(check);
    const existence = existenceResponse.safeParse(await check.json().catch(() => null));
    if (!existence.success) throw new EditorError('invalidExistence');
    if (existence.data.exists) continue;
    // セッション切れの転送先へ記事や写真を再送しない。
    const saved = await request(url, { method: 'POST', body: articleFormData({ ...article, path }), credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    // 存在確認後に別の投稿が先に保存された場合も、上書きせず次の番号を使う。
    if (saved.status === 409) continue;
    requireResponse(saved);
    const result = savedResponse.safeParse(await saved.json().catch(() => null));
    if (saved.status !== 201 || !result.success || result.data.articlePath !== path) {
      throw new EditorError('unconfirmedSave');
    }
    return result.data.articlePath;
  }
}
