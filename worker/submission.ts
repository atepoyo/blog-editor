import { z } from 'zod';

const articlePathSchema = z.string().regex(/^posts\/\d{4}-\d{2}-\d{2}\.md$/).refine((path) => {
  const day = path.slice(6, -3);
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
});

const imageSchema = z.strictObject({
  field: z.string(),
  filename: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/),
  path: z.string(),
});

const manifestSchema = z.strictObject({
  version: z.literal(1),
  articlePath: articlePathSchema,
  images: z.array(imageSchema),
}).superRefine((manifest, context) => {
  const paths = new Set<string>();
  manifest.images.forEach((image, index) => {
    if (image.field !== `image-${index}` || image.path !== `images/${image.filename}` || paths.has(image.path)) {
      context.addIssue({ code: 'custom', message: '画像の送信フィールドと保存パスが一致しません。' });
    }
    paths.add(image.path);
  });
});

export interface SubmittedPhoto {
  path: string;
  file: File;
}

export interface Submission {
  articlePath: string;
  markdown: string;
  images: SubmittedPhoto[];
}

export class InvalidSubmissionError extends Error {
  constructor() {
    super('投稿データが正しくありません。');
    this.name = 'InvalidSubmissionError';
  }
}

export function parseArticlePath(value: unknown): string {
  const result = articlePathSchema.safeParse(value);
  if (!result.success) throw new InvalidSubmissionError();
  return result.data;
}

export function parseSubmission(form: FormData): Submission {
  const markdown = form.get('markdown');
  const encodedManifest = form.get('manifest');
  if (typeof markdown !== 'string' || !markdown.trim() || typeof encodedManifest !== 'string') {
    throw new InvalidSubmissionError();
  }

  let decodedManifest: unknown;
  try {
    decodedManifest = JSON.parse(encodedManifest);
  } catch {
    throw new InvalidSubmissionError();
  }
  const result = manifestSchema.safeParse(decodedManifest);
  if (!result.success) throw new InvalidSubmissionError();
  const manifest = result.data;

  // 重複フィールドを許すと、検証側と保存側で異なる値を採用する可能性がある。
  const expectedFields = new Set(['markdown', 'manifest', ...manifest.images.map((image) => image.field)]);
  for (const field of form.keys()) {
    if (!expectedFields.delete(field)) throw new InvalidSubmissionError();
  }
  if (expectedFields.size) throw new InvalidSubmissionError();

  const images = manifest.images.map((image): SubmittedPhoto => {
    const file = form.get(image.field);
    if (!(file instanceof File) || file.name !== image.filename || file.type !== 'image/jpeg' || !file.size) {
      throw new InvalidSubmissionError();
    }
    return { path: image.path, file };
  });

  return { articlePath: manifest.articlePath, markdown, images };
}
