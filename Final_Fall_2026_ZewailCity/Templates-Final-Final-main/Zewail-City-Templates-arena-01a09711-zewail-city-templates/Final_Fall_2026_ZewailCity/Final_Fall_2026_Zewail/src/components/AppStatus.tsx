import { useEffect, useState } from 'react';
import { catalogFresh, catalogPublishedAt } from '../lib/catalogClient';

interface UpdateEvent extends CustomEvent<ServiceWorkerRegistration> {}

export function AppStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onUpdate = (event: Event) => setRegistration((event as UpdateEvent).detail);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('planora:update-ready', onUpdate);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('planora:update-ready', onUpdate);
    };
  }, []);

  const refresh = () => {
    const worker = registration?.waiting;
    if (!worker) {
      window.location.reload();
      return;
    }

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  if (!catalogFresh) return <div className="status-banner status-offline no-print" role="alert"><strong>Stale catalog</strong><span>Last downloaded publication: {catalogPublishedAt ? new Date(catalogPublishedAt).toLocaleString() : 'unknown'}. Check online before relying on it. Saved schedules are preserved.</span><button className="btn px-3 py-2" onClick={()=>window.location.reload()}>Retry online</button></div>;

  if (!online) {
    return (
      <div className="status-banner status-offline no-print" role="status" aria-live="polite">
        <strong>Offline</strong>
        <span>Planner still works · AI unavailable</span>
      </div>
    );
  }

  if (registration?.waiting) {
    return (
      <div className="status-banner status-update no-print" role="status" aria-live="polite">
        <span><strong>New Planora version available</strong> · refresh to update</span>
        <button type="button" className="btn btn-tap px-3 py-1.5 text-[11px]" onClick={refresh}>
          Refresh
        </button>
      </div>
    );
  }

  return null;
}
