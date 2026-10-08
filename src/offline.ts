import { z } from 'zod';

const readyResponse = z.object({ ready: z.literal(true) });

async function waitForActivation(worker: ServiceWorker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function checkState() {
      if (worker.state === 'activated') { worker.removeEventListener('statechange', checkState); resolve(); }
      else if (worker.state === 'redundant') { worker.removeEventListener('statechange', checkState); reject(new Error('Offline installation failed.')); }
    }
    worker.addEventListener('statechange', checkState);
    checkState();
  });
}

export async function registerOffline(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable.');
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' });
  const worker = registration.active ?? registration.installing ?? registration.waiting;
  if (!worker) throw new Error('No offline worker was installed.');
  await waitForActivation(worker);
  const response = await fetch(new URL('__blog-md-offline-ready', registration.scope), { cache: 'no-store' });
  const result = readyResponse.safeParse(await response.json().catch(() => null));
  if (!response.ok || !result.success) throw new Error('Offline files are unavailable.');
}
