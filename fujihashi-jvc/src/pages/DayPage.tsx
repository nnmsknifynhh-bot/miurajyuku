import { useStore } from '../store';
import { Amt, Card, Field, NumInput, Review, Seg, TopBar, go, useRecordDate } from '../components/ui';
import { collectFare, dayTitle, defaultFare, driverBase, duplicateIssues, fareStats, handPrep, payDriver, riderFare, ROLE_LABEL, syncDriverPayments } from '../lib/day';
import { CATEGORY, prepGroups, settlePrep } from '../lib/expense';
import { voidTx } from '../lib/ledger';
import { dayLabel } from '../lib/holidays';
import type { AppData, DayPage as Day, Role } from '../lib/types';
import { fmtDate, uid, yen } from '../lib/util';

export function DayPage(props: { id: string }) {
  const { data: d, update, toast } = useStore();
  const [date, , dateBar] = useRecordDate();
  const day = d.days.find((x) => x.id === props.id);
  if (!day) return <TopBar title="会計ページが見つかりません" back="/days" />;
  const s = d.settings;
  const mut = (fn: (x: Day, all: AppData) => void, msg?: string) =>
    update((x) => {
      const dd = x.days.find((y) => y.id === day.id)!;
      fn(dd, x);
      syncDriverPayments(dd);
    }, msg);
  const withUndo = (label: string, run: (x: AppData) => string) => {
    let txId = '';
    update(
      (x) => {
        txId = run(x);
      },
      () => ({ text: label, undo: () => update((x) => voidTx(x, txId, '入力直後の取り消し'), '取り消しました') }),
    );
  };
  const st = fareStats(s, day);
  const base = driverBase(day);
  const dup = duplicateIssues(day.cars);
  const exps = d.expenses.filter((e) => e.dayId === day.id);
  const groups = prepGroups(d).filter((g) => g.dayId === day.id);
  const linkedTx = d.txs.some((t) => !t.voided && t.related?.kind === 'day' && t.related.id === day.id);

  return (
    <>
      <TopBar title={`${fmtDate(day.date)} ${dayLabel(day.date)}`} back="/days" />
      <main>
        {dateBar}
        <Review items={day.review} onClear={(i) => mut((x) => void x.review.splice(i, 1))} />

        <Card title="🏐 活動" right={<button className="btn small" onClick={() => mut((x) => void x.activities.push({ id: uid('a_'), name: '', venue: '' }))}>＋活動</button>}>
          <div className="stack">
            <Field label="日付">
              <input type="date" value={day.date} onChange={(e) => e.target.value && mut((x) => void (x.date = e.target.value))} />
            </Field>
            {day.activities.length === 0 && <div className="muted">活動が未登録です</div>}
            {day.activities.map((a) => (
              <div className="row" key={a.id}>
                <Field label="活動名">
                  <input type="text" value={a.name} className={!a.name || a.name.includes('要確認') ? 'needs' : ''} onChange={(e) => mut((x) => void (x.activities.find((y) => y.id === a.id)!.name = e.target.value))} />
                </Field>
                <Field label="会場">
                  <input type="text" value={a.venue} className={a.venue.includes('要確認') ? 'needs' : ''} onChange={(e) => mut((x) => void (x.activities.find((y) => y.id === a.id)!.venue = e.target.value))} />
                </Field>
                <button className="icon-btn" aria-label="活動を削除" style={{ alignSelf: 'flex-end' }} onClick={() => confirm(`「${a.name}」を削除しますか？`) && mut((x) => void (x.activities = x.activities.filter((y) => y.id !== a.id)))}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card title="🙋 当番と準備金（飲み物・弁当代）" right={<button className="btn small" onClick={() => mut((x) => void x.duties.push({ id: uid('du_'), name: '', amount: s.prepDefault }))}>＋当番</button>}>
          {day.duties.length === 0 && <div className="empty">当番は未登録です</div>}
          <ul className="list">
            {day.duties.map((du) => (
              <li key={du.id} style={{ flexWrap: 'wrap', opacity: du.cancelled ? 0.55 : 1 }}>
                <input type="text" value={du.name} placeholder="当番氏名" className={!du.name || du.name.includes('要確認') ? 'needs' : ''} style={{ flex: 1, minWidth: 110 }} disabled={!!du.handedTxId} onChange={(e) => mut((x) => void (x.duties.find((y) => y.id === du.id)!.name = e.target.value))} />
                <div style={{ width: 110 }}>
                  {du.handedTxId ? (
                    <Amt v={d.txs.find((t) => t.id === du.handedTxId)?.amount ?? 0} />
                  ) : (
                    <div className={du.amount === null ? 'needs' : ''} style={{ borderRadius: 10 }}>
                      <NumInput value={du.amount ?? undefined} placeholder="要確認" onChange={(n) => mut((x) => void (x.duties.find((y) => y.id === du.id)!.amount = n))} />
                    </div>
                  )}
                </div>
                {du.cancelled ? (
                  <button className="btn small" onClick={() => mut((x) => void (x.duties.find((y) => y.id === du.id)!.cancelled = false))}>
                    取消を戻す
                  </button>
                ) : du.handedTxId ? (
                  <span className="chip ok">渡し済 {fmtDate(d.txs.find((t) => t.id === du.handedTxId)?.date)}</span>
                ) : (
                  <>
                    <button className="pay" onClick={() => withUndo(`${du.name} に準備金を渡しました`, (x) => handPrep(x, day.id, du.id, date).id)}>
                      渡した
                    </button>
                    <button className="btn small" onClick={() => mut((x) => void (x.duties.find((y) => y.id === du.id)!.cancelled = true), '取消にしました')}>
                      取消
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="muted">「渡した」を押すと上の「記録する日付」で出納帳に記録されます。取り消しは出納帳から行えます（履歴が残ります）。</p>
        </Card>

        <Card title="🚗 配車と交通費の集金" right={<a className="btn small" href={`#/day/${day.id}/cars`}>配車表を取り込む</a>}>
          <div className="stack">
            <div>
              <div className="muted" style={{ marginBottom: 4 }}>高速道路の利用</div>
              <Seg<'yes' | 'no' | 'unknown'>
                value={day.usesHighway === null ? 'unknown' : day.usesHighway ? 'yes' : 'no'}
                onChange={(v) => mut((x) => void (x.usesHighway = v === 'unknown' ? null : v === 'yes'))}
                options={[['yes', 'あり'], ['no', 'なし'], ['unknown', '要確認']]}
              />
              <div className="muted" style={{ marginTop: 4 }}>
                {day.usesHighway === null ? '⚠️ 高速利用が未確認のため集金額は未確定です' : day.usesHighway ? `選手 ${yen(s.fareHighwayPlayer)}・帯同保護者 ${yen(s.fareHighwayParent)}・運転手 ${yen(s.fareDriver)}` : `高速なし: 集金 ${yen(s.fareNoHighway)}`}
                。集金は遠征当日までに現金で。
              </div>
            </div>
            <div className="grid2">
              <div className="card stat">
                <div className="label">集金済み</div>
                <div className="val in">{yen(st.got)}</div>
                <div className="muted">予定 {yen(st.expected)}</div>
              </div>
              <div className="card stat">
                <div className="label">未集金 {st.unpaid.length}名</div>
                <div className="val out">{yen(st.expected - st.got)}</div>
                {st.unknown.length > 0 && <div className="chip warn">金額要確認 {st.unknown.length}名</div>}
              </div>
            </div>
            {dup.map((m) => (
              <div key={m} className="alert bad">⚠️ {m}（どちらかを削除してください）</div>
            ))}
            {day.cars.length === 0 && <div className="empty">配車が未登録です。「配車表を取り込む」からLINEの文章かスクリーンショットを登録してください。</div>}
            {day.cars.map((car) => (
              <div className="car" key={car.id}>
                <div className="car-head">
                  <input type="text" value={car.name} style={{ flex: 1, fontWeight: 700 }} onChange={(e) => mut((x) => void (x.cars.find((c) => c.id === car.id)!.name = e.target.value))} aria-label="車の名前" />
                  {day.driverPay.refCarId === car.id && <span className="chip info">基準車両</span>}
                  <button className="btn small danger" disabled={car.riders.some((r) => r.txId)} onClick={() => confirm(`${car.name} を削除しますか？`) && mut((x) => void (x.cars = x.cars.filter((c) => c.id !== car.id)))}>
                    削除
                  </button>
                </div>
                {car.riders.map((r) => {
                  const fare = riderFare(s, day, r);
                  return (
                    <div className="rider" key={r.id}>
                      <input type="text" className="nm" value={r.name} disabled={!!r.txId} onChange={(e) => mut((x) => void (x.cars.find((c) => c.id === car.id)!.riders.find((y) => y.id === r.id)!.name = e.target.value))} />
                      <select value={r.role} disabled={!!r.txId} className={r.role === 'other' ? 'needs' : ''} style={{ width: 'auto', minHeight: 38, padding: '4px 6px' }} onChange={(e) => mut((x) => void (x.cars.find((c) => c.id === car.id)!.riders.find((y) => y.id === r.id)!.role = e.target.value as Role))}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((k) => (
                          <option key={k} value={k}>
                            {ROLE_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <div style={{ width: 90 }} title="個別の金額（空欄で規定額）">
                        <NumInput
                          value={r.amountOverride}
                          placeholder={defaultFare(s, day, r.role) === null ? '要確認' : String(defaultFare(s, day, r.role))}
                          onChange={(n) => mut((x) => void (x.cars.find((c) => c.id === car.id)!.riders.find((y) => y.id === r.id)!.amountOverride = n))}
                        />
                      </div>
                      {r.txId ? (
                        <span className="chip ok">集金済 {fmtDate(d.txs.find((t) => t.id === r.txId)?.date)}</span>
                      ) : fare === null ? (
                        <span className="chip warn">要確認</span>
                      ) : fare > 0 ? (
                        <button className="pay" onClick={() => withUndo(`${r.name} から ${yen(fare)} 集金しました`, (x) => collectFare(x, day.id, r.id, date).id)}>
                          集金
                        </button>
                      ) : (
                        <span className="chip">0円</span>
                      )}
                      {!r.txId && (
                        <button className="icon-btn" aria-label="削除" onClick={() => mut((x) => void (x.cars.find((c) => c.id === car.id)!.riders = x.cars.find((c) => c.id === car.id)!.riders.filter((y) => y.id !== r.id)))}>
                          🗑
                        </button>
                      )}
                    </div>
                  );
                })}
                <button className="btn small" style={{ marginTop: 6 }} onClick={() => mut((x) => void x.cars.find((c) => c.id === car.id)!.riders.push({ id: uid('r_'), name: '', role: 'player' }))}>
                  ＋ メンバー
                </button>
              </div>
            ))}
            <button className="btn" onClick={() => mut((x) => void x.cars.push({ id: uid('car_'), name: `車${x.cars.length + 1}`, riders: [{ id: uid('r_'), name: '', role: 'driver' }] }))}>
              ＋ 車を追加
            </button>
            <p className="muted">金額欄が空欄なら規定額。兄弟は1人ずつ、保護者が運転手でも子どもは集金対象です。例外は金額欄に入力してください。</p>
          </div>
        </Card>

        <Card title="⛽ 運転手への交通費（遠征後に現金で）">
          <div className="stack">
            <Field label={`基準車両（${s.referencePerson}さんが乗った車）`}>
              <select value={day.driverPay.refCarId ?? ''} className={day.driverPay.refCarId ? '' : 'needs'} disabled={day.driverPay.confirmed} onChange={(e) => mut((x) => void (x.driverPay.refCarId = e.target.value || undefined))}>
                <option value="">要確認（選んでください）</option>
                {day.cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Field label="走行距離（km）">
                <NumInput value={day.driverPay.distanceKm} step={0.1} onChange={(n) => mut((x) => void (x.driverPay.distanceKm = n))} />
              </Field>
              <Field label="ガソリン代（円・手入力）">
                <NumInput value={day.driverPay.gasYen} onChange={(n) => !day.driverPay.confirmed && mut((x) => void (x.driverPay.gasYen = n))} />
              </Field>
              <Field label="往復高速代（円）">
                <NumInput value={day.driverPay.tollRoundTripYen} onChange={(n) => !day.driverPay.confirmed && mut((x) => void (x.driverPay.tollRoundTripYen = n))} />
              </Field>
            </div>
            <div className="muted">ガソリン代の距離別計算式は未確認のため、当面は金額を手入力します。</div>
            {day.driverPay.confirmed ? (
              <div className="row">
                <div className="alert info" style={{ flex: 1 }}>
                  確定: 1人あたり {yen(base ?? 0)}（ガソリン {yen(day.driverPay.gasYen)} ＋ 高速 {yen(day.driverPay.tollRoundTripYen ?? 0)}）
                </div>
                <button className="btn small" disabled={day.driverPay.payments.some((p) => p.txId)} onClick={() => mut((x) => void (x.driverPay.confirmed = false))}>
                  確定解除
                </button>
              </div>
            ) : (
              <button
                className="btn primary"
                disabled={day.driverPay.gasYen === undefined || !day.driverPay.refCarId}
                onClick={() => mut((x) => void (x.driverPay.confirmed = true), 'ガソリン代・高速代を確定しました')}
              >
                基準車両の金額を確定
              </button>
            )}
            <ul className="list">
              {day.driverPay.payments.length === 0 && <li className="muted">運転手は配車に登録すると表示されます</li>}
              {day.driverPay.payments.map((p) => {
                const amt = p.amountOverride ?? base;
                return (
                  <li key={p.id}>
                    <div className="main">
                      <div className="title">{p.driverName}</div>
                      <div className="meta">{p.amountOverride !== undefined ? '個別金額' : '基準車両と同額'}</div>
                    </div>
                    {!p.txId && (
                      <div style={{ width: 96 }}>
                        <NumInput value={p.amountOverride} placeholder={base === null ? '未確定' : String(base)} onChange={(n) => mut((x) => void (x.driverPay.payments.find((y) => y.id === p.id)!.amountOverride = n))} />
                      </div>
                    )}
                    {p.txId ? (
                      <span className="chip ok">
                        支払済 {fmtDate(d.txs.find((t) => t.id === p.txId)?.date)} {yen(d.txs.find((t) => t.id === p.txId)?.amount)}
                      </span>
                    ) : amt === null ? (
                      <span className="chip warn">未確定</span>
                    ) : (
                      <button className="pay" onClick={() => withUndo(`${p.driverName} へ ${yen(amt)} 支払いました`, (x) => payDriver(x, day.id, p.id, date).id)}>
                        支払う
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <Card title="🧾 経費・準備金の精算" right={<a className="btn small" href={`#/expense/new?day=${day.id}`}>＋経費</a>}>
          {exps.length === 0 && <div className="empty">この活動に関連付けた経費はありません</div>}
          <ul className="list">
            {exps.map((e) => (
              <li key={e.id} onClick={() => go(`/expense/${e.id}`)} style={{ cursor: 'pointer' }}>
                <div className="main">
                  <div className="title">
                    {e.purchaser}：{e.items || CATEGORY[e.category]}
                  </div>
                  <div className="meta">
                    {fmtDate(e.date)}購入・{CATEGORY[e.category]}・{e.funding === 'advance' ? '準備金から' : '立て替え'} {e.receiptIds.length > 0 && '📎'}
                  </div>
                </div>
                <Amt v={e.amount} />
              </li>
            ))}
          </ul>
          {groups.length > 0 && (
            <>
              <h3>準備金の差額精算</h3>
              <ul className="list">
                {groups.map((g) => (
                  <li key={g.person}>
                    <div className="main">
                      <div className="title">{g.person}</div>
                      <div className="meta">
                        渡し {yen(g.handed)} − 購入 {yen(g.spent)} → {g.remaining > 0 ? `${yen(g.remaining)} を支払う` : g.remaining < 0 ? `${yen(-g.remaining)} を返してもらう` : '差額なし'}
                        {g.settledDiff !== 0 || (!g.settled && g.remaining !== g.diff) ? `（精算済み ${yen(Math.abs(g.settledDiff))}）` : ''}
                      </div>
                    </div>
                    {g.settled ? (
                      <span className="chip ok">精算済</span>
                    ) : (
                      <button
                        className="pay"
                        onClick={() => {
                          if (g.spent === 0 && !confirm(`${g.person} さんの経費（レシート）が未登録です。購入0円として精算しますか？`)) return;
                          update((x) => settlePrep(x, day.id, g.person, date), '差額を精算しました');
                        }}
                      >
                        精算
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="メモ">
          <textarea value={day.notes ?? ''} onChange={(e) => mut((x) => void (x.notes = e.target.value))} style={{ minHeight: 80 }} />
          <details style={{ marginTop: 6 }}>
            <summary className="muted">変更履歴（{day.history.length}）</summary>
            {day.history.map((h, i) => (
              <div key={i} className="muted">
                {new Date(h.at).toLocaleString('ja-JP')} {h.text}
              </div>
            ))}
          </details>
        </Card>
        <button
          className="btn danger"
          onClick={() => {
            if (linkedTx) return toast({ text: '集金・支払いの記録がある会計ページは削除できません（出納帳で取り消してから）', err: true });
            if (!confirm(`${fmtDate(day.date)} ${dayTitle(day)} の会計ページを削除しますか？`)) return;
            if (update((x) => void ((x.days = x.days.filter((y) => y.id !== day.id)), x.expenses.forEach((e) => e.dayId === day.id && delete e.dayId)), '削除しました')) go('/days');
          }}
        >
          この会計ページを削除
        </button>
      </main>
    </>
  );
}
