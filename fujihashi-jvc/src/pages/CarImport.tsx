import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Card, Field, NumInput, TopBar, go } from '../components/ui';
import { CarEditor } from '../components/CarEditor';
import { buildDraft, parseCarSplit, type CarDraft } from '../lib/carParser';
import { aiCarSplit } from '../lib/api';
import { ensureExpenses, newExpedition } from '../lib/expedition';
import { SAMPLE_CAR_TEXT } from '../lib/sample';
import type { Car } from '../lib/types';
import { addDays, today } from '../lib/util';

export function CarImport() {
  const { data: d, update, toast } = useStore();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<CarDraft | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [meta, setMeta] = useState({ date: '', title: '', destination: '', perPerson: 1000 });
  const [busy, setBusy] = useState(false);

  const load = (dr: CarDraft) => {
    setDraft(dr);
    setCars(dr.cars.map(({ issues: _i, ...c }) => c));
    setMeta({ date: dr.date ?? '', title: dr.title || '遠征', destination: dr.destination ?? '', perPerson: meta.perPerson });
  };
  const local = () => load(buildDraft(parseCarSplit(text), d.members));
  const ai = async () => {
    setBusy(true);
    try {
      const r = await aiCarSplit(d.settings.apiToken, text, d.members.map((m) => m.name), today());
      load(buildDraft({ ...r, date: r.date || undefined }, d.members));
      toast('AIで読み取りました。内容を確認してください');
    } catch (e) {
      toast({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!meta.date) return toast({ text: '遠征日を入力してください', err: true });
    const empty = cars.flatMap((c) => c.riders).filter((r) => !r.name.trim());
    if (empty.length) return toast({ text: '名前が空のメンバーがいます', err: true });
    const e = newExpedition(meta.date);
    Object.assign(e, { title: meta.title || '遠征', destination: meta.destination, perPerson: meta.perPerson, collectDue: addDays(meta.date, -1), cars, sourceText: text });
    ensureExpenses(e);
    if (update((x) => void x.expeditions.push(e), '遠征を作成しました')) go(`/exp/${e.id}`);
  };

  const issuesByCar = Object.fromEntries((draft?.cars ?? []).map((c) => [c.id, c.issues]));

  return (
    <>
      <TopBar title="LINE車割りの取り込み" back="/exp" />
      <main>
        {!draft ? (
          <>
            <Card title="① LINEの車割りを貼り付け">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'例）\n11/23(日) 練習試合 車割り\n🚗三浦車（運転：三浦父）\n・三浦 ゆい\n・田中 はな、田中母'} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => setText(SAMPLE_CAR_TEXT)}>
                  サンプル文章を入れる
                </button>
              </div>
            </Card>
            <div className="fab-row">
              <button className="btn primary" disabled={!text.trim()} onClick={local}>
                読み取る（端末内）
              </button>
              <button className="btn" disabled={!text.trim() || busy} onClick={ai}>
                {busy ? 'AI解析中…' : '🤖 AIで読み取る'}
              </button>
            </div>
            <p className="muted">「端末内」は文章をどこにも送信せず解析します。書式が崩れていて読み取れない場合は「AIで読み取る」を使ってください（サーバー設定が必要・有料API）。どちらの場合も確認画面で内容を確認してから登録します。</p>
          </>
        ) : (
          <>
            <Card title="② 読み取り結果を確認">
              {draft.issues.length > 0 ? (
                <div className="stack">
                  {draft.issues.filter((i) => !i.message.includes(': ')).map((i) => (
                    <div key={i.message} className="alert warn">
                      ⚠️ {i.message}
                    </div>
                  ))}
                  <div className="muted">⚠️ の項目を確認・修正してから登録してください。</div>
                </div>
              ) : (
                <div className="alert info">✅ 名簿と照合できました。内容を確認してください。</div>
              )}
              <div className="stack" style={{ marginTop: 10 }}>
                <div className="row">
                  <Field label="遠征日">
                    <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
                  </Field>
                  <Field label="一人あたり集金額（円）">
                    <NumInput value={meta.perPerson} onChange={(n) => setMeta({ ...meta, perPerson: n })} />
                  </Field>
                </div>
                <div className="row">
                  <Field label="名称">
                    <input type="text" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
                  </Field>
                  <Field label="行き先">
                    <input type="text" value={meta.destination} onChange={(e) => setMeta({ ...meta, destination: e.target.value })} />
                  </Field>
                </div>
              </div>
            </Card>
            <CarEditor cars={cars} onChange={setCars} issues={issuesByCar} memberName={(id) => d.members.find((m) => m.id === id)?.name} />
            <div className="fab-row">
              <button className="btn" onClick={() => setDraft(null)}>
                ← 文章に戻る
              </button>
              <button className="btn primary" onClick={save}>
                この内容で遠征を作成
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
