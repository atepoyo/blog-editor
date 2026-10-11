import type { Draft } from './draft';
import { LocalDraftConflict } from './draft';
import { EditorError } from './messages';
import { createCloudStore, SyncError } from './cloudDraft';
import type { CloudStore } from './cloudDraft';
import { decodeDraft, encodeDraft, sameContent } from './syncProtocol';
import type { CloudDraft, SyncMetadata } from './syncProtocol';

export type DraftStatus = 'loading' | 'saving' | 'saved' | 'readFailed' | 'saveFailed';
export type SyncStatus = 'disconnected' | 'checking' | 'pending' | 'syncing' | 'synced' | 'offline' | 'failed' | 'unauthorized' | 'conflict';
export interface DraftState { draft: Draft; status: DraftStatus; syncStatus: SyncStatus }
interface LocalStore {
  load(): Promise<Draft | null>;
  save(draft: Draft, options?: { expected?: Draft | null; replacedPhotoPaths?: string[] }): Promise<void>;
  close(): void;
}
const emptyDraft: Draft = { title: '', body: '', photos: [], settings: { publicImageUrl: '', workerUrl: '' } };

export class DraftController {
  private state: DraftState = { draft: emptyDraft, status: 'loading', syncStatus: 'disconnected' };
  private listeners = new Set<() => void>();
  private persisted: Draft | null = null;
  private localWrite: Promise<void> | null = null;
  private syncRun: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checkedEndpoint: string | null = null;
  private refreshRequested = false;
  private lifecycle = 0;
  private active = false;
  private ready = false;
  private restoreFailed = false;
  private localChange = 0;
  private persistedChange = 0;
  private blocked = false;
  private retryDelay = 2000;

  constructor(private store: LocalStore, private cloud: CloudStore = createCloudStore(), private online: () => boolean = () => navigator.onLine,
    private automaticSync = true) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(update: Partial<DraftState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  async start() {
    this.active = true;
    const lifecycle = ++this.lifecycle;
    try {
      const saved = await this.store.load();
      if (!this.active || lifecycle !== this.lifecycle) return;
      this.persisted = saved;
      this.ready = true;
      this.emit({ draft: saved ?? emptyDraft, status: 'saved', ...(!this.automaticSync ? {
        syncStatus: saved?.sync?.conflict ? 'conflict' : saved?.settings.workerUrl ? 'pending' : 'disconnected',
      } : {}) });
      this.schedule(0);
    } catch {
      if (this.active && lifecycle === this.lifecycle) {
        this.ready = true;
        this.restoreFailed = true;
        this.emit({ status: 'readFailed' });
      }
    }
  }
  stop() {
    this.active = false;
    ++this.lifecycle;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.store.close();
  }
  private metadata(draft = this.state.draft): SyncMetadata {
    if (draft.sync?.endpoint === draft.settings.workerUrl) return { ...draft.sync };
    return { endpoint: draft.settings.workerUrl, baseRevision: null,
      changeId: draft.title || draft.body || draft.photos.length ? crypto.randomUUID() : null,
      conflict: null, backup: draft.sync?.conflict ?? draft.sync?.backup ?? null };
  }
  update = (change: Draft | ((current: Draft) => Draft)) => {
    if (!this.ready) return;
    const previous = this.state.draft;
    const next = typeof change === 'function' ? change(previous) : change;
    if (next === previous) return;
    if (this.restoreFailed || this.blocked) { this.emit({ draft: next }); return; }
    ++this.localChange;
    const sync = this.metadata(next);
    if (!sameContent(previous, next)) sync.changeId = crypto.randomUUID();
    if (previous.settings.workerUrl !== next.settings.workerUrl) {
      this.abort?.abort();
      this.checkedEndpoint = null;
    }
    this.emit({ draft: { ...next, sync }, status: 'saving',
      syncStatus: sync.conflict ? 'conflict' : next.settings.workerUrl ? 'pending' : 'disconnected' });
    void this.persist();
    this.schedule();
  };
  clear = async () => {
    if (!this.ready || this.restoreFailed || this.blocked || this.state.status !== 'saved') {
      throw new EditorError('draftDeleteFailed');
    }
    const previous = this.state.draft;
    this.update({ ...previous, title: '', body: '', photos: [] });
    await this.persist();
    if (this.state.status !== 'saved') {
      this.emit({ draft: previous });
      throw new EditorError('draftDeleteFailed');
    }
  };
  private replace(draft: Draft) {
    this.emit({ draft, status: 'saving' });
    return this.persist();
  }
  private persist(): Promise<void> {
    if (this.localWrite) return this.localWrite;
    const write = async () => {
      while (this.state.draft !== this.persisted && !this.blocked) {
        const snapshot = this.state.draft;
        const change = this.localChange;
        try {
          const replacedPhotoPaths = snapshot.photos.filter((photo) => this.persisted?.photos.some((stored) => stored.path === photo.path && stored.file !== photo.file)).map((photo) => photo.path);
          // 明示的な端末編集は既存の保存動作を保つ。クラウド取り込みだけは他タブの保存も保護する。
          await this.store.save(snapshot, { ...(change === this.persistedChange ? { expected: this.persisted } : {}), replacedPhotoPaths });
          this.persisted = snapshot;
          this.persistedChange = change;
        } catch (error) {
          // 他タブの新しい保存を見つけた場合は、画面の内容もDBの内容も上書きしない。
          if (error instanceof LocalDraftConflict) this.blocked = true;
          this.emit({ status: 'saveFailed', syncStatus: 'failed' });
          return;
        }
      }
      if (!this.blocked) this.emit({ status: 'saved' });
    };
    this.localWrite = write().finally(() => { this.localWrite = null; });
    return this.localWrite;
  }
  private schedule(delay = 400) {
    if (!this.automaticSync || !this.active || !this.ready || this.blocked || this.restoreFailed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sync(); }, delay);
  }
  retry = () => { this.refreshRequested = true; this.retryDelay = 2000; this.schedule(0); };
  private async sync() {
    if (this.syncRun || !this.active || !this.ready || this.blocked || this.restoreFailed) return;
    const endpoint = this.state.draft.settings.workerUrl;
    this.syncRun = this.synchronize().finally(() => {
      this.syncRun = null;
      if (this.active && (endpoint !== this.state.draft.settings.workerUrl || this.refreshRequested)) this.schedule(0);
    });
    await this.syncRun;
  }
  private async synchronize() {
    if (this.refreshRequested) { this.checkedEndpoint = null; this.refreshRequested = false; }
    const endpoint = this.state.draft.settings.workerUrl;
    if (!endpoint) { this.emit({ syncStatus: 'disconnected' }); return; }
    if (!this.online()) { this.emit({ syncStatus: 'offline' }); return; }
    const lifecycle = this.lifecycle;
    const abort = new AbortController();
    this.abort = abort;
    const valid = () => this.active && lifecycle === this.lifecycle && !abort.signal.aborted && this.state.draft.settings.workerUrl === endpoint;
    try {
      if (!this.state.draft.sync || this.state.draft.sync.endpoint !== endpoint) {
        await this.replace({ ...this.state.draft, sync: this.metadata() });
      }
      await this.persist();
      if (this.state.status !== 'saved' || !valid()) return;
      if (this.checkedEndpoint !== endpoint) {
        this.emit({ syncStatus: 'checking' });
        const cloud = await this.cloud.load(endpoint, abort.signal);
        if (!valid()) return;
        this.checkedEndpoint = endpoint;
        const current = this.state.draft;
        const sync = this.metadata();
        if (cloud && cloud.revision !== sync.baseRevision) {
          if (cloud.revision === sync.changeId) {
            await this.replace({ ...current, sync: { ...sync, baseRevision: cloud.revision, changeId: null } });
          } else if (sync.changeId) {
            await this.replace({ ...current, sync: { ...sync, conflict: cloud } });
            this.emit({ syncStatus: 'conflict' });
            return;
          } else {
            await this.replace({ ...current, ...decodeDraft(cloud), sync: { ...sync, baseRevision: cloud.revision } });
          }
        }
      }
      while (valid()) {
        await this.persist();
        if (this.state.status !== 'saved' || !valid()) return;
        const snapshot = this.state.draft;
        const sync = this.metadata();
        if (sync.conflict) { this.emit({ syncStatus: 'conflict' }); return; }
        if (!sync.changeId) { this.emit({ syncStatus: 'synced' }); this.retryDelay = 2000; return; }
        this.emit({ syncStatus: 'syncing' });
        const encoded = await encodeDraft(snapshot, sync.changeId);
        if (!valid()) return;
        const result = await this.cloud.save(endpoint, sync.baseRevision, encoded, abort.signal);
        if (!valid()) return;
        const latest = this.state.draft;
        const latestSync = this.metadata();
        if (result.conflict) {
          await this.replace({ ...latest, sync: { ...latestSync, conflict: result.draft } });
          this.emit({ syncStatus: 'conflict' });
          return;
        }
        await this.replace({ ...latest, sync: { ...latestSync, baseRevision: encoded.revision,
          changeId: latestSync.changeId === encoded.revision ? null : latestSync.changeId } });
      }
    } catch (error) {
      if (!valid()) return;
      this.emit({ syncStatus: error instanceof SyncError && error.kind === 'unauthorized' ? 'unauthorized' : this.online() ? 'failed' : 'offline' });
      if (this.state.syncStatus === 'failed') {
        this.schedule(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      }
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }
  resolve = async (choice: 'local' | 'cloud') => {
    const current = this.state.draft;
    const sync = this.metadata();
    if (!sync.conflict) return;
    const cloud = sync.conflict;
    const backup = choice === 'local' ? cloud : await encodeDraft(current, sync.changeId ?? crypto.randomUUID());
    // 写真の読み出し中にも入力できるため、その後の編集を古い選択結果で上書きしない。
    if (current !== this.state.draft) return;
    await this.replace({ ...current, ...(choice === 'cloud' ? decodeDraft(cloud) : {}), sync: {
      ...sync, baseRevision: cloud.revision, changeId: choice === 'local' ? crypto.randomUUID() : null,
      conflict: null, backup,
    } });
    if (this.state.status !== 'saved') throw new EditorError('draftSaveFailed');
    this.checkedEndpoint = null;
    this.emit({ syncStatus: 'pending' });
    this.schedule(0);
  };
  acceptManualSync = async (cloud: CloudDraft, action: 'saved' | 'loaded' | 'conflict', expected: Draft) => {
    if (!this.ready || this.restoreFailed || this.blocked || this.state.status !== 'saved' || this.state.draft !== expected) {
      throw new EditorError('draftSaveFailed');
    }
    const sync = this.metadata();
    if (action === 'saved') {
      await this.replace({ ...expected, sync: { ...sync, baseRevision: cloud.revision, changeId: null } });
      if (this.state.status !== 'saved') throw new EditorError('draftSaveFailed');
      this.emit({ syncStatus: 'synced' });
    } else if (action === 'loaded') {
      const decoded = decodeDraft(cloud);
      const localIsEmpty = expected.title === '' && expected.body === '' && expected.photos.length === 0;
      const encoded = await encodeDraft(expected, cloud.revision);
      if (this.state.draft !== expected) throw new EditorError('draftSaveFailed');
      const sameCloudContent = encoded.title === cloud.title && encoded.body === cloud.body &&
        encoded.photos.length === cloud.photos.length && encoded.photos.every((photo, index) => {
          const remotePhoto = cloud.photos[index];
          return photo.path === remotePhoto?.path && photo.name === remotePhoto.name && photo.data === remotePhoto.data;
        });
      if (localIsEmpty || sameCloudContent) {
        await this.replace({ ...expected, ...decoded, sync: { ...sync, baseRevision: cloud.revision,
          changeId: null, conflict: null } });
        if (this.state.status !== 'saved') throw new EditorError('draftSaveFailed');
        this.emit({ syncStatus: 'synced' });
      } else {
        await this.replace({ ...expected, sync: { ...sync, conflict: cloud } });
        if (this.state.status !== 'saved') throw new EditorError('draftSaveFailed');
        this.emit({ syncStatus: 'conflict' });
      }
    } else {
      await this.replace({ ...expected, sync: { ...sync, conflict: cloud } });
      if (this.state.status !== 'saved') throw new EditorError('draftSaveFailed');
      this.emit({ syncStatus: 'conflict' });
    }
  };
  async exportConflict(): Promise<{ local: CloudDraft; cloud: CloudDraft | null }> {
    const draft = this.state.draft;
    return { local: await encodeDraft(draft, draft.sync?.changeId ?? crypto.randomUUID()), cloud: draft.sync?.conflict ?? draft.sync?.backup ?? null };
  }
}
