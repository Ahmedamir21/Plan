import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { cachedCatalog, fetchCatalog, installCatalog } from './lib/catalogClient';
const root=createRoot(document.getElementById('root')!);
async function mount() {
  // Mount only after SQL hydration. Module-level code must not capture term data: Vite may inline this import.
  const { default: App }=await import('./App');
  root.render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
}
async function start() {
  root.render(<main className="panel mx-auto my-12 max-w-xl p-6" role="status"><h1 className="text-xl font-bold">Planora</h1><p className="mt-3">Loading the verified course catalog…</p></main>);
  try { await fetchCatalog();await mount(); }
  catch {
    const cached=cachedCatalog();
    root.render(<main className="panel mx-auto my-12 max-w-xl p-6"><h1 className="text-xl font-bold">Course catalog unavailable</h1><p className="mt-3" role="alert">We could not load the SQL catalog. Your saved schedule has not been changed. Please retry before relying on course times.</p><button className="btn btn-accent mt-4 px-4 py-2" onClick={()=>void start()}>Retry</button>{cached&&<button className="btn ml-2 mt-4 px-4 py-2" onClick={()=>{installCatalog(cached,false);void mount();}}>Open last downloaded catalog (stale)</button>}</main>);
  }
}
void start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((registration) => {
      const announceUpdate = () => {
        if (!registration.waiting) return;
        window.dispatchEvent(new CustomEvent('planora:update-ready', { detail: registration }));
      };

      announceUpdate();

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate();
          }
        });
      });

      window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
