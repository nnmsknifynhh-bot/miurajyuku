import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Card, Check, Field, NumInput, Seg, TopBar } from '../components/ui';
import { DEFAULT_LINE_TEMPLATE, migrate } from '../lib/defaults';
import { kvDel, kvGet, newSession, seal, unseal, VAULT_KEY, VAULT_PREV_KEY, type Sealed } from '../lib/vault';
import { download, ledgerCsv } from '../lib/csv';
import { sampleData } from '../lib/sample';
import { currentFiscal } from '../lib/ledger';
import type { AppData, GasMethod, Settings } from '../lib/types';
import { fiscalRange, today } from '../lib/util';

export function SettingsPage() {
  const { data: d, update, lock, session, setSession, replaceAll, toast } = useStore();
  const s = d.settings;
  const set = (fn: (x: Settings) => void) => update((x) => fn(x.settings));
  const [pw, setPw] = useState({ cur: '', n1: '', n2: '' });
  const fiscal = currentFiscal(d);
  const [closeFy, setCloseFy] = useState(fiscal.fy - 1);

  const exportBackup = async () => {
    const sealed = await seal(session, d);
    download(`jvc-kaikei-backup-${today()}.json`, JSON.stringify({ format: 'jvc-kaikei-backup', ...sealed }), 'application/json');
    toast('暗号化バックアップを保存しました（同じパスコードで復元できます）');
  };
  const importBackup = async (file: File) => {
    try {
      const sealed = JSON.parse(await file.text()) as Sealed & { format?: string };
      if (sealed.format !== 'jvc-kaikei-backup') throw new Error('バックアップファイルではありません');
      const pass = prompt('バックアップ作成時のパスコードを入力してください');
      if (!pass) return;
      const { data } = await unseal<AppData>(sealed, pass).catch(() => {
        throw new Error('パスコードが違います');
      });
      if (!confirm(`現在のデータをバックアップ（取引${data.txs.length}件・部員${data.members.length}名）で置き換えます。よろしいですか？`)) return;
      replaceAll(migrate(data)); // 今のパスコードで暗号化し直して保存
      toast('復元しました');
    } catch (e) {
      toast({ text: errorText(e), err: true });
    }
  };
  const changePass = async () => {
    if (pw.n1.length < 6) return toast({ text: '新しいパスコードは6文字以上にしてください', err: true });
    if (pw.n1 !== pw.n2) return toast({ text: '確認用が一致しません', err: true });
    try {
      const sealed = await kvGet<Sealed>(VAULT_KEY);
      if (sealed) await unseal(sealed, pw.cur);
    } catch {
      return toast({ text: '現在のパスコードが違います', err: true });
    }
    setSession(await newSession(pw.n1));
    await kvDel(VAULT_PREV_KEY); // 旧パスコードの世代を残さない
    setPw({ cur: '', n1: '', n2: '' });
    toast('パスコードを変更しました');
  };
  const closeYear = () => {
    const r = fiscalRange(closeFy, s.fiscalStartMonth);
    if (!confirm(`${closeFy}年度（${r.from}〜${r.to}）を締めます。\n締めた期間の取引は修正・取り消しできなくなります。\n先に出納帳CSVとバックアップを保存します。`)) return;
    download(`出納帳_${closeFy}年度.csv`, ledgerCsv(d, r.from, r.to));
    exportBackup();
    set((x) => void (x.closedThrough = r.to > (x.closedThrough ?? '') ? r.to : x.closedThrough));
    toast(`${closeFy}年度を締めました`);
  };
  const wipe = async () => {
    if (!confirm('この端末の全データを消去します。元に戻せません。バックアップは保存しましたか？')) return;
    if (prompt('消去する場合は「消去」と入力してください') !== '消去') return;
    await kvDel(VAULT_KEY);
    await kvDel(VAULT_PREV_KEY);
    location.hash = '';
    location.reload();
  };

  return (
    <>
      <TopBar title="設定" back="/" right={<button className="btn small" onClick={lock}>🔒 ロック</button>} />
      <main>
        <Card title="基本">
          <div className="stack">
            <Field label="チーム名">
              <input type="text" value={s.teamName} onChange={(e) => set((x) => void (x.teamName = e.target.value))} />
            </Field>
            <Field label="会計係（記録者名）">
              <input type="text" value={s.recorderName} onChange={(e) => set((x) => void (x.recorderName = e.target.value))} />
            </Field>
            <Field label="年度の開始月">
              <NumInput value={s.fiscalStartMonth} onChange={(n) => n >= 1 && n <= 12 && set((x) => void (x.fiscalStartMonth = n))} />
            </Field>
          </div>
        </Card>

        <Card title="部費・当番">
          <div className="stack">
            <div className="row">
              <Field label="標準の月額部費（円）">
                <NumInput value={s.defaultMonthlyFee} onChange={(n) => set((x) => void (x.defaultMonthlyFee = n))} />
              </Field>
              <Field label="毎月の支払期限（日）">
                <NumInput value={s.feeDueDay} onChange={(n) => n >= 1 && n <= 31 && set((x) => void (x.feeDueDay = n))} />
              </Field>
            </div>
            <Field label="部費の自動作成を始める月">
              <input type="month" value={s.feeStartMonth} onChange={(e) => e.target.value && set((x) => void (x.feeStartMonth = e.target.value))} />
            </Field>
            <Field label="当番の標準支払額（円）">
              <NumInput value={s.dutyDefaultAmount} onChange={(n) => set((x) => void (x.dutyDefaultAmount = n))} />
            </Field>
          </div>
        </Card>

        <Card title="ガソリン代の計算">
          <div className="stack">
            <Seg<GasMethod> value={s.gas.method} onChange={(v) => set((x) => void (x.gas.method = v))} options={[['perKm', 'A: 距離×円/km'], ['fuel', 'B: 距離÷燃費×単価']]} />
            <div className="row">
              <Field label="円/km（A）">
                <NumInput value={s.gas.yenPerKm} step={0.1} onChange={(n) => set((x) => void (x.gas.yenPerKm = n))} />
              </Field>
              <Field label="燃費 km/L（B）">
                <NumInput value={s.gas.kmPerL} step={0.1} onChange={(n) => n > 0 && set((x) => void (x.gas.kmPerL = n))} />
              </Field>
              <Field label="ガソリン 円/L（B）">
                <NumInput value={s.gas.yenPerL} onChange={(n) => set((x) => void (x.gas.yenPerL = n))} />
              </Field>
            </div>
            <Check checked={s.gas.roundTrip} onChange={(b) => set((x) => void (x.gas.roundTrip = b))} label="初期値を往復にする" />
            <div className="muted">設定を変えても、確定済みの精算額と当時の計算条件はそのまま残ります。</div>
          </div>
        </Card>

        <Card title="リマインド">
          <div className="stack">
            <div className="row">
              <Field label="通知時刻（時）">
                <NumInput value={s.reminders.notifyHour} onChange={(n) => n >= 0 && n <= 23 && set((x) => void (x.reminders.notifyHour = n))} />
              </Field>
              <Field label="（分）">
                <NumInput value={s.reminders.notifyMinute} onChange={(n) => n >= 0 && n <= 59 && set((x) => void (x.reminders.notifyMinute = n))} />
              </Field>
            </div>
            <div className="row">
              <Field label="部費: 期限の何日前から">
                <NumInput value={s.reminders.feeDaysBefore} onChange={(n) => set((x) => void (x.reminders.feeDaysBefore = n))} />
              </Field>
              <Field label="交通費: 集金期限の何日前から">
                <NumInput value={s.reminders.transportDaysBefore} onChange={(n) => set((x) => void (x.reminders.transportDaysBefore = n))} />
              </Field>
            </div>
            <Field label="精算: 遠征後何日以内">
              <NumInput value={s.reminders.settleDaysAfter} onChange={(n) => set((x) => void (x.reminders.settleDaysAfter = n))} />
            </Field>
            <Check checked={s.reminders.dutyDayBefore} onChange={(b) => set((x) => void (x.reminders.dutyDayBefore = b))} label="当番支払い: 前日に通知" />
            <Check checked={s.reminders.dutySameDay} onChange={(b) => set((x) => void (x.reminders.dutySameDay = b))} label="当番支払い: 当日に通知" />
          </div>
        </Card>

        <Card title="LINE メッセージの雛形" right={<button className="btn small" onClick={() => set((x) => void (x.lineTemplate = DEFAULT_LINE_TEMPLATE))}>初期値</button>}>
          <textarea value={s.lineTemplate} onChange={(e) => set((x) => void (x.lineTemplate = e.target.value))} style={{ minHeight: 240 }} />
          <div className="muted">使える差し込み: {'{チーム名} {内容} {金額} {期限}'}</div>
        </Card>

        <Card title="AI解析・ルート検索（サーバー接続）">
          <div className="stack">
            <Field label="サーバー接続トークン（Netlify の APP_ACCESS_TOKEN と同じ値）">
              <input type="password" value={s.apiToken} onChange={(e) => set((x) => void (x.apiToken = e.target.value))} autoComplete="off" />
            </Field>
            <div className="muted">未設定でも、端末内の読み取り・距離の手入力で利用できます。設定方法と費用は README を参照してください。</div>
          </div>
        </Card>

        <Card title="セキュリティ">
          <div className="stack">
            <Field label="自動ロック（分・0で無効）">
              <NumInput value={s.autoLockMinutes} onChange={(n) => n >= 0 && set((x) => void (x.autoLockMinutes = n))} />
            </Field>
            <h3>パスコード変更</h3>
            <input type="password" placeholder="現在のパスコード" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} autoComplete="current-password" />
            <input type="password" placeholder="新しいパスコード（6文字以上）" value={pw.n1} onChange={(e) => setPw({ ...pw, n1: e.target.value })} autoComplete="new-password" />
            <input type="password" placeholder="新しいパスコード（確認）" value={pw.n2} onChange={(e) => setPw({ ...pw, n2: e.target.value })} autoComplete="new-password" />
            <button className="btn" onClick={changePass} disabled={!pw.cur || !pw.n1}>
              パスコードを変更
            </button>
          </div>
        </Card>

        <Card title="バックアップ・引き継ぎ">
          <div className="stack">
            <button className="btn primary" onClick={exportBackup}>
              ⬇ 暗号化バックアップを保存
            </button>
            <label className="btn">
              ⬆ バックアップから復元
              <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
            </label>
            <div className="muted">次の会計係へ引き継ぐときは、バックアップファイルとパスコードを別々の方法で渡してください。受け取った人は新しい端末で初期設定後、このボタンから復元します。</div>
          </div>
        </Card>

        <Card title="年度締め">
          <div className="stack">
            <div className="muted">
              締め済み: {s.closedThrough ?? 'なし'}（現在は {fiscal.fy}年度）。締めると出納帳CSVとバックアップを保存し、その年度の取引を修正・取消できないようにします。残高はそのまま翌年度へ繰り越されます。
            </div>
            <div className="row">
              <Field label="締める年度">
                <NumInput value={closeFy} onChange={setCloseFy} />
              </Field>
              <button className="btn" onClick={closeYear} style={{ alignSelf: 'flex-end' }}>
                年度を締める
              </button>
            </div>
          </div>
        </Card>

        <Card title="データ">
          <div className="stack">
            <button
              className="btn"
              onClick={() => confirm('現在のデータをサンプルデータに置き換えます。よろしいですか？') && (replaceAll(sampleData()), toast('サンプルデータを読み込みました'))}
            >
              サンプルデータに置き換える
            </button>
            <button className="btn danger" onClick={wipe}>
              この端末の全データを消去
            </button>
          </div>
        </Card>
      </main>
    </>
  );
}
