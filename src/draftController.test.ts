import { afterEach, expect, it, vi } from 'vitest';
import { DraftController } from './draftController';
import type { Draft } from './draft';
import type { CloudStore } from './cloudDraft';
import { encodeDraft, decodeDraft } from './syncProtocol';
import type { CloudDraft } from './syncProtocol';

const endpoint = 'https://editor.example.com/posts';
const base = '550e8400-e29b-41d4-a716-446655440000';
const next = '550e8400-e29b-41d4-a716-446655440001';
const initial: Draft = { title: '保存済み', body: '元の本文', photos: [], settings: { workerUrl: endpoint, publicImageUrl: 'https://images.example.com' },
  sync: { endpoint, baseRevision: base, changeId: null, conflict: null, backup: null } };
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('未初期化'); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const controllers: DraftController[] = [];
afterEach(() => { for (const controller of controllers) controller.stop(); controllers.length = 0; vi.useRealTimers(); });
function setup(draft: Draft | null, cloud: CloudStore) {
  vi.useFakeTimers();
  const storage = { value: draft, load: vi.fn(async () => storage.value), save: vi.fn(async (value: Draft) => { storage.value = value; }), close: () => {} };
  const controller = new DraftController(storage, cloud, () => true);
  controllers.push(controller);
  return { controller, storage };
}

it('クラウド確認中の入力を上書きせず競合した両方の本文を残す', async () => {
  const load = deferred<CloudDraft | null>();
  const cloud: CloudStore = { load: () => load.promise, save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.update((draft) => ({ ...draft, body: '確認中の入力' }));
  load.resolve(await encodeDraft({ ...initial, body: '他端末の本文' }, next));
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().draft.body).toBe('確認中の入力');
  expect(storage.value?.sync?.conflict?.body).toBe('他端末の本文');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('遅れて届く保存完了を新しい編集の完了と誤認せず順番に送信する', async () => {
  const first = deferred<{ draft: CloudDraft; conflict: boolean }>();
  const sent: CloudDraft[] = [];
  const cloud: CloudStore = { load: async () => encodeDraft(initial, base), save: vi.fn(async (_endpoint, _base, draft) => {
    sent.push(draft); return sent.length === 1 ? first.promise : { draft, conflict: false };
  }) };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.update((draft) => ({ ...draft, body: '先の入力' }));
  await vi.advanceTimersByTimeAsync(400);
  const old = sent[0]; if (!old) throw new Error('未送信');
  controller.update((draft) => ({ ...draft, body: '最新の入力' }));
  expect(controller.getSnapshot().syncStatus).not.toBe('synced');
  first.resolve({ draft: old, conflict: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(sent.map((draft) => draft.body)).toEqual(['先の入力', '最新の入力']);
  expect(storage.value?.body).toBe('最新の入力');
  expect(storage.value?.sync?.changeId).toBeNull();
  expect(controller.getSnapshot().syncStatus).toBe('synced');
});

it('古い起動時の復元が停止後の新しい復元を上書きしない', async () => {
  const old = deferred<Draft | null>();
  vi.useFakeTimers();
  const local = { load: vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce({ ...initial, title: '新しい復元' }), save: vi.fn(), close: () => {} };
  const controller = new DraftController(local, { load: async () => encodeDraft(initial, base), save: vi.fn() }, () => true);
  controllers.push(controller);
  const loading = controller.start(); controller.stop(); await controller.start();
  old.resolve(initial); await loading;
  expect(controller.getSnapshot().draft.title).toBe('新しい復元');
  expect(local.save).not.toHaveBeenCalled();
});

it('応答を失った保存の再起動では同じ更新を確認して再送しない', async () => {
  const dirty: Draft = { ...initial, body: '未確認の保存', sync: { endpoint, baseRevision: base, changeId: next, conflict: null, backup: null } };
  const cloud: CloudStore = { load: async () => encodeDraft(dirty, next), save: vi.fn() };
  const { controller } = setup(dirty, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().syncStatus).toBe('synced');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('他端末の版を選んでも端末側の本文と写真をバックアップに残す', async () => {
  const photo = { path: `images/${base}.jpg`, file: new File(['写真の実体'], `${base}.jpg`, { type: 'image/jpeg' }) };
  const conflict = await encodeDraft({ ...initial, title: '他端末', body: '別本文' }, next);
  const dirty: Draft = { ...initial, photos: [photo], sync: { endpoint, baseRevision: base, changeId: crypto.randomUUID(), conflict, backup: null } };
  const cloud: CloudStore = { load: vi.fn(), save: vi.fn() };
  const { controller, storage } = setup(dirty, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0); await controller.resolve('cloud');
  const backup = storage.value?.sync?.backup;
  if (!backup) throw new Error('バックアップなし');
  expect(storage.value?.title).toBe('他端末');
  expect(backup.title).toBe(initial.title);
  expect(await decodeDraft(backup).photos[0]?.file.text()).toBe('写真の実体');
});

it('端末内保存が失敗した本文をクラウドへ送信しない', async () => {
  const cloud: CloudStore = { load: async () => encodeDraft(initial, base), save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  storage.save.mockRejectedValue(new Error('ディスク保存失敗'));
  controller.update((draft) => ({ ...draft, body: '失敗しても残す本文' }));
  await vi.advanceTimersByTimeAsync(400);
  expect(controller.getSnapshot().draft.body).toBe('失敗しても残す本文');
  expect(controller.getSnapshot().status).toBe('saveFailed');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('この端末の版を選んだ競合は他方の写真を残して新しい版として送る', async () => {
  const conflict = await encodeDraft({ ...initial, body: '他端末の写真付き本文', photos: [{ path: `images/${next}.jpg`, file: new File(['他端末の写真'], `${next}.jpg`, { type: 'image/jpeg' }) }] }, next);
  const dirty: Draft = { ...initial, body: '採用する本文', sync: { endpoint, baseRevision: base, changeId: crypto.randomUUID(), conflict, backup: null } };
  const cloud: CloudStore = { load: async () => conflict, save: vi.fn(async (_endpoint, revision, draft) => {
    expect(revision).toBe(conflict.revision); return { draft, conflict: false };
  }) };
  const { controller, storage } = setup(dirty, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  await controller.resolve('local'); await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().syncStatus).toBe('synced');
  expect(storage.value?.body).toBe('採用する本文'); expect(storage.value?.sync?.backup).toEqual(conflict);
  expect(cloud.save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(cloud.save).toHaveBeenCalledTimes(1);
});

it('編集がない復元・クラウド取り込み・設定変更ではクラウドを更新しない', async () => {
  const cloud: CloudStore = { load: vi.fn(async () => encodeDraft({ ...initial, title: '別端末の最新' }, next)), save: vi.fn() };
  const { controller } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.update((draft) => ({ ...draft, settings: { ...draft.settings, publicImageUrl: 'https://other-images.example.com' } }));
  await vi.advanceTimersByTimeAsync(60000);
  expect(controller.getSnapshot().draft.title).toBe('別端末の最新');
  expect(controller.getSnapshot().draft.settings.publicImageUrl).toBe('https://other-images.example.com');
  expect(cloud.load).toHaveBeenCalledTimes(1); expect(cloud.save).not.toHaveBeenCalled();
});

it('下書きの削除はタイトル・本文・写真だけを空にし設定を残して同期する', async () => {
  const photo = { path: `images/${base}.jpg`, file: new File(['写真'], `${base}.jpg`, { type: 'image/jpeg' }) };
  const saved = { ...initial, photos: [photo] };
  const cloud: CloudStore = { load: async () => encodeDraft(saved, base),
    save: vi.fn(async (_endpoint, _revision, draft) => ({ draft, conflict: false })) };
  const { controller, storage } = setup(saved, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  await controller.clear();
  expect(controller.getSnapshot().draft).toMatchObject({ title: '', body: '', photos: [], settings: initial.settings });
  expect(storage.value).toMatchObject({ title: '', body: '', photos: [], settings: initial.settings });
  await vi.advanceTimersByTimeAsync(400);
  expect(cloud.save).toHaveBeenCalledWith(endpoint, base,
    expect.objectContaining({ title: '', body: '', photos: [] }), expect.any(AbortSignal));
  expect(controller.getSnapshot().syncStatus).toBe('synced');
});

it('削除の端末内保存に失敗したら元のタイトル・本文・写真を画面と保存先に残す', async () => {
  const saved = { ...initial, photos: [{ path: `images/${base}.jpg`, file: new File(['写真'], `${base}.jpg`, { type: 'image/jpeg' }) }] };
  const cloud: CloudStore = { load: async () => encodeDraft(saved, base), save: vi.fn() };
  const { controller, storage } = setup(saved, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  storage.save.mockRejectedValue(new Error('端末内保存失敗'));
  await expect(controller.clear()).rejects.toMatchObject({ key: 'draftDeleteFailed' });
  expect(controller.getSnapshot().draft).toEqual(saved);
  expect(storage.value).toEqual(saved);
  await vi.advanceTimersByTimeAsync(400);
  expect(cloud.save).not.toHaveBeenCalled();
});

it('削除後にクラウドの読み込みが届いても古い本文・写真を復元しない', async () => {
  const load = deferred<CloudDraft | null>();
  const cloud: CloudStore = { load: () => load.promise, save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  await controller.clear();
  load.resolve(await encodeDraft({ ...initial, title: '他端末の古い記事', body: '古い本文' }, next));
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.value).toMatchObject({ title: '', body: '', photos: [] });
  expect(controller.getSnapshot().draft).toMatchObject({ title: '', body: '', photos: [] });
  expect(controller.getSnapshot().syncStatus).toBe('conflict');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('削除前の同期完了が遅れて届いても空の下書きを新しい変更として送る', async () => {
  const first = deferred<{ draft: CloudDraft; conflict: boolean }>();
  const sent: CloudDraft[] = [];
  const cloud: CloudStore = { load: async () => encodeDraft(initial, base), save: vi.fn(async (_endpoint, _base, draft) => {
    sent.push(draft); return sent.length === 1 ? first.promise : { draft, conflict: false };
  }) };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.update((draft) => ({ ...draft, body: '削除前の同期中の本文' }));
  await vi.advanceTimersByTimeAsync(400);
  await controller.clear();
  const old = sent[0]; if (!old) throw new Error('未送信');
  first.resolve({ draft: old, conflict: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(sent.map((draft) => draft.body)).toEqual(['削除前の同期中の本文', '']);
  expect(storage.value).toMatchObject({ title: '', body: '', photos: [], settings: initial.settings });
  expect(controller.getSnapshot().syncStatus).toBe('synced');
});

it('同期を再試行すると別端末で更新された本文と写真を取り込み直す', async () => {
  let remote = await encodeDraft(initial, base);
  const cloud: CloudStore = { load: vi.fn(async () => remote), save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().syncStatus).toBe('synced');
  remote = await encodeDraft({ ...initial, body: '別端末で更新した本文', photos: [{ path: `images/${next}.jpg`, file: new File(['別端末の写真'], `${next}.jpg`, { type: 'image/jpeg' }) }] }, next);
  controller.retry(); await vi.advanceTimersByTimeAsync(0);
  expect(cloud.load).toHaveBeenCalledTimes(2);
  expect(storage.value?.body).toBe(remote.body);
  expect(await storage.value?.photos[0]?.file.text()).toBe('別端末の写真');
  expect(controller.getSnapshot().syncStatus).toBe('synced');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('クラウド確認中に同期を再試行しても最新の取得要求を取りこぼさない', async () => {
  const first = deferred<CloudDraft | null>();
  const latest = await encodeDraft({ ...initial, body: '再試行で取り込む本文' }, next);
  const cloud: CloudStore = { load: vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(latest), save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.retry(); await vi.advanceTimersByTimeAsync(0);
  first.resolve(await encodeDraft(initial, base)); await vi.advanceTimersByTimeAsync(1);
  expect(storage.value?.body).toBe(latest.body);
  expect(controller.getSnapshot().syncStatus).toBe('synced');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('再試行で別端末の変更が見つかっても未同期の本文を上書きしない', async () => {
  let remote = await encodeDraft(initial, base);
  const cloud: CloudStore = { load: async () => remote, save: vi.fn() };
  const { controller, storage } = setup(initial, cloud);
  await controller.start(); await vi.advanceTimersByTimeAsync(0);
  controller.update((draft) => ({ ...draft, body: 'この端末の未同期本文' }));
  remote = await encodeDraft({ ...initial, body: '別端末の本文' }, next);
  controller.retry(); await vi.advanceTimersByTimeAsync(0);
  expect(storage.value?.body).toBe('この端末の未同期本文');
  expect(storage.value?.sync?.conflict?.body).toBe(remote.body);
  expect(controller.getSnapshot().syncStatus).toBe('conflict');
  expect(cloud.save).not.toHaveBeenCalled();
});

it('同期先が未設定またはオフラインの再試行では再試行を繰り返さない', async () => {
  vi.useFakeTimers();
  for (const available of [true, false]) {
    const draft: Draft = available ? { ...initial, settings: { ...initial.settings, workerUrl: '' } } : initial;
    const cloud: CloudStore = { load: vi.fn(), save: vi.fn() };
    const local = { load: async () => draft, save: async () => {}, close: () => {} };
    const controller = new DraftController(local, cloud, () => available);
    controllers.push(controller);
    await controller.start(); await vi.advanceTimersByTimeAsync(0);
    controller.retry(); await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().syncStatus).toBe(available ? 'disconnected' : 'offline');
    expect(vi.getTimerCount()).toBe(0);
    expect(cloud.load).not.toHaveBeenCalled();
    expect(cloud.save).not.toHaveBeenCalled();
    controller.stop();
  }
});
