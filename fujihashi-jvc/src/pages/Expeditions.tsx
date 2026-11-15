import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Amt, Card, Check, Field, Modal, NumInput, Seg, TopBar, go } from '../components/ui';
import { CarEditor } from '../components/CarEditor';
import { LineModal } from './Fees';
import { collectRider, confirmExpense, ensureExpenses, expeditionStats, EXPENSE_LABEL, isReimbursed, newExpedition, riderAmount, settleDueOf, settleExpense } from '../lib/expedition';
import { calcGas, describeCalc, gasInputFromSettings, type GasInput } from '../lib/gas';
import { fetchRoutes, type RouteOption } from '../lib/api';
import { voidTx } from '../lib/ledger';
import type { Car, Expedition, Expense, ExpenseType, GasMethod } from '../lib/types';
import { addDays, fmtDate, today, uid, yen } from '../lib/util';

export function Expeditions() {
  const { data: d, update } = useStore();
  const t = today();
  const list = [...d.expeditions].sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = list.filter((e) => e.date >= t).reverse();
  const past = list.filter((e) => e.date < t);
  const createBlank = () => {
    const e = newExpedition();
    if (update((x) => void x.expeditions.push(e))) go(`/exp/${e.id}`);
  };
  const item = (e: Expedition) => {
    const s = expeditionStats(e);
    return (
      <li key={e.id} onClick={() => go(`/exp/${e.id}`)} style={{ cursor: 'pointer' }}>
        <div className="main">
          <div className="title">
            {fmtDate(e.date)} {e.title}
          </div>
          <div className="meta">
            {e.destination} 車{e.cars.length}台・{s.totalPeople}名{' '}
            {s.unpaid.length > 0 && <span className="chip warn">未集金{s.unpaid.length}</span>}{' '}
            {s.unsettled.length > 0 && <span className="chip warn">未精算{s.unsettled.length}</span>}
            {s.unpaid.length === 0 && s.unsettled.length === 0 && <span className="chip ok">完了</span>}
          </div>
        </div>
        <span className="muted">›</span>
      </li>
    );
  };
  return (
    <>
      <TopBar title="遠征・交通費" />
      <main>
        <div className="fab-row">
          <a className="btn primary" href="#/exp/import">
            💬 LINE車割りから作成
          </a>
          <button className="btn" onClick={createBlank}>
            ＋ 手動で作成
          </button>
        </div>
        <Card title="これからの遠征">{upcoming.length ? <ul className="list">{upcoming.map(item)}</ul> : <div className="empty">予定はありません</div>}</Card>
        <Card title="終了した遠征">{past.length ? <ul className="list">{past.map(item)}</ul> : <div className="empty">なし</div>}</Card>
      </main>
    </>
  );
}

export function ExpeditionDetail(props: { id: string }) {
  const { data: d, update, toast } = useStore();
  const e = d.expeditions.find((x) => x.id === props.id);
  const [editInfo, setEditInfo] = useState(false);
  const [editCars, setEditCars] = useState<Car[] | null>(null);
  const [gasFor, setGasFor] = useState<Expense | null>(null);
  const [lineOpen, setLineOpen] = useState(false);
  if (!e) return <TopBar title="遠征が見つかりません" back="/exp" />;
  const s = expeditionStats(e);
  const t = today();
  const mut = (fn: (x: Expedition) => void, msg?: string) =>
    update((x) => {
      const ex = x.expeditions.find((y) => y.id === e.id)!;
      fn(ex);
      ensureExpenses(ex);
    }, msg);

  const collect = (riderId: string, name: string) => {
    let txId = '';
    update(
      (x) => {
        txId = collectRider(x, e.id, riderId).id;
      },
      () => ({ text: `${name} から受け取りました`, undo: () => update((x) => voidTx(x, txId, '入力直後の取り消し'), '取り消しました') }),
    );
  };

  const remove = () => {
    const linked = d.txs.some((tx) => !tx.voided && tx.related?.kind === 'expedition' && tx.related.id === e.id);
    if (linked) return toast({ text: '入金・精算の記録がある遠征は削除できません（出納帳で取り消してから削除）', err: true });
    if (!confirm(`「${e.title}」を削除しますか？`)) return;
    if (update((x) => void (x.expeditions = x.expeditions.filter((y) => y.id !== e.id)), '削除しました')) go('/exp');
  };

  const expenses = e.expenses.filter((x) => isReimbursed(e, x.type));
  return (
    <>
      <TopBar title={`${fmtDate(e.date)} ${e.title}`} back="/exp" right={<button className="btn small" onClick={() => setEditInfo(true)}>編集</button>} />
      <main>
        <Card>
          <div className="stack">
            <div>
              📍 {e.destination || '（行き先未設定）'} {e.origin && <span className="muted">出発: {e.origin}</span>}
            </div>
            <div className="row">
              <span className="chip info">{e.rule.collectTransport ? `交通費 一人${yen(e.perPerson)}を事前集金` : '事前集金なし'}</span>
              {(['gas', 'toll', 'parking', 'other'] as ExpenseType[]).filter((k) => isReimbursed(e, k)).map((k) => (
                <span className="chip" key={k}>
                  {EXPENSE_LABEL[k]}精算
                </span>
              ))}
            </div>
            {e.rule.note && <div className="muted">📝 {e.rule.note}</div>}
          </div>
        </Card>

        <div className="grid2">
          <div className="card stat">
            <div className="label">集金 {s.targets.length - s.unpaid.length}/{s.targets.length}名</div>
            <div className="val in">{yen(s.collected)}</div>
            <div className="muted">予定 {yen(s.expected)}</div>
          </div>
          <div className="card stat">
            <div className="label">精算 {expenses.length - s.unsettled.length}/{expenses.length}件</div>
            <div className="val out">{yen(s.expensePaid)}</div>
            <div className="muted">確定 {yen(s.expenseConfirmed)}</div>
          </div>
        </div>

        <Card
          title={e.rule.collectTransport ? `🚗 乗車メンバーと集金（期限 ${fmtDate(e.collectDue)}）` : '🚗 乗車メンバー'}
          right={
            <button className="btn small" onClick={() => setEditCars(structuredClone(e.cars))}>
              メンバー編集
            </button>
          }
        >
          {e.cars.length === 0 && <div className="empty">車が登録されていません。「メンバー編集」から追加してください。</div>}
          {e.cars.map((car) => (
            <div key={car.id} style={{ marginBottom: 8 }}>
              <h3>
                {car.name}（運転: {car.driver || '未設定'}）
              </h3>
              <ul className="list">
                {car.riders.map((r) => (
                  <li key={r.id}>
                    <div className="main">
                      <div className="title">
                        {r.name} {r.isDriver && <span className="chip info">運転手</span>} {r.kind === 'sibling' && <span className="chip">兄弟姉妹</span>} {r.kind === 'adult' && !r.isDriver && <span className="chip">大人</span>}
                      </div>
                      <div className="meta">{r.collect ? `集金対象 ${yen(riderAmount(e, r))}` : r.isDriver ? '集金免除' : '集金対象外'}</div>
                    </div>
                    {e.rule.collectTransport && r.collect && (
                      r.txId ? (
                        <button className="pay done" disabled>
                          ✓済
                        </button>
                      ) : (
                        <button className="pay" onClick={() => collect(r.id, r.name)}>
                          受取
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {e.rule.collectTransport && s.unpaid.length > 0 && (
            <button className="btn line block" onClick={() => setLineOpen(true)}>
              💬 未集金者へのLINEメッセージ
            </button>
          )}
        </Card>

        <Card
          title="⛽ 活動後の精算"
          right={
            <button
              className="btn small"
              onClick={() =>
                mut((x) => void x.expenses.push({ id: uid('ex_'), type: 'parking', payee: x.cars[0]?.driver ?? '', label: '駐車場代', confirmed: false }))
              }
            >
              ＋項目
            </button>
          }
        >
          {e.date > t && <div className="alert info" style={{ marginBottom: 8 }}>精算は活動後（{fmtDate(e.date)}以降）に行います。見積もりは今から計算できます。</div>}
          {expenses.length === 0 && <div className="empty">精算項目はありません（ルールで精算対象を選べます）</div>}
          <ul className="list">
            {expenses.map((x) => (
              <ExpenseRow key={x.id} e={e} x={x} onGas={() => setGasFor(x)} />
            ))}
          </ul>
          {s.unsettled.length > 0 && e.date <= t && <div className="muted">精算期限: {fmtDate(settleDueOf(d, e))}</div>}
        </Card>

        <Card title="収支（この遠征）">
          <table className="tbl">
            <tbody>
              <tr>
                <td>交通費 集金済み</td>
                <td>{yen(s.collected)}</td>
              </tr>
              <tr>
                <td>精算済み</td>
                <td>−{yen(s.expensePaid)}</td>
              </tr>
              <tr>
                <th>差額</th>
                <th>{yen(s.collected - s.expensePaid)}</th>
              </tr>
            </tbody>
          </table>
        </Card>
        <button className="btn danger" onClick={remove}>
          この遠征を削除
        </button>
      </main>

      {editInfo && <InfoModal e={e} onClose={() => setEditInfo(false)} onSave={(p) => mut((x) => Object.assign(x, p), '保存しました') && setEditInfo(false)} />}
      {editCars && (
        <Modal title="乗車メンバー編集" onClose={() => setEditCars(null)}>
          <CarEditor cars={editCars} onChange={setEditCars} memberName={(id) => d.members.find((m) => m.id === id)?.name} />
          <button
            className="btn primary block"
            onClick={() => {
              if (editCars.some((c) => c.riders.some((r) => !r.name.trim()))) return toast({ text: '名前が空のメンバーがいます', err: true });
              if (mut((x) => void (x.cars = editCars), '保存しました')) setEditCars(null);
            }}
          >
            保存
          </button>
        </Modal>
      )}
      {gasFor && <GasModal e={e} x={gasFor} onClose={() => setGasFor(null)} />}
      {lineOpen && (
        <LineModal
          month=""
          content={`${e.title}（${fmtDate(e.date)}）交通費`}
          names={s.unpaid.map((u) => u.rider.name)}
          amount={e.perPerson}
          due={e.collectDue}
          onClose={() => setLineOpen(false)}
        />
      )}
    </>
  );
}

function ExpenseRow(props: { e: Expedition; x: Expense; onGas: () => void }) {
  const { update } = useStore();
  const { e, x } = props;
  const [amt, setAmt] = useState<number | undefined>(x.amount ?? x.estimate);
  const setX = (fn: (ex: Expense) => void, msg?: string) =>
    update((dd) => {
      const ee = dd.expeditions.find((y) => y.id === e.id)!;
      fn(ee.expenses.find((y) => y.id === x.id)!);
    }, msg);
  const settle = () => {
    let txId = '';
    update(
      (dd) => {
        txId = settleExpense(dd, e.id, x.id).id;
      },
      () => ({ text: `${x.payee} へ ${yen(x.amount)} 精算しました`, undo: () => update((dd) => voidTx(dd, txId, '入力直後の取り消し'), '取り消しました') }),
    );
  };
  return (
    <li style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="row">
        <div className="main">
          <div className="title">
            {x.label} {x.txId ? <span className="chip ok">精算済</span> : x.confirmed ? <span className="chip info">確定</span> : <span className="chip warn">未確定</span>}
          </div>
          <div className="meta">
            精算相手: {x.payee || '未設定'}
            {x.estimate !== undefined && ` ・見積 ${yen(x.estimate)}`}
          </div>
          {x.calc && <div className="meta">計算: {describeCalc(x.calc)}</div>}
        </div>
        {x.amount !== undefined && x.confirmed && <Amt v={x.amount} />}
      </div>
      {!x.txId && (
        <div className="row" style={{ marginTop: 6 }}>
          {x.type === 'gas' && (
            <button className="btn small" onClick={props.onGas}>
              🧮 ガソリン代計算
            </button>
          )}
          {!x.confirmed ? (
            <>
              <div style={{ width: 110 }}>
                <NumInput value={amt} onChange={setAmt} placeholder={x.type === 'toll' ? '申告額' : '金額'} />
              </div>
              <button className="btn small primary" disabled={amt === undefined} onClick={() => setX((ex) => confirmExpense(e, ex, amt ?? 0), '精算額を確定しました')}>
                金額確定
              </button>
            </>
          ) : (
            <>
              <button className="btn small" onClick={() => setX((ex) => void (ex.confirmed = false))}>
                確定解除
              </button>
              <button className="btn small ok" onClick={settle}>
                💴 現金を渡した
              </button>
            </>
          )}
          <input type="text" value={x.payee} onChange={(ev) => setX((ex) => void (ex.payee = ev.target.value))} placeholder="精算相手" style={{ flex: 1, minWidth: 90, minHeight: 36, padding: '4px 8px' }} aria-label="精算相手" />
          {!x.carId && (
            <button className="icon-btn" aria-label="削除" onClick={() => update((dd) => void (dd.expeditions.find((y) => y.id === e.id)!.expenses = dd.expeditions.find((y) => y.id === e.id)!.expenses.filter((y) => y.id !== x.id)))}>
              🗑
            </button>
          )}
        </div>
      )}
      {!x.txId && !x.carId && (
        <div className="row" style={{ marginTop: 6 }}>
          <select value={x.type} onChange={(ev) => setX((ex) => void (ex.type = ev.target.value as ExpenseType))} style={{ width: 'auto' }}>
            {(['parking', 'other', 'toll', 'gas'] as ExpenseType[]).map((k) => (
              <option key={k} value={k}>
                {EXPENSE_LABEL[k]}
              </option>
            ))}
          </select>
          <input type="text" value={x.label} onChange={(ev) => setX((ex) => void (ex.label = ev.target.value))} style={{ flex: 1 }} aria-label="内容" />
        </div>
      )}
    </li>
  );
}

function InfoModal(props: { e: Expedition; onClose: () => void; onSave: (p: Partial<Expedition>) => void }) {
  const [p, setP] = useState({ title: props.e.title, date: props.e.date, destination: props.e.destination, origin: props.e.origin ?? '', collectDue: props.e.collectDue, perPerson: props.e.perPerson, rule: { ...props.e.rule } });
  const r = p.rule;
  const setR = (x: Partial<typeof r>) => setP({ ...p, rule: { ...r, ...x } });
  return (
    <Modal title="遠征の設定" onClose={props.onClose}>
      <Field label="名称">
        <input type="text" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="遠征日">
          <input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value, collectDue: p.collectDue > e.target.value ? addDays(e.target.value, -1) : p.collectDue })} />
        </Field>
        <Field label="集金期限（活動前）">
          <input type="date" value={p.collectDue} onChange={(e) => setP({ ...p, collectDue: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Field label="出発地">
          <input type="text" value={p.origin} onChange={(e) => setP({ ...p, origin: e.target.value })} placeholder="例: 藤橋小学校" />
        </Field>
        <Field label="行き先">
          <input type="text" value={p.destination} onChange={(e) => setP({ ...p, destination: e.target.value })} />
        </Field>
      </div>
      <Card title="集金・精算ルール">
        <Check checked={r.collectTransport} onChange={(b) => setR({ collectTransport: b })} label="交通費を活動前に集金する" />
        {r.collectTransport && (
          <Field label="一人あたりの集金額（円）">
            <NumInput value={p.perPerson} onChange={(n) => setP({ ...p, perPerson: n })} />
          </Field>
        )}
        <Check checked={r.reimburseGas} onChange={(b) => setR({ reimburseGas: b })} label="ガソリン代を精算する" />
        <Check checked={r.reimburseToll} onChange={(b) => setR({ reimburseToll: b })} label="高速代を精算する" />
        <Check checked={r.reimburseParking} onChange={(b) => setR({ reimburseParking: b })} label="駐車場代を精算する" />
        <Check checked={r.reimburseOther} onChange={(b) => setR({ reimburseOther: b })} label="その他経費を精算する" />
        <Field label="メモ（例: 高速代とガソリン代のみ）">
          <input type="text" value={r.note ?? ''} onChange={(e) => setR({ note: e.target.value })} />
        </Field>
      </Card>
      <button className="btn primary block" onClick={() => props.onSave(p)}>
        保存
      </button>
    </Modal>
  );
}

function GasModal(props: { e: Expedition; x: Expense; onClose: () => void }) {
  const { data: d, update, toast } = useStore();
  const [origin, setOrigin] = useState(props.e.origin ?? '');
  const [dest, setDest] = useState(props.e.destination);
  const [via, setVia] = useState((props.e.waypoints ?? []).join('\n'));
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [inp, setInp] = useState<GasInput>(() => (props.x.calc ? { ...gasInputFromSettings(d.settings, props.x.calc.distanceKm), roundTrip: props.x.calc.roundTrip } : gasInputFromSettings(d.settings, 0)));
  const [tollEst, setTollEst] = useState<number | undefined>();
  let result: ReturnType<typeof calcGas> | null = null;
  try {
    result = inp.distanceKm > 0 ? calcGas(inp) : null;
  } catch {
    result = null;
  }
  const search = async () => {
    setBusy(true);
    try {
      const r = await fetchRoutes(d.settings.apiToken, origin, dest, via.split('\n'));
      setRoutes(r.routes);
      if (r.routes[0]) pick(r.routes[0]);
    } catch (err) {
      toast({ text: errorText(err), err: true });
    } finally {
      setBusy(false);
    }
  };
  const pick = (r: RouteOption) => {
    setInp((i) => ({ ...i, distanceKm: r.distanceKm, routeSummary: `${r.summary} ${r.distanceKm}km` }));
    setTollEst(r.tollYen);
  };
  const apply = () => {
    if (!result) return;
    const snap = result;
    const ok = update((dd) => {
      const ee = dd.expeditions.find((y) => y.id === props.e.id)!;
      ee.origin = origin;
      ee.destination = dest;
      ee.waypoints = via.split('\n').map((s) => s.trim()).filter(Boolean);
      const ex = ee.expenses.find((y) => y.id === props.x.id)!;
      ex.estimate = snap.result;
      ex.calc = snap; // 当時の単価・燃費を保存（後で設定を変えても変わらない）
      if (tollEst !== undefined) {
        const toll = ee.expenses.find((y) => y.type === 'toll' && y.carId === ex.carId && !y.confirmed);
        if (toll) toll.estimate = tollEst * (inp.roundTrip ? 2 : 1);
      }
    }, '見積額を設定しました。確認して「金額確定」してください');
    if (ok) props.onClose();
  };
  return (
    <Modal title={`ガソリン代の計算（${props.x.label}）`} onClose={props.onClose}>
      <Card title="ルート（Google Maps）">
        <div className="stack">
          <Field label="出発地">
            <input type="text" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="住所・施設名" />
          </Field>
          <Field label="経由地（1行に1か所・任意）">
            <textarea value={via} onChange={(e) => setVia(e.target.value)} style={{ minHeight: 60 }} />
          </Field>
          <Field label="目的地">
            <input type="text" value={dest} onChange={(e) => setDest(e.target.value)} />
          </Field>
          <button className="btn" disabled={busy || !origin || !dest} onClick={search}>
            {busy ? '検索中…' : '🗺 ルートを検索'}
          </button>
          {routes.map((r, i) => (
            <label className="check" key={i}>
              <input type="radio" name="route" checked={inp.distanceKm === r.distanceKm} onChange={() => pick(r)} />
              <span>
                {r.summary}: <b>{r.distanceKm}km</b>（約{r.durationMin}分）{r.tollYen !== undefined && ` 高速 約${yen(r.tollYen)}`}
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card title="計算">
        <div className="stack">
          <Field label="走行距離（片道 km）※手入力も可">
            <NumInput value={inp.distanceKm || undefined} step={0.1} onChange={(n) => setInp({ ...inp, distanceKm: n })} />
          </Field>
          <Seg value={inp.roundTrip ? 'rt' : 'ow'} onChange={(v) => setInp({ ...inp, roundTrip: v === 'rt' })} options={[['rt', '往復'], ['ow', '片道']]} />
          <Seg<GasMethod> value={inp.method} onChange={(v) => setInp({ ...inp, method: v })} options={[['perKm', 'A: 距離×単価'], ['fuel', 'B: 燃費×ガソリン価格']]} />
          {inp.method === 'perKm' ? (
            <Field label="1kmあたり（円/km）">
              <NumInput value={inp.yenPerKm} step={0.1} onChange={(n) => setInp({ ...inp, yenPerKm: n })} />
            </Field>
          ) : (
            <div className="row">
              <Field label="燃費（km/L）">
                <NumInput value={inp.kmPerL} step={0.1} onChange={(n) => setInp({ ...inp, kmPerL: n })} />
              </Field>
              <Field label="ガソリン価格（円/L）">
                <NumInput value={inp.yenPerL} onChange={(n) => setInp({ ...inp, yenPerL: n })} />
              </Field>
            </div>
          )}
          {result && <div className="alert info">見積額: {describeCalc(result)}</div>}
          {tollEst !== undefined && <div className="muted">高速料金の概算（片道）: {yen(tollEst)} → 高速代の見積にも反映します。実際の金額は遠征後の申告額で確定してください。</div>}
        </div>
      </Card>
      <button className="btn primary block" disabled={!result} onClick={apply}>
        見積額として設定
      </button>
      <p className="muted">計算結果は見積額です。会計係が確認して「金額確定」したときの金額が精算額になります。</p>
    </Modal>
  );
}
