import { useEffect, useState, useSyncExternalStore } from 'react';
import { createDraftStore } from './draft';
import { DraftController } from './draftController';
export type { DraftStatus, SyncStatus } from './draftController';

export function useDraft() {
  const [controller] = useState(() => new DraftController(createDraftStore(), undefined, undefined, false));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.start();
    window.addEventListener('online', controller.retry);
    window.addEventListener('offline', controller.retry);
    return () => { window.removeEventListener('online', controller.retry); window.removeEventListener('offline', controller.retry); controller.stop(); };
  }, [controller]);
  return { ...state, loading: state.status === 'loading', setDraft: controller.update,
    clearDraft: controller.clear,
    retrySync: controller.retry, resolveConflict: controller.resolve,
    acceptManualSync: controller.acceptManualSync,
    exportConflict: () => controller.exportConflict() };
}
