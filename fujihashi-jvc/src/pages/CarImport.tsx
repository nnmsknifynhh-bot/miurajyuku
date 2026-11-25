import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Card, Seg, TopBar, go } from '../components/ui';
import { parseCarSplit } from '../lib/carParser';
import { carsFromParsed, duplicateIssues, ROLE_LABEL, syncDriverPayments } from '../lib/day';
import { aiCarSplit } from '../lib/api';
import { shrinkImage } from '../lib/image';
import { rosterPeople } from '../lib/roster';
import { sampleCarText } from '../lib/sample';
import { compact } from '../lib/carParser';
import type { Car, Role } from '../lib/types';
import { fmtDate, today, uid } from '../lib/util';

export function CarImport(props: { dayId: string }) {
  const { data: d, update, toast } = useStore();
  const day = d.days.find((x) => x.id === props.dayId);
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [cars, setCars] = useState<Car[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [refCarId, setRefCarId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!day) return <TopBar title="会計ページが見つかりません" back="/days" />;
  const people = rosterPeople(d);

  const load = (r: Parameters<typeof carsFromParsed>[0], extra: string[] = []) => {
    const res = carsFromParsed(r, people, d.settings.referencePerson);
    if (r.date && r.date !== day.date) extra.push(`配車表の日付（${fmtDate(r.date)}）がこのページ（${fmtDate(day.date)}）と違います`);
    setCars(res.cars);
    setIssues([...extra, ...res.issues]);
    setRefCarId(res.refCarId);
  };
  const ai = async () => {
    setBusy(true);
    try {
      const input = mode === 'image' && file ? { file: await shrinkImage(file, 1800).then((x) => ({ mediaType: x.type, data: x.base64 })) } : { text };
      const r = await aiCarSplit(d.settings.apiToken, input, people.map((p) => p.name), day.date);
      load({ ...r, date: r.date || undefined }, r.review.map((x) => `AI: ${x}`));
    } catch (e) {
      toast({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };

  const setRider = (ci: number, rid: string, p: Partial<Car['riders'][number]>) => setCars(cars!.map((c, i) => (i === ci ? { ...c, riders: c.riders.map((r) => (r.id === rid ? { ...r, ...p } : r)) } : c)));
  const dup = cars ? duplicateIssues(cars) : [];

  const save = () => {
    if (dup.length) return toast({ text: '重複している人を削除してください', err: true });
    if (cars!.some((c) => c.riders.some((r) => !r.name.trim()))) return toast({ text: '名前が空の人がいます', err: true });
    const ok = update((x) => {
      const dd = x.days.find((y) => y.id === day.id)!;
      // 集金済みの記録は引き継ぐ（同じ名前の人へ）。見つからない人は「以前の記録」に残す
      const paid = dd.cars.flatMap((c) => c.riders.filter((r) => r.txId || r.amountOverride !== undefined));
      const next = structuredClone(cars!);
      const leftover = paid.filter((p) => {
        const hit = next.flatMap((c) => c.riders).find((r) => compact(r.name) === compact(p.name) && !r.txId);
        if (hit) {
          hit.txId = p.txId;
          if (p.amountOverride !== undefined) hit.amountOverride = p.amountOverride;
          return false;
        }
        return !!p.txId;
      });
      if (leftover.length) next.push({ id: uid('car_'), name: '以前の記録（配車から外れた人）', riders: leftover });
      dd.cars = next;
      if (refCarId) dd.driverPay.refCarId = refCarId;
      else if (dd.driverPay.refCarId && !next.some((c) => c.id === dd.driverPay.refCarId)) dd.driverPay.refCarId = undefined;
      dd.carSource = mode === 'text' ? text : '（スクリーンショット）';
      for (const m of issues.filter((m) => !m.startsWith('重複'))) if (!dd.review.includes(m)) dd.review.push(m);
      dd.history.push({ at: new Date().toISOString(), text: `配車表を取り込み（${next.length}台）` });
      syncDriverPayments(dd);
    }, '配車を登録しました');
    if (ok) go(`/day/${day.id}`);
  };

  return (
    <>
      <TopBar title={`配車表の取り込み ${fmtDate(day.date)}`} back={`/day/${day.id}`} />
      <main>
        {!cars ? (
          <>
            <Seg value={mode} onChange={setMode} options={[['text', 'LINEの文章'], ['image', 'スクリーンショット']]} />
            {mode === 'text' ? (
              <Card title="LINEの配車の文章を貼り付け">
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'🚗三浦車（運転：三浦母）\n・三浦 ゆい\n・田中 はな、田中母'} />
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setText(sampleCarText(today()))}>
                  サンプル文章を入れる
                </button>
              </Card>
            ) : (
              <Card title="LINEのスクリーンショットを選ぶ">
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <p className="muted">スクリーンショットはAIで読み取ります（サーバー設定が必要）。</p>
              </Card>
            )}
            <div className="fab-row">
              {mode === 'text' && (
                <button className="btn primary" disabled={!text.trim()} onClick={() => load(parseCarSplit(text, day.date))}>
                  読み取る（端末内・無料）
                </button>
              )}
              <button className="btn" disabled={busy || (mode === 'text' ? !text.trim() : !file)} onClick={ai}>
                {busy ? 'AI読み取り中…' : '🤖 AIで読み取る'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="alert info">分類と名前を確認してください。保存後も会計ページで編集できます。</div>
            {[...issues.filter((m) => !m.startsWith('重複')), ...dup].map((m) => (
              <div key={m} className={`alert ${m.startsWith('重複') ? 'bad' : 'warn'}`}>
                ⚠️ {m}
              </div>
            ))}
            {cars.map((car, ci) => (
              <div className="car" key={car.id}>
                <div className="car-head">
                  <input type="text" value={car.name} style={{ flex: 1, fontWeight: 700 }} onChange={(e) => setCars(cars.map((c, i) => (i === ci ? { ...c, name: e.target.value } : c)))} />
                  <label className="check" style={{ fontSize: 13 }}>
                    <input type="radio" name="ref" checked={refCarId === car.id} onChange={() => setRefCarId(car.id)} /> 基準車両
                  </label>
                </div>
                {car.riders.map((r) => (
                  <div className="rider" key={r.id}>
                    <input type="text" className="nm" value={r.name} onChange={(e) => setRider(ci, r.id, { name: e.target.value, childId: undefined })} />
                    <select value={r.role} className={r.role === 'other' ? 'needs' : ''} style={{ width: 'auto', minHeight: 38, padding: '4px 6px' }} onChange={(e) => setRider(ci, r.id, { role: e.target.value as Role })}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((k) => (
                        <option key={k} value={k}>
                          {ROLE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    {r.childId && <span className="chip ok">名簿</span>}
                    <button className="icon-btn" aria-label="削除" onClick={() => setCars(cars.map((c, i) => (i === ci ? { ...c, riders: c.riders.filter((x) => x.id !== r.id) } : c)))}>
                      🗑
                    </button>
                  </div>
                ))}
                <button className="btn small" style={{ marginTop: 6 }} onClick={() => setCars(cars.map((c, i) => (i === ci ? { ...c, riders: [...c.riders, { id: uid('r_'), name: '', role: 'player' }] } : c)))}>
                  ＋ メンバー
                </button>
              </div>
            ))}
            {day.cars.length > 0 && <div className="alert warn">⚠️ 登録済みの配車を置き換えます。集金済みの記録は同じ名前の人に引き継ぎ、見つからない人は「以前の記録」として残します。</div>}
            <div className="fab-row">
              <button className="btn" onClick={() => setCars(null)}>← 戻る</button>
              <button className="btn primary" onClick={save}>
                この内容で登録
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
