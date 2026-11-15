import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppData } from './lib/types';
import { saveVault, type Session } from './lib/vault';
import { AppError } from './lib/ledger';
import { ensureFeeCharges } from './lib/fees';

export interface ToastMsg { text: string; err?: boolean; undo?: () => void }

interface Ctx {
  data: AppData;
  /** データを変更して暗号化保存。失敗時はエラー表示して false */
  update: (fn: (d: AppData) => void, okMsg?: string | ((d: AppData) => ToastMsg)) => boolean;
  toast: (t: ToastMsg | string) => void;
  lock: () => void;
  session: Session;
  setSession: (s: Session) => void;
  replaceAll: (d: AppData) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('store missing');
  return c;
}

export function errorText(e: unknown): string {
  if (e instanceof AppError || e instanceof Error) return e.message;
  return String(e);
}

export function StoreProvider(props: { initial: AppData; session: Session; onLock: () => void; children: ReactNode }) {
  const [data, setData] = useState<AppData>(props.initial);
  const [session, setSessionState] = useState<Session>(props.session);
  const [toastMsg, setToast] = useState<ToastMsg | null>(null);
  const ref = useRef(data);
  const sessRef = useRef(session);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((t: ToastMsg | string) => {
    const msg = typeof t === 'string' ? { text: t } : t;
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), msg.undo ? 6000 : 3000);
  }, []);

  const persist = useCallback(
    (d: AppData) => {
      saving.current = saving.current
        .then(() => saveVault(sessRef.current, d))
        .catch((e) => toast({ text: `保存に失敗しました: ${errorText(e)}`, err: true }));
    },
    [toast],
  );

  const update = useCallback<Ctx['update']>(
    (fn, okMsg) => {
      const next = structuredClone(ref.current);
      try {
        fn(next);
      } catch (e) {
        toast({ text: errorText(e), err: true });
        return false;
      }
      ref.current = next;
      setData(next);
      persist(next);
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(next) : okMsg);
      return true;
    },
    [persist, toast],
  );

  const replaceAll = useCallback((d: AppData) => {
    ref.current = d;
    setData(d);
    persist(d);
  }, [persist]);

  const setSession = useCallback((s: Session) => {
    sessRef.current = s;
    setSessionState(s);
    persist(ref.current);
  }, [persist]);

  // 月が変わったら部費予定を自動生成
  useEffect(() => {
    const probe = structuredClone(ref.current);
    if (ensureFeeCharges(probe) > 0) update((d) => void ensureFeeCharges(d));
  }, [update]);

  const lock = useCallback(() => {
    saving.current.finally(props.onLock);
  }, [props.onLock]);

  return (
    <StoreCtx.Provider value={{ data, update, toast, lock, session, setSession, replaceAll }}>
      {props.children}
      {toastMsg && (
        <div className={`toast ${toastMsg.err ? 'err' : ''}`} role="status">
          <span>{toastMsg.text}</span>
          {toastMsg.undo && (
            <button
              onClick={() => {
                toastMsg.undo!();
                setToast(null);
              }}
            >
              取り消す
            </button>
          )}
        </div>
      )}
    </StoreCtx.Provider>
  );
}
