import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import { I18nProvider } from './i18n';

const GameApp = lazy(() => import('./game/GameApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function Root() {
  const admin = location.pathname.startsWith('/admin');
  return (
    <I18nProvider>
      <Suspense fallback={<div className="boot">…</div>}>{admin ? <AdminApp /> : <GameApp />}</Suspense>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
