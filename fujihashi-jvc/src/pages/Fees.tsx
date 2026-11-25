import { useState } from 'react';
import { useStore } from '../store';
import { Amt, Card, Check, Field, Modal, NumInput, TopBar, useRecordDate } from '../components/ui';
import { collectFee, collected, createBills, feeDueDate, outstanding } from '../lib/fees';
import { parseRoster } from '../lib/roster';
import { voidTx } from '../lib/ledger';
import type { Household } from '../lib/types';
import { addDays, addMonths, fmtDate, monthOf, today, uid, yen } from '../lib/util';

export function Fees() {
  const { data: d, update, toast } = useStore();
  const [month, setMonth] = useState(addMonths(monthOf(today()), 0));
  const [distDate, setDistDate] = useState(addDays(`${month}-01`, -1));
  const [date, , dateBar] = useRecordDate();
  const bills = d.bills.filter((b) => b.month === month);
  const hh = (id: string) => d.households.find((h) => h.id === id);
  const total = bills.reduce((a, b) => a + b.amount, 0);
  const got = bills.reduce((a, b) => a + collected(b), 0);
  const changeMonth = (m: string) => {
    setMonth(m);
    setDistDate(addDays(`${m}-01`, -1));
  };
  const create = () =>
    update(
      (x) => {
        const r = createBills(x, month, distDate);
        if (r.missing.length) toast({ text: `月謝額が「要確認」の家庭は作成していません: ${r.missing.join('、')}`, err: true });
      },
      `${Number(month.slice(5))}月分の月謝袋を作成しました`,
    );
  const setBill = (id: string, p: Record<string, unknown>) => update((x) => void Object.assign(x.bills.find((b) => b.id === id)!, p));

  return (
    <>
      <TopBar title="月謝（家庭単位）" right={<a className="btn small" href="#/households">名簿</a>} />
      <main>
        <div className="row">
          <button className="btn small" onClick={() => changeMonth(addMonths(month, -1))} aria-label="前月">‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>
            {month.slice(0, 4)}年{Number(month.slice(5))}月分
          </div>
          <button className="btn small" onClick={() => changeMonth(addMonths(month, 1))} aria-label="翌月">›</button>
        </div>
        <div className="grid2">
          <div className="card stat">
            <div className="label">回収済み</div>
            <div className="val in">{yen(got)}</div>
            <div className="muted">請求 {yen(total)}</div>
          </div>
          <div className="card stat">
            <div className="label">未回収 {bills.filter((b) => outstanding(b) > 0).length}家庭</div>
            <div className="val out">{yen(total - got)}</div>
            <div className="muted">回収期限 {fmtDate(feeDueDate(d, month))}</div>
          </div>
        </div>
        <Card title="月謝袋の作成">
          <div className="stack">
            <div className="row">
              <Field label="配布日">
                <input type="date" value={distDate} onChange={(e) => setDistDate(e.target.value)} />
              </Field>
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={create}>
                {Number(month.slice(5))}月分を作成
              </button>
            </div>
            <div className="muted">在籍中の家庭ぶん作成します（作成済みの家庭は変わりません）。回収期限のルールは設定で変更できます（要確認事項）。</div>
          </div>
        </Card>
        {dateBar}
        <Card title="家庭ごとの状況">
          {bills.length === 0 ? (
            <div className="empty">この月の月謝袋はまだ作成していません</div>
          ) : (
            <ul className="list">
              {bills.map((b) => {
                const h = hh(b.householdId);
                const rest = outstanding(b);
                return (
                  <li key={b.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="row">
                      <div className="main">
                        <div className="title">
                          {h?.name} {rest === 0 ? <span className="chip ok">回収済</span> : b.dueDate < today() ? <span className="chip bad">期限超過</span> : null}
                        </div>
                        <div className="meta">
                          {h?.children.map((c) => c.name).join('、')}
                          {b.collections.length > 0 && `・集金日 ${b.collections.map((c) => `${fmtDate(c.date)} ${yen(c.amount)}`).join('、')}`}
                        </div>
                      </div>
                      <Amt v={rest} />
                    </div>
                    <BillRow
                      amount={b.amount}
                      distributedOn={b.distributedOn}
                      dueDate={b.dueDate}
                      rest={rest}
                      hasCollections={b.collections.length > 0}
                      onSet={(p) => setBill(b.id, p)}
                      onCollect={(amt) => {
                        let txId = '';
                        update(
                          (x) => {
                            txId = collectFee(x, b.id, amt, date).id;
                          },
                          () => ({ text: `${h?.name} から ${yen(amt)} 受け取りました`, undo: () => update((x) => voidTx(x, txId, '入力直後の取り消し'), '取り消しました') }),
                        );
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="muted">集金方法は現金のみ。一部だけ受け取った場合は金額を変えて「受取」を押すと、未回収額が残ります。</p>
      </main>
    </>
  );
}

function BillRow(props: { amount: number; distributedOn?: string; dueDate: string; rest: number; hasCollections: boolean; onSet: (p: Record<string, unknown>) => void; onCollect: (n: number) => void }) {
  const [amt, setAmt] = useState(props.rest);
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ marginTop: 6 }}>
      {props.rest > 0 && (
        <div className="row">
          <div style={{ width: 110 }}>
            <NumInput value={amt} onChange={setAmt} />
          </div>
          <button className="pay" onClick={() => props.onCollect(amt)} disabled={!(amt > 0)}>
            受取
          </button>
          <button className="btn small" onClick={() => setOpen(!open)}>
            {open ? '閉じる' : '請求の編集'}
          </button>
        </div>
      )}
      {(open || props.rest === 0) && (
        <div className="row">
          <Field label="請求額">
            <NumInput value={props.amount} onChange={(n) => props.onSet({ amount: n })} />
          </Field>
          <Field label="配布日">
            <input type="date" value={props.distributedOn ?? ''} onChange={(e) => props.onSet({ distributedOn: e.target.value || undefined })} />
          </Field>
          <Field label="回収期限">
            <input type="date" value={props.dueDate} onChange={(e) => e.target.value && props.onSet({ dueDate: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

export function Households() {
  const { data: d, update, toast } = useStore();
  const [edit, setEdit] = useState<Household | null>(null);
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState('');
  const blank = (): Household => ({ id: uid('h_'), name: '', guardian: '', children: [{ id: uid('c_'), name: '' }], monthlyFee: d.settings.monthlyFeeDefault, active: true });
  const preview = bulk ? parseRoster(text, d.settings.monthlyFeeDefault) : [];
  return (
    <>
      <TopBar title={`名簿（${d.households.filter((h) => h.active).length}家庭）`} back="/fees" right={<button className="btn small primary" onClick={() => setEdit(blank())}>＋家庭</button>} />
      <main>
        <button className="btn" onClick={() => setBulk(true)}>
          📋 名簿を貼り付けて一括登録
        </button>
        <Card>
          {d.households.length === 0 ? (
            <div className="empty">名簿が未登録です</div>
          ) : (
            <ul className="list">
              {d.households.map((h) => (
                <li key={h.id} onClick={() => setEdit(h)} style={{ cursor: 'pointer', opacity: h.active ? 1 : 0.5 }}>
                  <div className="main">
                    <div className="title">
                      {h.name} {!h.active && <span className="chip">退部・休部</span>}
                    </div>
                    <div className="meta">
                      {h.guardian}・{h.children.map((c) => `${c.name}${c.grade ? `(${c.grade})` : ''}`).join('、')}
                    </div>
                  </div>
                  {h.monthlyFee === null ? <span className="chip warn">月謝 要確認</span> : <span className="muted">{yen(h.monthlyFee)}/月</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="muted">選手名は「姓 名」（例: 三浦 ゆい）で登録すると、LINEの配車表の「ゆい」「三浦母」と自動で照合できます。</p>
      </main>
      {bulk && (
        <Modal title="名簿の一括登録" onClose={() => setBulk(false)}>
          <div className="muted">1行に1人。「姓 名, 学年, 保護者名」の順（学年・保護者は省略可）。Excel やスプレッドシートからのコピーも可。姓が同じ子は同じ家庭にまとめます。</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'三浦 ゆい, 6年, 三浦母\n田中 はな, 6年, 田中母\n田中 こころ, 3年'} />
          {preview.length > 0 && (
            <div className="muted">
              {preview.length}家庭・{preview.reduce((a, h) => a + h.children.length, 0)}名: {preview.map((h) => `${h.name}(${h.children.length})`).join('、')}
            </div>
          )}
          <button
            className="btn primary block"
            disabled={!preview.length}
            onClick={() => {
              const dupNames = preview.filter((p) => d.households.some((h) => h.name === p.name)).map((p) => p.name);
              if (dupNames.length && !confirm(`すでに登録済みの家庭があります（${dupNames.join('、')}）。重複を避けるため、これらは追加しません。続けますか？`)) return;
              const add = preview.filter((p) => !dupNames.includes(p.name));
              if (update((x) => void x.households.push(...add), `${add.length}家庭を登録しました`)) {
                setBulk(false);
                setText('');
              }
              if (d.settings.monthlyFeeDefault === null) toast('月謝額は「要確認」です。家庭ごとに設定してください');
            }}
          >
            登録
          </button>
        </Modal>
      )}
      {edit && (
        <HouseholdModal
          h={edit}
          onClose={() => setEdit(null)}
          onSave={(h) => {
            const ok = update((x) => {
              const i = x.households.findIndex((y) => y.id === h.id);
              if (i >= 0) x.households[i] = h;
              else x.households.push(h);
            }, '保存しました');
            if (ok) setEdit(null);
          }}
        />
      )}
    </>
  );
}

function HouseholdModal(props: { h: Household; onClose: () => void; onSave: (h: Household) => void }) {
  const [h, setH] = useState(props.h);
  const set = (p: Partial<Household>) => setH({ ...h, ...p });
  return (
    <Modal title={props.h.name ? '家庭の編集' : '家庭の追加'} onClose={props.onClose}>
      <div className="row">
        <Field label="家庭名">
          <input type="text" value={h.name} onChange={(e) => set({ name: e.target.value })} placeholder="三浦家" />
        </Field>
        <Field label="保護者（呼び方）">
          <input type="text" value={h.guardian} onChange={(e) => set({ guardian: e.target.value })} placeholder="三浦母" />
        </Field>
      </div>
      <Card title="選手">
        <div className="stack">
          {h.children.map((c, i) => (
            <div className="row" key={c.id}>
              <input type="text" value={c.name} placeholder="姓 名" style={{ flex: 2 }} onChange={(e) => set({ children: h.children.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="text" value={c.grade ?? ''} placeholder="学年" style={{ flex: 1 }} onChange={(e) => set({ children: h.children.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)) })} />
              <button className="icon-btn" aria-label="削除" onClick={() => set({ children: h.children.filter((_, j) => j !== i) })}>
                🗑
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => set({ children: [...h.children, { id: uid('c_'), name: '' }] })}>
            ＋ 選手（兄弟）
          </button>
        </div>
      </Card>
      <Field label="毎月の月謝（円・家庭単位）">
        <div className={h.monthlyFee === null ? 'needs' : ''} style={{ borderRadius: 10 }}>
          <NumInput value={h.monthlyFee ?? undefined} placeholder="要確認" onChange={(n) => set({ monthlyFee: n })} />
        </div>
      </Field>
      <Check checked={h.active} onChange={(b) => set({ active: b })} label="在籍中（月謝袋を作成する）" />
      <button className="btn primary block" disabled={!h.name.trim()} onClick={() => props.onSave({ ...h, children: h.children.filter((c) => c.name.trim()) })}>
        保存
      </button>
    </Modal>
  );
}
