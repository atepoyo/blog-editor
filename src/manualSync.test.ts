import { afterEach, expect, it, vi } from 'vitest';
import { DraftController } from './draftController';
import type { Draft } from './draft';
import type { CloudStore } from './cloudDraft';
import { encodeDraft } from './syncProtocol';
import type { CloudDraft } from './syncProtocol';

const endpoint = 'https://editor.example.com/posts';
const revision = '550e8400-e29b-41d4-a716-446655440000';
const otherRevision = '550e8400-e29b-41d4-a716-446655440001';
const initial: Draft = { title: '端末の題', body: '端末の本文', photos: [],
  settings: { workerUrl: endpoint, publicImageUrl: '' },
  sync: { endpoint, baseRevision: revision, changeId: null, conflict: null, backup: null } };
const controllers: DraftController[] = [];
afterEach(() => { controllers.forEach((controller) => controller.stop()); controllers.length = 0; vi.useRealTimers(); });

function setup(value: Draft | null, failSave = false) {
  vi.useFakeTimers();
  let stored = value;
  const local = {
    load: vi.fn(async () => stored),
    save: vi.fn(async (draft: Draft) => { if (failSave) throw new Error('local storage failed'); stored = draft; }),
    close: vi.fn(),
  };
  const cloud: CloudStore = { load: vi.fn(async () => null), save: vi.fn() };
  const controller = new DraftController(local, cloud, () => true, false);
  controllers.push(controller);
  return { controller, local, cloud, stored: () => stored };
}

it('手動同期モードは起動・編集・再試行・競合解消で自動通信せず端末保存を続ける', async () => {
  const { controller, local, cloud, stored } = setup(initial);
  await controller.start();
  controller.update((draft) => ({ ...draft, body: '編集した本文' }));
  await vi.runAllTimersAsync();
  const remote = await encodeDraft({ title: 'クラウド題', body: 'クラウド本文', photos: [] }, otherRevision);
  await controller.acceptManualSync(remote, 'conflict', controller.getSnapshot().draft);
  await controller.resolve('local');
  controller.retry();
  await vi.runAllTimersAsync();
  expect(stored()?.body).toBe('編集した本文');
  expect(local.save).toHaveBeenCalled();
  expect(cloud.load).not.toHaveBeenCalled();
  expect(cloud.save).not.toHaveBeenCalled();
});

it('空の端末へ手動読み込みするとクラウド本文と写真を保存して同期済みにする', async () => {
  const backup = await encodeDraft(initial, revision);
  const empty: Draft = { ...initial, title: '', body: '', photos: [],
    sync: { endpoint, baseRevision: revision, changeId: null, conflict: null, backup } };
  const { controller, stored } = setup(empty);
  await controller.start();
  const photo = { path: 'images/550e8400-e29b-41d4-a716-446655440002.jpg',
    file: new File([new Uint8Array([1, 2, 3])], '550e8400-e29b-41d4-a716-446655440002.jpg', { type: 'image/jpeg' }) };
  const remote = await encodeDraft({ title: 'クラウド題', body: 'クラウド本文', photos: [photo] }, otherRevision);
  await controller.acceptManualSync(remote, 'loaded', controller.getSnapshot().draft);
  const result = controller.getSnapshot();
  expect(result.draft.title).toBe('クラウド題');
  expect(result.draft.body).toBe('クラウド本文');
  expect(result.draft.photos).toHaveLength(1);
  expect(result.draft.photos[0]?.path).toBe(photo.path);
  expect(result.draft.settings).toEqual(empty.settings);
  expect(result.draft.sync).toMatchObject({ baseRevision: otherRevision, changeId: null, conflict: null, backup });
  expect(result.syncStatus).toBe('synced');
  expect(stored()?.body).toBe('クラウド本文');
});

it('同じパスでも写真データが異なる手動読み込み結果は競合として保持する', async () => {
  const path = 'images/550e8400-e29b-41d4-a716-446655440002.jpg';
  const filename = '550e8400-e29b-41d4-a716-446655440002.jpg';
  const localPhoto = { path, file: new File([new Uint8Array([1])], filename, { type: 'image/jpeg' }) };
  const localDraft: Draft = { ...initial, photos: [localPhoto] };
  const { controller } = setup(localDraft);
  await controller.start();
  const remotePhoto = { path, file: new File([new Uint8Array([2])], filename, { type: 'image/jpeg' }) };
  const remote = await encodeDraft({ title: initial.title, body: initial.body, photos: [remotePhoto] }, otherRevision);
  await controller.acceptManualSync(remote, 'loaded', controller.getSnapshot().draft);
  expect(controller.getSnapshot().draft.photos[0]?.file).toBe(localPhoto.file);
  expect(controller.getSnapshot().draft.sync?.conflict).toEqual(remote);
  expect(controller.getSnapshot().syncStatus).toBe('conflict');
});

it('同じ内容の端末へ手動読み込みすると同期済みにする', async () => {
  const { controller } = setup(initial);
  await controller.start();
  const expected = controller.getSnapshot().draft;
  const remote = await encodeDraft({ title: initial.title, body: initial.body, photos: [] }, otherRevision);
  await controller.acceptManualSync(remote, 'loaded', expected);
  expect(controller.getSnapshot().draft.sync).toMatchObject({ baseRevision: otherRevision, changeId: null, conflict: null });
  expect(controller.getSnapshot().syncStatus).toBe('synced');
});

it('異なるローカル内容がある手動読み込み結果は競合として保持する', async () => {
  const { controller } = setup(initial);
  await controller.start();
  const expected = controller.getSnapshot().draft;
  const remote = await encodeDraft({ title: 'クラウド題', body: 'クラウド本文', photos: [] }, otherRevision);
  await controller.acceptManualSync(remote, 'loaded', expected);
  expect(controller.getSnapshot().draft.title).toBe(initial.title);
  expect(controller.getSnapshot().draft.body).toBe(initial.body);
  expect(controller.getSnapshot().draft.sync?.conflict).toEqual(remote);
});

it('手動読み込み結果を端末に保存できなければ成功状態にしない', async () => {
  const { controller } = setup(null, true);
  await controller.start();
  const cloud = await encodeDraft({ title: 'クラウド題', body: 'クラウド本文', photos: [] }, otherRevision);
  await expect(controller.acceptManualSync(cloud, 'loaded', controller.getSnapshot().draft)).rejects.toMatchObject({ key: 'draftSaveFailed' });
  expect(controller.getSnapshot().status).toBe('saveFailed');
  expect(controller.getSnapshot().syncStatus).toBe('failed');
});

it('クラウド版を選ぶと端末版をバックアップとして残す', async () => {
  const { controller } = setup(initial);
  await controller.start();
  const expected = controller.getSnapshot().draft;
  const remote = await encodeDraft({ title: 'クラウド題', body: 'クラウド本文', photos: [] }, otherRevision);
  await controller.acceptManualSync(remote, 'conflict', expected);
  await controller.resolve('cloud');
  expect(controller.getSnapshot().draft.body).toBe('クラウド本文');
  expect(controller.getSnapshot().draft.sync?.backup?.body).toBe(initial.body);
});

it('手動同期の保存応答を端末に保存できなければ成功状態にしない', async () => {
  const { controller } = setup(initial, true);
  await controller.start();
  const cloud: CloudDraft = await encodeDraft(initial, otherRevision);
  await expect(controller.acceptManualSync(cloud, 'saved', controller.getSnapshot().draft)).rejects.toMatchObject({ key: 'draftSaveFailed' });
  expect(controller.getSnapshot().status).toBe('saveFailed');
  expect(controller.getSnapshot().syncStatus).toBe('failed');
});

it('古い手動同期結果は現在の編集を上書きしない', async () => {
  const { controller } = setup(initial);
  await controller.start();
  const oldSnapshot = controller.getSnapshot().draft;
  controller.update((draft) => ({ ...draft, body: '新しい編集' }));
  const cloud = await encodeDraft({ title: '古いクラウド', body: '古い結果', photos: [] }, otherRevision);
  await expect(controller.acceptManualSync(cloud, 'loaded', oldSnapshot)).rejects.toMatchObject({ key: 'draftSaveFailed' });
  expect(controller.getSnapshot().draft.body).toBe('新しい編集');
});
