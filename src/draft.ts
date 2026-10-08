import { z } from 'zod';
import type { Photo, Settings } from './article';

export interface Draft {
  title: string;
  body: string;
  photos: Photo[];
  settings: Settings;
}

const recordSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  body: z.string(),
  photoPaths: z.array(z.string()),
  settings: z.object({
    imageStorage: z.enum(['r2', 'github']).optional(),
    publicImageUrl: z.string(),
    workerUrl: z.string(),
  }).transform(({ imageStorage, publicImageUrl, workerUrl }) => ({
    // 旧GitHub設定のURLをR2への投稿に流用すると、保存先と記事内URLが食い違う。
    publicImageUrl: imageStorage === 'github' ? '' : publicImageUrl,
    workerUrl,
  })),
});
const photosSchema = z.array(z.object({ path: z.string(), file: z.instanceof(File) }));

export function createDraftStore() {
  let connection: Promise<IDBDatabase> | null = null;

  function connect(): Promise<IDBDatabase> {
    if (connection) return connection;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blog-md-draft', 1);
      let failed = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore('drafts');
        request.result.createObjectStore('photos', { keyPath: 'path' });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { failed = true; reject(new Error('Draft database is blocked.')); };
      request.onsuccess = () => {
        const database = request.result;
        if (failed || connection !== opening) {
          database.close();
          reject(new Error('Draft store was closed.'));
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (connection === opening) connection = null;
        };
        database.onclose = () => { if (connection === opening) connection = null; };
        resolve(database);
      };
    });
    connection = opening;
    void opening.catch(() => { if (connection === opening) connection = null; });
    return opening;
  }

  function close() {
    const closing = connection;
    connection = null;
    // closeは実行中のトランザクション完了を待つため、最後の保存を中断しない。
    void closing?.then((database) => database.close(), () => undefined);
  }

  async function load(): Promise<Draft | null> {
    const database = await connect();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['drafts', 'photos'], 'readonly');
      const recordRequest = transaction.objectStore('drafts').get('current');
      const photosRequest = transaction.objectStore('photos').getAll();
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => {
        try {
          const recordValue: unknown = recordRequest.result;
          if (recordValue === undefined) { resolve(null); return; }
          const record = recordSchema.parse(recordValue);
          const photosValue: unknown = photosRequest.result;
          const storedPhotos = photosSchema.parse(photosValue);
          const photos = record.photoPaths.map((path) => {
            const photo = storedPhotos.find((item) => item.path === path);
            if (!photo) throw new Error('A saved photo is missing.');
            return photo;
          });
          resolve({ title: record.title, body: record.body, settings: record.settings, photos });
        } catch (error) { reject(error); }
      };
    });
  }

  async function save(draft: Draft): Promise<void> {
    const database = await connect();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['drafts', 'photos'], 'readwrite');
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      const draftStore = transaction.objectStore('drafts');
      const recordRequest = draftStore.get('current');
      recordRequest.onsuccess = () => {
        try {
          const recordValue: unknown = recordRequest.result;
          // 別タブの保存も含む直前の状態と比較し、写真の整合性を同じtransactionで保つ。
          const storedPaths = new Set(recordValue === undefined ? [] : recordSchema.parse(recordValue).photoPaths);
          const retained = new Set(draft.photos.map((photo) => photo.path));
          draftStore.put({
            version: 1, title: draft.title, body: draft.body, settings: draft.settings,
            photoPaths: [...retained],
          }, 'current');
          for (const path of storedPaths) if (!retained.has(path)) transaction.objectStore('photos').delete(path);
          // 写真名とFileは追加後に変わらないため、文字入力では写真ストアへアクセスしない。
          for (const photo of draft.photos) if (!storedPaths.has(photo.path)) transaction.objectStore('photos').put(photo);
        } catch (error) {
          try { transaction.abort(); } catch { /* 既にabort済みの場合も元の失敗を返す。 */ }
          reject(error);
        }
      };
    });
  }

  return { load, save, close };
}
