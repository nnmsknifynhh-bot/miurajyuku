import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Amt, Card, Field, Modal, NumInput, Seg, TopBar } from '../components/ui';
import { addTx, balance, CATEGORY_LABEL, currentFiscal, editTx, summarizeByCategory, summarizeByMonth, voidTx } from '../lib/ledger';
import { download, ledgerCsv } from '../lib/csv';
import type { Tx, TxCategory } from '../lib/types';
import { addMonths, fiscalRange, fmtDate, fmtMonth, monthOf, today, yen } from '../lib/util';

type Range = 'month' | 'fy' | 'all';

export function Ledger() {
  const { data: d } = useStore();
  const [view, setView] = useState<'list' | 'sum'>('list');
  const [range, setRange] = useState<Range>('month');
  const [month, setMonth] = useState(monthOf(today()));
  const fiscal = currentFiscal(d);
  const [fy, setFy] = useState(fiscal.fy);
  const [sel, setSel] = useState<Tx | null>(null);
  const [adding, setAdding] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const { from, to, label } = useMemo(() => {
    if (range === 'month') {
      const [y, m] = month.split('-').map(Number);
      return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`, label: `${y}年${m}月` };
    }
    if (range === 'fy') return { ...fiscalRange(fy, d.settings.fiscalStartMonth), label: `${fy}年度` };
    return { from: '0000-01-01', to: '9999-12-31', label: '全期間' };
  }, [range, month, fy, d.settings.fiscalStartMonth]);

  const txs = d.txs
    .filter((t) => t.date >= from && t.date <= to && (showVoid || !t.voided))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const active = txs.filter((t) => !t.voided);
  const inSum = active.filter((t) => t.direction === 'in').reduce((a, t) => a + t.amount, 0);
  const outSum = active.filter((t) => t.direction === 'out').reduce((a, t) => a + t.amount, 0);
  const opening = range === 'all' ? 0 : balance(d, prevDay(from));

  return (
    <>
      <TopBar title="現金出納帳" right={<button className="btn small primary" onClick={() => setAdding(true)}>＋記帳</button>} />
      <main>
        <section className="card hero">
          <div className="label">現在の現金残高</div>
          <div className="big">{yen(balance(d))}</div>
        </section>
        <Seg value={range} onChange={setRange} options={[['month', '月別'], ['fy', '年度別'], ['all', '全期間']]} />
        {range === 'month' && (
          <div className="row">
            <button className="btn small" onClick={() => setMonth(addMonths(month, -1))}>
              ‹
            </button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ flex: 1 }} />
            <button className="btn small" onClick={() => setMonth(addMonths(month, 1))}>
              ›
            </button>
          </div>
        )}
        {range === 'fy' && (
          <div className="row">
            <button className="btn small" onClick={() => setFy(fy - 1)}>
              ‹
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>
              {fy}年度（{d.settings.fiscalStartMonth}月〜）
            </div>
            <button className="btn small" onClick={() => setFy(fy + 1)}>
              ›
            </button>
          </div>
        )}
        <Card title={`${label}の集計`}>
          <table className="tbl">
            <tbody>
              {range !== 'all' && (
                <tr>
                  <td>前期繰越</td>
                  <td>{yen(opening)}</td>
                </tr>
              )}
              <tr>
                <td>入金</td>
                <td className="amt in">{yen(inSum)}</td>
              </tr>
              <tr>
                <td>出金</td>
                <td className="amt out">{yen(outSum)}</td>
              </tr>
              <tr>
                <th>{range === 'all' ? '残高' : '期末残高'}</th>
                <th>{yen(opening + inSum - outSum)}</th>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => download(`出納帳_${label}.csv`, ledgerCsv(d, from, to))}>
              ⬇ CSV出力
            </button>
          </div>
        </Card>
        <Seg value={view} onChange={setView} options={[['list', '明細'], ['sum', '内訳']]} />
        {view === 'list' ? (
          <Card>
            <label className="check" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> 取り消した取引も表示
            </label>
            {txs.length === 0 ? (
              <div className="empty">取引はありません</div>
            ) : (
              <ul className="list">
                {txs.map((t) => (
                  <li key={t.id} onClick={() => setSel(t)} style={{ cursor: 'pointer' }}>
                    <div className="main">
                      <div className={`title ${t.voided ? 'void' : ''}`}>{t.description || CATEGORY_LABEL[t.category]}</div>
                      <div className="meta">
                        {fmtDate(t.date)}・{t.counterparty}・{CATEGORY_LABEL[t.category]}
                        {t.revisions.length > 0 && <span className="chip warn">修正{t.revisions.length}</span>}
                        {t.voided && <span className="chip bad">取消</span>}
                      </div>
                    </div>
                    <span className={t.voided ? 'void' : ''}>
                      <Amt v={t.amount} dir={t.direction} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <>
            <Card title="科目別">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>科目</th>
                    <th>入金</th>
                    <th>出金</th>
                  </tr>
                </thead>
                <tbody>
                  {summarizeByCategory(d, from, to).map((r) => (
                    <tr key={r.category}>
                      <td>{CATEGORY_LABEL[r.category]}</td>
                      <td>{r.in ? yen(r.in) : ''}</td>
                      <td>{r.out ? yen(r.out) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {range !== 'month' && (
              <Card title="月別">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>月</th>
                      <th>入金</th>
                      <th>出金</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summarizeByMonth(d, range === 'all' ? (d.txs.map((t) => t.date).sort()[0] ?? today()) : from, range === 'all' ? today() : to).map((r) => (
                      <tr key={r.month}>
                        <td>
                          {r.month.slice(0, 4)}年{fmtMonth(r.month)}
                        </td>
                        <td>{yen(r.in)}</td>
                        <td>{yen(r.out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </main>
      {sel && <TxModal tx={d.txs.find((t) => t.id === sel.id)!} onClose={() => setSel(null)} />}
      {adding && <AddTxModal onClose={() => setAdding(false)} />}
    </>
  );
}

function prevDay(ymd: string) {
  const dt = new Date(ymd + 'T00:00:00');
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const CATS: TxCategory[] = ['other', 'expense', 'fee', 'transport', 'driver', 'prep', 'prepSettle', 'opening'];

function AddTxModal(props: { onClose: () => void }) {
  const { update } = useStore();
  const [f, setF] = useState({ date: today(), direction: 'out' as 'in' | 'out', category: 'other' as TxCategory, counterparty: '', amount: 0, description: '' });
  return (
    <Modal title="入出金を記帳" onClose={props.onClose}>
      <Seg value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={[['in', '入金'], ['out', '出金']]} />
      <div className="row">
        <Field label="日付">
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="科目">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as TxCategory })}>
            {CATS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="相手">
        <input type="text" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} placeholder="例: 〇〇スポーツ" />
      </Field>
      <Field label="金額（円）">
        <NumInput value={f.amount || undefined} onChange={(n) => setF({ ...f, amount: n })} />
      </Field>
      <Field label="内容">
        <input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="例: ボール購入" />
      </Field>
      <p className="muted">月謝・交通費・準備金・経費の入出金は各画面から記録すると自動で記帳され、二重計上を防げます。</p>
      <button
        className="btn primary block"
        disabled={!f.counterparty.trim() || !(f.amount > 0)}
        onClick={() => update((x) => void addTx(x, f), '記帳しました') && props.onClose()}
      >
        記帳
      </button>
    </Modal>
  );
}

function TxModal(props: { tx: Tx; onClose: () => void }) {
  const { update } = useStore();
  const t = props.tx;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ date: t.date, counterparty: t.counterparty, amount: t.amount, description: t.description, category: t.category });
  const [reason, setReason] = useState('');
  return (
    <Modal title="取引の詳細" onClose={props.onClose}>
      {!edit ? (
        <Card>
          <table className="tbl">
            <tbody>
              <tr><td>日付</td><td>{t.date}</td></tr>
              <tr><td>区分</td><td>{t.direction === 'in' ? '入金' : '出金'}・{CATEGORY_LABEL[t.category]}</td></tr>
              <tr><td>相手</td><td>{t.counterparty}</td></tr>
              <tr><td>金額</td><td><Amt v={t.amount} dir={t.direction} /></td></tr>
              <tr><td>内容</td><td>{t.description}</td></tr>
              <tr><td>記録者</td><td>{t.recorder}</td></tr>
              <tr><td>記録日時</td><td>{new Date(t.createdAt).toLocaleString('ja-JP')}</td></tr>
              {t.voided && <tr><td>取消</td><td>{new Date(t.voided.at).toLocaleString('ja-JP')} {t.voided.by}「{t.voided.reason}」</td></tr>}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="stack">
          <Field label="日付"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="相手"><input type="text" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></Field>
          <Field label="金額"><NumInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} /></Field>
          <Field label="内容"><input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="修正理由（必須）"><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn primary" disabled={!reason.trim()} onClick={() => update((x) => editTx(x, t.id, f, reason), '修正しました（履歴に残ります）') && setEdit(false)}>
            修正を保存
          </button>
        </div>
      )}
      {t.revisions.length > 0 && (
        <Card title="修正履歴">
          {t.revisions.map((r, i) => (
            <div key={i} className="muted" style={{ borderTop: i ? '1px solid var(--line)' : undefined, padding: '4px 0' }}>
              {new Date(r.at).toLocaleString('ja-JP')} {r.by}「{r.reason}」<br />
              修正前: {r.before.date} {r.before.counterparty} {yen(r.before.amount)} {r.before.description}
            </div>
          ))}
        </Card>
      )}
      {!t.voided && !edit && (
        <div className="fab-row">
          <button className="btn" onClick={() => setEdit(true)}>
            修正
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const r = prompt('取り消し理由を入力してください（履歴に残ります）');
              if (r?.trim() && update((x) => voidTx(x, t.id, r), '取り消しました。関連する入金・支払い状態も未処理に戻りました')) props.onClose();
            }}
          >
            取り消し
          </button>
        </div>
      )}
    </Modal>
  );
}
