import { expect, it } from 'vitest';
import { articleFormData } from '../src/post';
import { generateArticle, imageMarkdown } from '../src/article';
import type { Photo } from '../src/article';
import { InvalidSubmissionError, parseArticlePath, parseSubmission } from './submission';

const filename = '550e8400-e29b-41d4-a716-446655440000.jpg';
const imagePath = `images/${filename}`;
const manifest = {
  version: 1,
  articlePath: 'posts/2026-10-08.md',
  images: [{ field: 'image-0', filename, path: imagePath }],
};

function submissionForm(): FormData {
  const form = new FormData();
  form.append('markdown', '---\ntitle: "記事"\ndate: "2026-10-08"\n---\n\n本文');
  form.append('manifest', JSON.stringify(manifest));
  form.append('image-0', new File(['画像データ'], filename, { type: 'image/jpeg' }));
  return form;
}

it('既存フロントが生成した記事と写真を変更せずに受け取る', () => {
  const photo: Photo = { path: imagePath, file: new File(['写真'], filename, { type: 'image/jpeg' }) };
  const article = generateArticle('記事', imageMarkdown(photo.path, '説明'), [photo], {
    publicImageUrl: 'https://images.example.com/', workerUrl: '',
  }, new Date(2026, 9, 8));
  const form = articleFormData(article);
  const result = parseSubmission(form);
  expect(result.articlePath).toBe(article.path);
  expect(result.markdown).toBe(article.markdown);
  expect(result.images).toEqual([{ path: photo.path, file: form.get('image-0') }]);
});

it('写真なしの記事も受け取る', () => {
  const form = submissionForm();
  form.delete('image-0');
  form.set('manifest', JSON.stringify({ ...manifest, images: [] }));
  expect(parseSubmission(form).images).toEqual([]);
});

it('実在する日付の記事パスだけを許可する', () => {
  expect(parseArticlePath('posts/2024-02-29.md')).toBe('posts/2024-02-29.md');
  for (const path of [undefined, null, 1, 'posts/2025-02-29.md', 'posts/2026-13-01.md', 'posts/2026-04-31.md']) {
    expect(() => parseArticlePath(path)).toThrow(InvalidSubmissionError);
  }
});

it('記事パスでディレクトリ移動やワークフローの書き換えを指定できない', () => {
  for (const articlePath of ['../README.md', 'posts/../README.md', '.github/workflows/deploy.yml', '/posts/2026-10-08.md', 'posts%2F2026-10-08.md']) {
    const form = submissionForm();
    form.set('manifest', JSON.stringify({ ...manifest, articlePath }));
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('不正なJSONや契約外の保存先と追加の設定を拒否する', () => {
  for (const value of ['{', 'null', JSON.stringify({ ...manifest, version: 2 }), JSON.stringify({ ...manifest, imageStorage: 'github' }), JSON.stringify({ ...manifest, repository: 'other/repository' })]) {
    const form = submissionForm();
    form.set('manifest', value);
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('重複したMarkdown・manifest・画像フィールドと余分な画像を拒否する', () => {
  for (const field of ['markdown', 'manifest', 'image-0', 'extra-image']) {
    const form = submissionForm();
    form.append(field, '別の値');
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('manifestに含まれる写真が不足している投稿を拒否する', () => {
  const form = submissionForm();
  form.delete('image-0');
  expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
});

it('画像の任意パス・任意ファイル名・重複パス・不正なフィールドを拒否する', () => {
  for (const images of [
    [{ field: 'image-0', filename, path: '../README.md' }],
    [{ field: 'image-0', filename: 'arbitrary.jpg', path: 'images/arbitrary.jpg' }],
    [{ field: 'image-1', filename, path: imagePath }],
    [manifest.images[0], { field: 'image-1', filename, path: imagePath }],
  ]) {
    const form = submissionForm();
    form.set('manifest', JSON.stringify({ ...manifest, images }));
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('画像フィールドの文字列・名前違い・JPEG以外・空ファイルを拒否する', () => {
  for (const file of [
    '写真ではない文字列',
    new File(['写真'], 'other.jpg', { type: 'image/jpeg' }),
    new File(['写真'], filename, { type: 'image/png' }),
    new File([], filename, { type: 'image/jpeg' }),
  ]) {
    const form = submissionForm();
    form.set('image-0', file);
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('本文やmanifestが文字列でない場合と空本文を拒否する', () => {
  for (const [field, value] of [
    ['markdown', '   '],
    ['markdown', new File(['本文'], 'post.md')],
    ['manifest', new File(['{}'], 'manifest.json')],
  ] satisfies [string, string | File][]) {
    const form = submissionForm();
    form.set(field, value);
    expect(() => parseSubmission(form)).toThrow(InvalidSubmissionError);
  }
});

it('拒否した入力値や資格情報をエラーメッセージに含めない', () => {
  const form = submissionForm();
  form.set('manifest', JSON.stringify({ ...manifest, credential: '入力中の秘密情報' }));
  expect(() => parseSubmission(form)).toThrow('投稿データが正しくありません。');
  try {
    parseSubmission(form);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSubmissionError);
    if (!(error instanceof Error)) throw error;
    expect(error.message).not.toContain('入力中の秘密情報');
  }
});
