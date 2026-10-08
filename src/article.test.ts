import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { generateArticle, imageMarkdown, insertPhoto, localDate, parseEndpoint } from './article';
import type { Photo, Settings } from './article';

const settings: Settings = { publicImageUrl: 'https://images.example.com/base/', workerUrl: '' };
const photo: Photo = { file: new File(['jpeg'], 'fixed.jpg', { type: 'image/jpeg' }), path: 'images/fixed.jpg' };
const now = new Date(2026, 9, 7, 0, 10);

describe('Markdownの生成', () => {
  it('端末のローカル日付で記事パスとfrontmatterを生成する', () => {
    const result = generateArticle('タイトル: "引用"\n次の行', '本文', [], settings, now);
    expect(localDate(now)).toBe('2026-10-07');
    expect(result.path).toBe('posts/2026-10-07.md');
    expect(result.markdown.split('\n')[1]).toBe(String.raw`title: "タイトル: \"引用\"\n次の行"`);
    expect(result.markdown).toContain('date: "2026-10-07"\n---\n\n本文\n');
  });

  it('写真なしの記事はWorkerも公開URLも未設定で生成できる', () => {
    const result = generateArticle('題名', '本文', [], { ...settings, publicImageUrl: '' }, now);
    expect(result.markdown).toContain('本文');
    expect(result.images).toEqual([]);
  });

  it('画像の公開URLと保存パスを組み合わせて同じ成果物を再生成する', () => {
    const body = imageMarkdown(photo.path, '説明');
    const first = generateArticle('題名', body, [photo], settings, now);
    const second = generateArticle('題名', body, [photo], settings, now);
    expect(first.markdown).toContain('![説明](<https://images.example.com/base/images/fixed.jpg> "説明")');
    expect(second).toEqual(first);
    expect(first.images[0]?.file).toBe(photo.file);
  });

  it('公開URLが未設定の写真付き記事では相対URLのまま書き出さない', () => {
    expect(() => generateArticle('題名', imageMarkdown(photo.path, ''), [photo], { ...settings, publicImageUrl: '' }, now)).toThrow('公開URL');
  });

  it('キャプションの特殊文字をMarkdownへ安全に記録する', () => {
    const caption = '波 [青] "朝" \\ & <海> *';
    const tree = fromMarkdown(imageMarkdown('https://example.com/a.jpg', caption));
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') throw new Error('画像段落がありません。');
    const image = paragraph.children[0];
    if (image?.type !== 'image') throw new Error('画像がありません。');
    expect(image.alt).toBe(caption);
    expect(image.title).toBe(caption);
    expect(imageMarkdown(photo.path, '')).toBe('![](<images/fixed.jpg>)');
  });

  it('カーソルの前後の文字を保持して画像の独立段落を挿入する', () => {
    const inserted = insertPhoto('前後', 1, photo, '説明');
    expect(inserted.body).toBe('前\n\n![説明](<images/fixed.jpg> "説明")\n\n後');
    expect(inserted.body.slice(inserted.cursor)).toBe('後');
  });

  it('コード中の画像構文を変更せず本文から削除した画像を送信しない', () => {
    const code = `\`\`\`md\n${imageMarkdown(photo.path, '')}\n\`\`\``;
    const result = generateArticle('題名', code, [photo], { ...settings, publicImageUrl: '' }, now);
    expect(result.markdown).toContain(code);
    expect(result.images).toEqual([]);
  });

  it('公開URLを変更しても写真の名前と保存パスは維持する', () => {
    const result = generateArticle('題名', imageMarkdown(photo.path, ''), [photo], { ...settings, publicImageUrl: 'https://other.example.com' }, now);
    expect(result.markdown).toContain('https://other.example.com/images/fixed.jpg');
    expect(result.images[0]).toBe(photo);
  });

  it('本文で編集したaltとキャプションを生成結果に反映する', () => {
    const result = generateArticle('題名', '![変更したalt](<images/fixed.jpg> "変更した説明")', [photo], settings, now);
    expect(result.markdown).toContain('![変更したalt](<https://images.example.com/base/images/fixed.jpg> "変更した説明")');
  });

  it('認証情報や相対URLを公開URLとして受け入れない', () => {
    for (const value of ['images/', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com?key=value']) {
      expect(() => parseEndpoint(value)).toThrow();
    }
  });
});
