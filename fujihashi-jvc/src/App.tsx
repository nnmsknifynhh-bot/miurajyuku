import { useCallback, useEffect, useState } from 'react';
import type { AppData } from './lib/types';
import { kvGet, VAULT_KEY, type Session } from './lib/vault';
import { Setup, Unlock } from './pages/Lock';
import { StoreProvider, useStore } from './store';
import { useHash } from './components/ui';
import { Home } from './pages/Home';
import { Days, ScheduleImport } from './pages/Days';
import { DayPage } from './pages/DayPage';
import { CarImport } from './pages/CarImport';
import { ExpenseEdit, Expenses } from './pages/Expenses';
import { Fees, Households } from './pages/Fees';
import { Ledger } from './pages/Ledger';
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
  ['/days', '📅', '活動日'],
  ['/expenses', '🧾', '経費'],
  ['/fees', '💴', '月謝'],
  ['/ledger', '📒', '出納帳'],
];

const SECTION: Record<string, string> = { day: '/days', schedule: '/days', expense: '/expenses', households: '/fees' };

function Shell() {
  const path = useHash();
  useAutoLock();
  const [p, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const seg = p.split('/');
  let page;
  if (p === '/days') page = <Days />;
  else if (p === '/schedule') page = <ScheduleImport />;
  else if (seg[1] === 'day' && seg[2] && seg[3] === 'cars') page = <CarImport key={seg[2]} dayId={seg[2]} />;
  else if (seg[1] === 'day' && seg[2]) page = <DayPage key={seg[2]} id={seg[2]} />;
  else if (p === '/expenses') page = <Expenses />;
  else if (seg[1] === 'expense' && seg[2]) page = <ExpenseEdit key={path} id={seg[2]} dayId={q.get('day') ?? undefined} />;
  else if (p === '/fees') page = <Fees />;
  else if (p === '/households') page = <Households />;
  else if (p === '/ledger') page = <Ledger />;
  else if (p === '/settings') page = <SettingsPage />;
  else page = <Home />;
  const active = SECTION[seg[1]] ?? '/' + (seg[1] ?? '');
  return (
    <div className="app">
      {page}
      <nav className="tabs">
        <div className="tabs-inner">
          {TABS.map(([tp, i, l]) => (
            <a key={tp} href={`#${tp}`} className={active === tp ? 'on' : ''}>
              <span className="ti">{i}</span>
              {l}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
