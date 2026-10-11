import { z } from 'zod';
import { parseSubmission } from '../worker/submission';
import type { Article } from './article';
import { articleFormData } from './post';
import { cloudDraftSchema } from './syncProtocol';
import type { SharedDraft } from './syncProtocol';

export const handoffSignal = z.strictObject({
  type: z.enum(['blog-md:hello', 'blog-md:ready', 'blog-md:received']),
  id: z.uuid(),
});
const articleMessage = z.strictObject({
  type: z.literal('blog-md:article'), id: z.uuid(),
  article: z.strictObject({
    markdown: z.string(), path: z.string(),
    images: z.array(z.strictObject({ filename: z.string(), path: z.string(), blob: z.instanceof(Blob) })),
  }),
});

export function encodeArticle(article: Article, id: string) {
  return { type: 'blog-md:article', id, article: {
    markdown: article.markdown, path: article.path,
    images: article.images.map((photo) => ({ filename: photo.file.name, path: photo.path,
      blob: photo.file.slice(0, photo.file.size, photo.file.type) })),
  } };
}

export function decodeArticle(data: unknown, id: string): Article | null {
  const result = articleMessage.safeParse(data);
  if (!result.success || result.data.id !== id) return null;
  try {
    const incoming: Article = { ...result.data.article,
      images: result.data.article.images.map((photo) => ({ path: photo.path,
        file: new File([photo.blob], photo.filename, { type: photo.blob.type }) })),
    };
    const submission = parseSubmission(articleFormData(incoming));
    return { markdown: submission.markdown, path: submission.articlePath, images: submission.images };
  } catch { return null; }
}

export function expectedWindow(event: MessageEvent<unknown>, origin: string, source: Window | null): boolean {
  return source !== null && event.origin === origin && event.source === source;
}

const draftMessageSchema = z.strictObject({
  type: z.literal('blog-md:draft'), id: z.uuid(),
  baseRevision: z.uuid().nullable(), revision: z.uuid(),
  title: z.string(), body: z.string(),
  photos: z.array(z.strictObject({
    filename: z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.jpg$/i),
    path: z.string(), blob: z.instanceof(Blob).refine((blob) => blob.type === 'image/jpeg' && blob.size > 0),
  }).refine((photo) => photo.path === `images/${photo.filename}`)),
}).refine((draft) => new Set(draft.photos.map((photo) => photo.path)).size === draft.photos.length);

export function encodeDraftMessage(draft: SharedDraft, id: string, baseRevision: string | null, revision: string) {
  return { type: 'blog-md:draft', id, baseRevision, revision, title: draft.title, body: draft.body,
    photos: draft.photos.map((photo) => ({ filename: photo.file.name, path: photo.path,
      blob: photo.file.slice(0, photo.file.size, photo.file.type) })),
  };
}

export function decodeDraftMessage(data: unknown, id: string) {
  const result = draftMessageSchema.safeParse(data);
  if (!result.success || result.data.id !== id) return null;
  return { baseRevision: result.data.baseRevision, revision: result.data.revision, draft: {
    title: result.data.title, body: result.data.body,
    photos: result.data.photos.map((photo) => ({ path: photo.path,
      file: new File([photo.blob], photo.filename, { type: 'image/jpeg' }) })),
  } };
}

export const syncResultSchema = z.strictObject({
  type: z.literal('blog-md:sync-result'), id: z.uuid(),
  action: z.enum(['saved', 'loaded', 'conflict']), draft: cloudDraftSchema,
});
export type SyncResult = z.infer<typeof syncResultSchema>;
