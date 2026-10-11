import { z } from 'zod';
import type { Photo } from './article';

const filename = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.jpg$/i);
const photoSchema = z.strictObject({
  name: filename,
  path: z.string(),
  data: z.base64().min(1),
}).refine((photo) => photo.path === `images/${photo.name}`, { message: 'Invalid photo path' });

export const cloudDraftSchema = z.strictObject({
  version: z.literal(1), revision: z.uuid(), title: z.string(), body: z.string(),
  photos: z.array(photoSchema),
}).refine((draft) => new Set(draft.photos.map((photo) => photo.path)).size === draft.photos.length,
  { message: 'Duplicate photos' });

export const syncRequestSchema = z.strictObject({ baseRevision: z.uuid().nullable(), draft: cloudDraftSchema });
export const syncResponseSchema = z.strictObject({ draft: cloudDraftSchema.nullable() });
export const syncMetadataSchema = z.strictObject({
  endpoint: z.string(), baseRevision: z.uuid().nullable(), changeId: z.uuid().nullable(),
  conflict: cloudDraftSchema.nullable(), backup: cloudDraftSchema.nullable(),
});
export type CloudDraft = z.infer<typeof cloudDraftSchema>;
export type SyncMetadata = z.infer<typeof syncMetadataSchema>;
export type SharedDraft = { title: string; body: string; photos: Photo[] };

export async function encodeDraft(draft: SharedDraft, revision: string): Promise<CloudDraft> {
  const photos = await Promise.all(draft.photos.map(async (photo) => {
    const bytes = new Uint8Array(await photo.file.arrayBuffer());
    let binary = '';
    // 大きい写真を引数へ展開するとブラウザのスタック上限に達する。
    for (let start = 0; start < bytes.length; start += 8192) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    }
    return { path: photo.path, name: photo.file.name, data: btoa(binary) };
  }));
  return cloudDraftSchema.parse({ version: 1, revision, title: draft.title, body: draft.body, photos });
}

export function decodeDraft(value: unknown): SharedDraft {
  const draft = cloudDraftSchema.parse(value);
  return { title: draft.title, body: draft.body, photos: draft.photos.map((photo) => {
    const bytes = Uint8Array.from(atob(photo.data), (character) => character.charCodeAt(0));
    return { path: photo.path, file: new File([bytes], photo.name, { type: 'image/jpeg' }) };
  }) };
}

export function sameContent(left: SharedDraft, right: SharedDraft): boolean {
  return left.title === right.title && left.body === right.body && left.photos.length === right.photos.length &&
    left.photos.every((photo, index) => photo.path === right.photos[index]?.path && photo.file === right.photos[index]?.file);
}
