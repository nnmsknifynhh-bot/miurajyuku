import { useState } from 'react';
import type { AppData } from '../lib/types';
import { emptyData, migrate } from '../lib/defaults';
import { sampleData } from '../lib/sample';
import { kvGet, newSession, saveVault, unseal, VAULT_KEY, type Sealed, type Session, requestPersistence } from '../lib/vault';
import { Check, Field } from '../components/ui';

const FAIL_KEY = 'jvc-fail';
function failState(): { n: number; until: number } {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) || '') as { n: number; until: number };
  } catch {
    return { n: 0, until: 0 };
  }
}
function setFail(v: { n: number; until: number }) {
  try {
    localStorage.setItem(FAIL_KEY, JSON.stringify(v));
  } catch {
    /* noop */
  }
}

export function Setup(props: { onDone: (d: AppData, s: Session) => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [name, setName] = useState('');
  const [sample, setSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (p1.length < 6) return setErr('パスコードは6文字以上にしてください');
    if (p1 !== p2) return setErr('確認用パスコードが一致しません');
    setBusy(true);
    const d = sample ? sampleData() : emptyData();
    if (name.trim()) d.settings.recorderName = name.trim();
    const s = await newSession(p1);
    await saveVault(s, d);
    await requestPersistence();
    props.onDone(d, s);
  };
  return (
    <div className="lock">
      <h1>🏐 藤橋JVC 会計</h1>
      <p className="muted" style={{ textAlign: 'center' }}>
        はじめに会計係用のパスコードを設定します。
        <br />
        データはこの端末内に暗号化して保存されます。
      </p>
      <Field label="会計係のお名前（記録者として出納帳に残ります）">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 三浦" autoComplete="name" />
      </Field>
      <Field label="パスコード（6文字以上）">
        <input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="パスコード（確認）">
        <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />
      </Field>
      <Check checked={sample} onChange={setSample} label="サンプルデータで動作確認する（あとで消去できます）" />
      {err && <div className="alert bad">{err}</div>}
      <button className="btn primary block" disabled={busy} onClick={submit}>
        {busy ? '準備中…' : 'はじめる'}
      </button>
      <p className="muted">※ パスコードを忘れるとデータを復元できません。設定画面から定期的にバックアップを保存してください。</p>
    </div>
  );
}

export function Unlock(props: { onDone: (d: AppData, s: Session) => void; onReset: () => void }) {
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const f = failState();
    if (Date.now() < f.until) return setErr(`しばらく待ってから再入力してください（${Math.ceil((f.until - Date.now()) / 1000)}秒）`);
    setBusy(true);
    try {
      const sealed = await kvGet<Sealed>(VAULT_KEY);
      if (!sealed) return props.onReset();
      const { data, session } = await unseal<AppData>(sealed, p);
      setFail({ n: 0, until: 0 });
      props.onDone(migrate(data), session);
    } catch {
      const n = f.n + 1;
      setFail({ n, until: n >= 5 ? Date.now() + Math.min(300, 30 * (n - 4)) * 1000 : 0 });
      setErr('パスコードが違います');
      setBusy(false);
    }
  };
  return (
    <div className="lock">
      <h1>🔒 藤橋JVC 会計</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="パスコード">
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoFocus autoComplete="current-password" />
        </Field>
        {err && <div className="alert bad">{err}</div>}
        <button className="btn primary block" disabled={busy || !p}>
          {busy ? '確認中…' : 'ロック解除'}
        </button>
      </form>
    </div>
  );
}
