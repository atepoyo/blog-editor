import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import { z } from 'zod';
import { EditorError } from './messages';

export type ImageStorage = 'r2' | 'github';

export interface Settings {
  imageStorage: ImageStorage;
  publicImageUrl: string;
  workerUrl: string;
}

export interface Photo {
  file: File;
  path: string;
}

export interface Article {
  markdown: string;
  path: string;
  imageStorage: ImageStorage;
  images: Photo[];
}

const httpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) &&
    !url.username && !url.password && !url.search && !url.hash;
});

export function parseEndpoint(value: string): string {
  const result = httpUrl.safeParse(value.trim());
  if (!result.success) {
    throw new EditorError('invalidUrl');
  }
  return result.data;
}

export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/[\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g, '\\$&');
}

export function imageMarkdown(url: string, caption: string, alt = caption): string {
  const title = caption ? ` "${escapeMarkdown(caption)}"` : '';
  return `![${escapeMarkdown(alt)}](<${url}>${title})`;
}

export function insertPhoto(body: string, cursor: number, photo: Photo, caption: string) {
  // 選択範囲の文字は消さず、カーソルの先頭に独立した画像段落を追加する。
  const before = body.slice(0, cursor);
  const after = body.slice(cursor);
  const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const suffix = after.startsWith('\n\n') ? '' : (after.startsWith('\n') ? '\n' : '\n\n');
  const inserted = `${prefix}${imageMarkdown(photo.path, caption)}${suffix}`;
  return { body: before + inserted + after, cursor: before.length + inserted.length };
}

export function generateArticle(
  title: string,
  body: string,
  photos: Photo[],
  settings: Settings,
  now: Date,
): Article {
  if (!title.trim()) throw new EditorError('titleRequired');
  const tree = fromMarkdown(body);
  const replacements: { start: number; end: number; value: string }[] = [];
  const used = new Set<Photo>();
  let publicBase: string | undefined;

  // 構文木の画像だけを変換し、コードブロックや本文中の同じファイル名には触れない。
  function visit(node: Nodes): void {
    if (node.type === 'image') {
      const photo = photos.find((item) => item.path === node.url);
      if (photo) {
        if (!settings.publicImageUrl.trim()) throw new EditorError('publicUrlRequired');
        publicBase ??= parseEndpoint(settings.publicImageUrl).replace(/\/?$/, '/');
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          const url = new URL(photo.path, publicBase).href;
          replacements.push({ start, end, value: imageMarkdown(url, node.title ?? '', node.alt ?? '') });
          used.add(photo);
        }
      }
    }
    if ('children' in node) node.children?.forEach(visit);
  }
  visit(tree);
  let markdownBody = body;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    markdownBody = markdownBody.slice(0, replacement.start) + replacement.value + markdownBody.slice(replacement.end);
  }
  const date = localDate(now);
  return {
    markdown: `---\ntitle: ${JSON.stringify(title.trim())}\ndate: ${JSON.stringify(date)}\n---\n\n${markdownBody}\n`,
    path: `posts/${date}.md`,
    imageStorage: settings.imageStorage,
    images: photos.filter((photo) => used.has(photo)),
  };
}
