import { useEffect, useState, type ReactNode } from 'react';
import { yen } from '../lib/util';

export function useHash(): string {
  const get = () => window.location.hash.replace(/^#/, '') || '/';
  const [h, setH] = useState(get);
  useEffect(() => {
    const f = () => {
      setH(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export const go = (path: string) => {
  window.location.hash = path;
};

export function TopBar(props: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      {props.back !== undefined && (
        <a className="icon-btn" href={`#${props.back}`} aria-label="戻る" style={{ textDecoration: 'none' }}>
          ‹
        </a>
      )}
      <h1>{props.title}</h1>
      {props.right}
    </header>
  );
}

export function Card(props: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {props.title && (
        <h2>
          {props.title}
          <span className="spacer" />
          {props.right}
        </h2>
      )}
      {props.children}
    </section>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ flex: 1 }}>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Amt(props: { v: number; dir?: 'in' | 'out' }) {
  return <span className={`amt ${props.dir ?? ''}`}>{props.dir === 'out' ? '−' : props.dir === 'in' ? '+' : ''}{yen(props.v)}</span>;
}

export function Field(props: { label: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <label className="field" style={props.style}>
      {props.label}
      {props.children}
    </label>
  );
}

export function NumInput(props: { value: number | undefined; onChange: (n: number) => void; placeholder?: string; step?: number }) {
  const [s, setS] = useState(props.value === undefined ? '' : String(props.value));
  useEffect(() => {
    setS((cur) => (Number(cur) === props.value ? cur : props.value === undefined ? '' : String(props.value)));
  }, [props.value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={props.step ?? 1}
      value={s}
      placeholder={props.placeholder}
      onChange={(e) => {
        setS(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) props.onChange(n);
      }}
    />
  );
}

export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {props.options.map(([v, l]) => (
        <button key={v} className={props.value === v ? 'on' : ''} onClick={() => props.onChange(v)} role="tab" aria-selected={props.value === v}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (b: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/** 確認ダイアログ（理由入力つきも可） */
export function askReason(message: string, def = ''): string | null {
  const r = window.prompt(message, def);
  if (r === null) return null;
  return r.trim();
}
