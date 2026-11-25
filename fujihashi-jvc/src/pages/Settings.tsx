import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Card, Field, NumInput, Seg, TopBar } from '../components/ui';
import { migrate } from '../lib/defaults';
import { clearAll, exportImages, importImages, kvDel, kvGet, newSession, normPass, reencryptImages, seal, unsealAny, VAULT_KEY, VAULT_PREV_KEY, type Sealed } from '../lib/vault';
import { download, expensesCsv, feesCsv, ledgerCsv, transportCsv } from '../lib/csv';
import { sampleData } from '../lib/sample';
import { currentFiscal } from '../lib/ledger';
import type { AppData, DueRule, Settings } from '../lib/types';
import { fiscalRange, today } from '../lib/util';

export function SettingsPage() {
  const { data: d, update, lock, session, setSession, replaceAll, toast } = useStore();
  const s = d.settings;
  const set = (fn: (x: Settings) => void) => update((x) => fn(x.settings));
  const [pw, setPw] = useState({ cur: '', n1: '', n2: '' });
  const [busy, setBusy] = useState(false);
  const fiscal = currentFiscal(d);
  const [closeFy, setCloseFy] = useState(fiscal.fy - 1);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const sealed = await seal(session, { data: d, images: await exportImages(session) });
      download(`fujihashi-jvc-backup-${today()}.json`, JSON.stringify({ format: 'jvc-kaikei-backup', bv: 2, ...sealed }), 'application/json');
      toast('暗号化バックアップ（レシート画像を含む）を保存しました');
    } finally {
      setBusy(false);
    }
  };
  const importBackup = async (file: File) => {
    try {
      const sealed = JSON.parse(await file.text()) as Sealed & { format?: string; bv?: number };
      if (sealed.format !== 'jvc-kaikei-backup') throw new Error('バックアップファイルではありません');
      const pass = prompt('バックアップを作成したときのパスコード');
      if (!pass) return;
      const { data } = await unsealAny<unknown>(sealed, pass).catch(() => {
        throw new Error('パスコードが違います');
      });
      const payload = sealed.bv === 2 ? (data as { data: AppData; images: Record<string, { type: string; data: string }> }) : { data: data as AppData, images: {} };
      const next = migrate(payload.data);
      if (!confirm(`現在のデータを置き換えます（会計ページ${next.days.length}・取引${next.txs.length}件・家庭${next.households.length}）。よろしいですか？`)) return;
      setBusy(true);
      await importImages(session, payload.images); // 今のパスコードで暗号化し直す
      replaceAll(next);
      toast('復元しました');
    } catch (e) {
      toast({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  const changePass = async () => {
    if (normPass(pw.n1).length < 6) return toast({ text: '新しいパスコードは6文字以上にしてください', err: true });
    if (normPass(pw.n1) !== normPass(pw.n2)) return toast({ text: '確認用が一致しません', err: true });
    try {
      const sealed = await kvGet<Sealed>(VAULT_KEY);
      if (sealed) await unsealAny(sealed, pw.cur);
    } catch {
      return toast({ text: '現在のパスコードが違います', err: true });
    }
    setBusy(true);
    const next = await newSession(normPass(pw.n1));
    await reencryptImages(session, next);
    setSession(next);
    await kvDel(VAULT_PREV_KEY);
    setPw({ cur: '', n1: '', n2: '' });
    setBusy(false);
    toast('パスコードを変更しました');
  };
  const closeYear = () => {
    const r = fiscalRange(closeFy, s.fiscalStartMonth);
    if (!confirm(`${closeFy}年度（${r.from}〜${r.to}）を締めます。締めた期間の取引は修正・取り消しできなくなります。先に出納帳CSVとバックアップを保存します。`)) return;
    download(`出納帳_${closeFy}年度.csv`, ledgerCsv(d, r.from, r.to));
    exportBackup();
    set((x) => void (x.closedThrough = r.to > (x.closedThrough ?? '') ? r.to : x.closedThrough));
  };
  const wipe = async () => {
    if (!confirm('この端末の全データ（レシート画像を含む）を消去します。元に戻せません。バックアップは保存しましたか？')) return;
    if (prompt('消去する場合は「消去」と入力してください') !== '消去') return;
    await clearAll();
    location.hash = '';
    location.reload();
  };
  const unsure = (v: number | null) => (v === null ? 'needs' : '');

  return (
    <>
      <TopBar title="設定" back="/" right={<button className="btn small" onClick={lock}>🔒 ロック</button>} />
      <main>
        <Card title="基本">
          <div className="stack">
            <Field label="チーム名">
              <input type="text" value={s.teamName} onChange={(e) => set((x) => void (x.teamName = e.target.value))} />
            </Field>
            <Field label="会計係（出納帳の記録者名）">
              <input type="text" value={s.recorderName} onChange={(e) => set((x) => void (x.recorderName = e.target.value))} />
            </Field>
            <Field label="年度の開始月">
              <NumInput value={s.fiscalStartMonth} onChange={(n) => n >= 1 && n <= 12 && set((x) => void (x.fiscalStartMonth = n))} />
            </Field>
          </div>
        </Card>

        <Card title="遠征交通費">
          <div className="stack">
            <div className="row">
              <Field label="高速あり: 選手（円）">
                <NumInput value={s.fareHighwayPlayer} onChange={(n) => set((x) => void (x.fareHighwayPlayer = n))} />
              </Field>
              <Field label="高速あり: 帯同保護者（円）">
                <NumInput value={s.fareHighwayParent} onChange={(n) => set((x) => void (x.fareHighwayParent = n))} />
              </Field>
            </div>
            <div className="row">
              <Field label="運転手（円）">
                <NumInput value={s.fareDriver} onChange={(n) => set((x) => void (x.fareDriver = n))} />
              </Field>
              <Field label="高速なし: 全員（円）">
                <NumInput value={s.fareNoHighway} onChange={(n) => set((x) => void (x.fareNoHighway = n))} />
              </Field>
            </div>
            <Field label="基準車両に乗る指導者の名前（配車表から基準車両を見つけるのに使います）">
              <input type="text" value={s.referencePerson} onChange={(e) => set((x) => void (x.referencePerson = e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card title="当番準備金・月謝（未確認の値は空欄＝要確認）">
          <div className="stack">
            <Field label="当番準備金の初期値（円）">
              <div className={unsure(s.prepDefault)} style={{ borderRadius: 10 }}>
                <NumInput value={s.prepDefault ?? undefined} placeholder="要確認（毎回入力）" onChange={(n) => set((x) => void (x.prepDefault = n))} />
              </div>
            </Field>
            <Field label="月謝の初期値（円・新しい家庭に使う）">
              <div className={unsure(s.monthlyFeeDefault)} style={{ borderRadius: 10 }}>
                <NumInput value={s.monthlyFeeDefault ?? undefined} placeholder="要確認" onChange={(n) => set((x) => void (x.monthlyFeeDefault = n))} />
              </div>
            </Field>
            <div>
              <div className="muted" style={{ marginBottom: 4 }}>月謝の回収期限（要確認）</div>
              <Seg<DueRule>
                value={s.feeDueRule}
                onChange={(v) => set((x) => void (x.feeDueRule = v))}
                options={[
                  ['targetMonthEnd', '対象月の末日'],
                  ['distributionMonthEnd', '配布した月の末日'],
                ]}
              />
              <div className="muted" style={{ marginTop: 4 }}>例: 11月30日に12月分を配布 → 「対象月の末日」なら12/31、「配布した月の末日」なら11/30。作成済みの月謝袋は個別に変更できます。</div>
            </div>
          </div>
        </Card>

        <Card title="CSV出力">
          <div className="fab-row">
            <button className="btn small" onClick={() => download(`出納帳_${today()}.csv`, ledgerCsv(d, '0000-01-01', '9999-12-31'))}>出納帳</button>
            <button className="btn small" onClick={() => download(`月謝_${today()}.csv`, feesCsv(d))}>月謝</button>
            <button className="btn small" onClick={() => download(`交通費_${today()}.csv`, transportCsv(d))}>交通費</button>
            <button className="btn small" onClick={() => download(`経費_${today()}.csv`, expensesCsv(d))}>経費</button>
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
            <button className="btn" onClick={changePass} disabled={busy || !pw.cur || !pw.n1}>
              パスコードを変更
            </button>
          </div>
        </Card>

        <Card title="バックアップ・引き継ぎ">
          <div className="stack">
            <button className="btn primary" disabled={busy} onClick={exportBackup}>
              ⬇ 暗号化バックアップを保存
            </button>
            <label className="btn">
              ⬆ バックアップから復元
              <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
            </label>
            <div className="muted">データはこの端末のブラウザ内に保存されています。機種変更・ブラウザのデータ削除に備えて、月に1回程度バックアップを保存してください。次の会計係にはファイルとパスコードを別々の方法で渡します。</div>
          </div>
        </Card>

        <Card title="年度締め">
          <div className="stack">
            <div className="muted">締め済み: {s.closedThrough ?? 'なし'}（現在 {fiscal.fy}年度）。締めると出納帳CSVとバックアップを保存し、その年度の取引を修正・取り消しできなくします。</div>
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
            <button className="btn" onClick={() => confirm('現在のデータをサンプルデータに置き換えます。よろしいですか？') && (replaceAll(sampleData()), toast('サンプルデータを読み込みました'))}>
              サンプルデータに置き換える
            </button>
            <button className="btn danger" onClick={wipe}>
              この端末の全データを消去
            </button>
            <div className="muted">アプリの版: {__APP_VERSION__}</div>
          </div>
        </Card>
      </main>
    </>
  );
}
