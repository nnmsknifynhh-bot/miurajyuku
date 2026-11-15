import { useCallback, useEffect, useState } from 'react';
import type { AppData } from './lib/types';
import { kvGet, VAULT_KEY, type Session } from './lib/vault';
import { Setup, Unlock } from './pages/Lock';
import { StoreProvider, useStore } from './store';
import { useHash } from './components/ui';
import { Home } from './pages/Home';
import { Fees, Members } from './pages/Fees';
import { ExpeditionDetail, Expeditions } from './pages/Expeditions';
import { CarImport } from './pages/CarImport';
import { DutyChangeImport, DutyImport, Duties } from './pages/Duties';
import { Ledger } from './pages/Ledger';
import { Reminders, useNotifier } from './pages/Reminders';
import { SettingsPage } from './pages/Settings';

type Phase = { k: 'loading' } | { k: 'setup' } | { k: 'locked' } | { k: 'open'; data: AppData; session: Session };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  useEffect(() => {
    kvGet(VAULT_KEY)
      .then((v) => setPhase(v ? { k: 'locked' } : { k: 'setup' }))
      .catch(() => setPhase({ k: 'setup' }));
  }, []);
  const onLock = useCallback(() => setPhase({ k: 'locked' }), []);
  if (phase.k === 'loading') return <div className="lock muted">読み込み中…</div>;
  if (phase.k === 'setup') return <Setup onDone={(data, session) => setPhase({ k: 'open', data, session })} />;
  if (phase.k === 'locked') return <Unlock onDone={(data, session) => setPhase({ k: 'open', data, session })} onReset={() => setPhase({ k: 'setup' })} />;
  return (
    <StoreProvider initial={phase.data} session={phase.session} onLock={onLock}>
      <Shell />
    </StoreProvider>
  );
}

function useAutoLock() {
  const { data, lock } = useStore();
  const minutes = data.settings.autoLockMinutes;
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const touch = () => (last = Date.now());
    const check = () => {
      if (Date.now() - last > minutes * 60_000) lock();
    };
    const vis = () => (document.visibilityState === 'visible' ? check() : undefined);
    const iv = window.setInterval(check, 15_000);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [minutes, lock]);
}

const TABS: [string, string, string][] = [
  ['/', '🏠', 'ホーム'],
  ['/fees', '💴', '部費'],
  ['/exp', '🚗', '遠征'],
  ['/duties', '🙋', '当番'],
  ['/ledger', '📒', '出納帳'],
];

function Shell() {
  const path = useHash();
  useAutoLock();
  useNotifier();
  const seg = path.split('/');
  let page;
  if (path === '/') page = <Home />;
  else if (path === '/fees') page = <Fees />;
  else if (path === '/members') page = <Members />;
  else if (path === '/exp') page = <Expeditions />;
  else if (path.startsWith('/exp/import')) page = <CarImport />;
  else if (seg[1] === 'exp' && seg[2]) page = <ExpeditionDetail id={seg[2]} />;
  else if (path === '/duties') page = <Duties />;
  else if (path === '/duties/import') page = <DutyImport />;
  else if (path === '/duties/change') page = <DutyChangeImport />;
  else if (path === '/ledger') page = <Ledger />;
  else if (path === '/reminders') page = <Reminders />;
  else if (path === '/settings') page = <SettingsPage />;
  else page = <Home />;
  const active = '/' + (seg[1] ?? '');
  return (
    <div className="app">
      {page}
      <nav className="tabs">
        <div className="tabs-inner">
          {TABS.map(([p, i, l]) => (
            <a key={p} href={`#${p}`} className={active === p || (p === '/fees' && active === '/members') ? 'on' : ''}>
              <span className="ti">{i}</span>
              {l}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
