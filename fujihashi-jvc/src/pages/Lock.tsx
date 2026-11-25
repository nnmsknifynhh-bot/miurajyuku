import { useState } from 'react';
import type { AppData } from '../lib/types';
import { emptyData, migrate } from '../lib/defaults';
import { sampleData } from '../lib/sample';
import { clearAll, kvGet, newSession, normPass, saveVault, unsealAny, VAULT_KEY, type Sealed, type Session, requestPersistence } from '../lib/vault';
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
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    const a = normPass(p1);
    if (a.length < 6) return setErr('パスコードは6文字以上にしてください');
    if (a !== normPass(p2)) return setErr('確認用パスコードが一致しません');
    setBusy(true);
    const d = sample ? sampleData() : emptyData();
    if (name.trim()) d.settings.recorderName = name.trim();
    const s = await newSession(a);
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
      <Field label="パスコード（6文字以上。数字だけでも可）">
        <input type={show ? 'text' : 'password'} value={p1} onChange={(e) => setP1(e.target.value)} {...NO_AUTOFILL} />
      </Field>
      <Field label="パスコード（確認）">
        <input type={show ? 'text' : 'password'} value={p2} onChange={(e) => setP2(e.target.value)} {...NO_AUTOFILL} />
      </Field>
      <Check checked={show} onChange={setShow} label="入力した文字を表示する" />
      <p className="muted">※ スマホが「強力なパスワード」を提案しても使わず、ご自身で決めたパスコードを入力してください。全角・半角はどちらでも同じとして扱います。</p>
      <Check checked={sample} onChange={setSample} label="サンプルデータで動作確認する（あとで消去できます）" />
      {err && <div className="alert bad">{err}</div>}
      <button className="btn primary block" disabled={busy} onClick={submit}>
        {busy ? '準備中…' : 'はじめる'}
      </button>
      <p className="muted" style={{ textAlign: 'center', fontSize: 11 }}>版 {__APP_VERSION__}</p>
      <p className="muted">※ パスコードを忘れるとデータを復元できません。設定画面から定期的にバックアップを保存してください。</p>
    </div>
  );
}

const NO_AUTOFILL = { autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, 'data-lpignore': 'true' } as const;

export function Unlock(props: { onDone: (d: AppData, s: Session) => void; onReset: () => void }) {
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const submit = async () => {
    const f = failState();
    if (Date.now() < f.until) return setErr(`入力の失敗が続いたため、あと${Math.ceil((f.until - Date.now()) / 1000)}秒待ってから入力してください`);
    setBusy(true);
    setErr('');
    let sealed: Sealed | undefined;
    try {
      sealed = await kvGet<Sealed>(VAULT_KEY);
    } catch (e) {
      setBusy(false);
      return setErr(`保存データを読み込めません（${e instanceof Error ? e.message : e}）。プライベートブラウズ（シークレット）では使えません`);
    }
    if (!sealed) return props.onReset();
    let opened: { data: AppData; session: Session };
    try {
      opened = await unsealAny<AppData>(sealed, p);
    } catch {
      const n = f.n + 1;
      setFail({ n, until: n >= 5 ? Date.now() + Math.min(300, 30 * (n - 4)) * 1000 : 0 });
      setErr(n >= 5 ? 'パスコードが違います。失敗が続いたため、しばらく入力できません' : `パスコードが違います（${n}回目）。「入力した文字を表示する」で確認してください`);
      setBusy(false);
      return;
    }
    setFail({ n: 0, until: 0 });
    try {
      props.onDone(migrate(opened.data), opened.session);
    } catch (e) {
      // パスコードは正しいが、データの変換で失敗した場合
      setErr(`パスコードは正しいですが、データの読み込みでエラーが起きました: ${e instanceof Error ? e.message : e}`);
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
          <input type={show ? 'text' : 'password'} value={p} onChange={(e) => setP(e.target.value)} autoFocus {...NO_AUTOFILL} />
        </Field>
        <Check checked={show} onChange={setShow} label="入力した文字を表示する" />
        {err && <div className="alert bad">{err}</div>}
        <button className="btn primary block" disabled={busy || !p}>
          {busy ? '確認中…' : 'ロック解除'}
        </button>
      </form>
      <p className="muted">全角・半角、前後の空白、先頭の大文字・小文字の違いは自動で試します。</p>
      <p className="muted" style={{ textAlign: 'center', fontSize: 11 }}>版 {__APP_VERSION__}</p>
      {!forgot ? (
        <button className="btn small" onClick={() => setForgot(true)} style={{ alignSelf: 'center' }}>
          パスコードを忘れた場合
        </button>
      ) : (
        <div className="card stack">
          <b>パスコードを忘れた場合</b>
          <div className="muted">
            データは暗号化されているため、パスコードが無いと元に戻せません。バックアップファイルがあれば、最初からやり直したあと「設定 → バックアップから復元」で戻せます（バックアップ作成時のパスコードが必要）。
          </div>
          <div className="muted">サンプルデータだけで試していた場合は、最初からやり直して問題ありません。</div>
          <Field label="この端末のデータをすべて消して最初からやり直す場合は「消去」と入力">
            <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
          <button
            className="btn danger"
            disabled={confirmText !== '消去'}
            onClick={async () => {
              await clearAll();
              setFail({ n: 0, until: 0 });
              props.onReset();
            }}
          >
            データを消去して最初からやり直す
          </button>
        </div>
      )}
    </div>
  );
}
