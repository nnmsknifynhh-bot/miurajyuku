import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Amt, Card, Field, NumInput, Review, Seg, TopBar, go, useRecordDate } from '../components/ui';
import { ReceiptImg } from '../components/Receipt';
import { CATEGORY, settleSelfPaid } from '../lib/expense';
import { dayTitle } from '../lib/day';
import { aiReceipt } from '../lib/api';
import { shrinkImage } from '../lib/image';
import { saveImage } from '../lib/vault';
import { voidTx } from '../lib/ledger';
import type { Expense, ExpenseCategory, Funding } from '../lib/types';
import { diffDays, fmtDate, nowIso, today, uid, yen } from '../lib/util';

export function Expenses() {
  const { data: d } = useStore();
  const [f, setF] = useState<'open' | 'all'>('open');
  const list = [...d.expenses]
    .filter((e) => f === 'all' || (e.funding === 'self' ? !e.settleTxId : !d.prepSettlements.some((p) => p.dayId === e.dayId)))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <TopBar title="経費・レシート" right={<a className="btn small primary" href="#/expense/new">＋経費を登録</a>} />
      <main>
        <Seg value={f} onChange={setF} options={[['open', '未精算'], ['all', 'すべて']]} />
        <Card>
          {list.length === 0 ? (
            <div className="empty">{f === 'open' ? '未精算の経費はありません' : '経費は未登録です'}</div>
          ) : (
            <ul className="list">
              {list.map((e) => {
                const day = d.days.find((x) => x.id === e.dayId);
                return (
                  <li key={e.id} onClick={() => go(`/expense/${e.id}`)} style={{ cursor: 'pointer' }}>
                    <div className="main">
                      <div className="title">
                        {e.purchaser}：{e.items || CATEGORY[e.category]} {e.review.length > 0 && <span className="chip warn">要確認</span>}
                      </div>
                      <div className="meta">
                        {fmtDate(e.date)}購入・{CATEGORY[e.category]}・{e.funding === 'advance' ? '準備金から' : '立て替え'}
                        {day ? `・${fmtDate(day.date)} ${dayTitle(day)}` : e.category === 'equipment' ? '・備品（活動なし）' : ''} {e.receiptIds.length > 0 && '📎'}{' '}
                        {e.funding === 'self' && (e.settleTxId ? <span className="chip ok">精算済</span> : <span className="chip warn">未精算</span>)}
                      </div>
                    </div>
                    <Amt v={e.amount} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="muted">当番以外の保護者が購入した分も、購入者名を入れて登録できます。「準備金から」の購入は、活動ページの「準備金の差額精算」でまとめて精算します。</p>
      </main>
    </>
  );
}

export function ExpenseEdit(props: { id: string; dayId?: string }) {
  const { data: d, update, toast, session } = useStore();
  const existing = d.expenses.find((x) => x.id === props.id);
  const initDay = d.days.find((x) => x.id === props.dayId);
  const [e, setE] = useState<Expense>(
    () =>
      existing ?? {
        id: uid('ex_'),
        date: initDay?.date ?? today(),
        purchaser: initDay?.duties.find((x) => !x.cancelled)?.name ?? '',
        items: '',
        category: 'drink',
        amount: 0,
        funding: initDay?.duties.some((x) => x.handedTxId) ? 'advance' : 'self',
        dayId: initDay?.id,
        receiptIds: [],
        review: [],
        createdAt: nowIso(),
      },
  );
  const [busy, setBusy] = useState(false);
  const [date, , dateBar] = useRecordDate();
  const set = (p: Partial<Expense>) => setE({ ...e, ...p });
  const locked = !!e.settleTxId;
  // 購入日に近い活動日を上に
  const days = [...d.days].sort((a, b) => Math.abs(diffDays(a.date, e.date)) - Math.abs(diffDays(b.date, e.date))).slice(0, 30);

  const addPhoto = async (file: File, read: boolean) => {
    setBusy(true);
    try {
      const img = await shrinkImage(file);
      const id = uid('img_');
      await saveImage(session, id, img.bytes, img.type);
      let next: Expense = { ...e, receiptIds: [...e.receiptIds, id] };
      if (read) {
        const r = await aiReceipt(d.settings.apiToken, { mediaType: img.type, data: img.base64 }, today());
        const review = [...r.review];
        if (!r.date) review.push('購入日が読み取れません');
        if (r.total === null) review.push('金額が読み取れません');
        next = {
          ...next,
          date: r.date || next.date,
          items: [r.store, r.items].filter(Boolean).join(' ') || next.items,
          amount: r.total ?? next.amount,
          category: (r.category || next.category) as ExpenseCategory,
          review: [...new Set([...next.review, ...review])],
        };
        toast('レシートを読み取りました。内容を確認してください');
      }
      setE(next);
    } catch (err) {
      toast({ text: errorText(err), err: true });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!e.purchaser.trim()) return toast({ text: '購入者を入力してください', err: true });
    if (!(e.amount > 0)) return toast({ text: '金額を入力してください', err: true });
    if (e.funding === 'advance' && !e.dayId) return toast({ text: '準備金からの購入は活動日を選んでください', err: true });
    const ok = update((x) => {
      const i = x.expenses.findIndex((y) => y.id === e.id);
      if (i >= 0) {
        if (x.expenses[i].settleTxId) throw new Error('精算済みの経費は変更できません（出納帳で取り消してから）');
        x.expenses[i] = e;
      } else x.expenses.push(e);
    }, '保存しました');
    if (ok) history.back();
  };

  return (
    <>
      <TopBar title={existing ? '経費の編集' : '経費の登録'} back={initDay ? `/day/${initDay.id}` : '/expenses'} />
      <main>
        <Review items={e.review} onClear={(i) => set({ review: e.review.filter((_, j) => j !== i) })} />
        <Card title="📷 レシート">
          <div className="stack">
            <div className="thumbs">
              {e.receiptIds.map((id) => (
                <ReceiptImg key={id} id={id} onRemove={locked ? undefined : () => set({ receiptIds: e.receiptIds.filter((x) => x !== id) })} />
              ))}
            </div>
            {!locked && (
              <div className="fab-row">
                <label className="btn primary">
                  {busy ? '処理中…' : '📷 撮影して読み取る'}
                  <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(ev) => ev.target.files?.[0] && addPhoto(ev.target.files[0], true)} />
                </label>
                <label className="btn">
                  画像を添付のみ
                  <input type="file" accept="image/*" hidden disabled={busy} onChange={(ev) => ev.target.files?.[0] && addPhoto(ev.target.files[0], false)} />
                </label>
              </div>
            )}
            <div className="muted">写真はこの端末内に暗号化して保存され、ロック解除中だけ表示できます。読み取り（AI）はサーバー設定が必要です。</div>
          </div>
        </Card>
        <Card title="内容">
          <div className="stack">
            <div className="row">
              <Field label="購入日">
                <input type="date" value={e.date} disabled={locked} onChange={(ev) => set({ date: ev.target.value })} />
              </Field>
              <Field label="購入者">
                <input type="text" value={e.purchaser} disabled={locked} list="people" onChange={(ev) => set({ purchaser: ev.target.value })} placeholder="例: 田中母" />
              </Field>
            </div>
            <datalist id="people">
              {[...new Set([...d.households.map((h) => h.guardian), ...d.days.flatMap((x) => x.duties.map((du) => du.name))])].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <Field label="購入品目">
              <input type="text" value={e.items} disabled={locked} onChange={(ev) => set({ items: ev.target.value })} placeholder="例: お茶 2L×3" />
            </Field>
            <div className="row">
              <Field label="分類">
                <select value={e.category} disabled={locked} onChange={(ev) => set({ category: ev.target.value as ExpenseCategory })}>
                  {(Object.keys(CATEGORY) as ExpenseCategory[]).map((k) => (
                    <option key={k} value={k}>
                      {CATEGORY[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="金額（円）">
                <NumInput value={e.amount || undefined} onChange={(n) => !locked && set({ amount: n })} />
              </Field>
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 4 }}>支払い元</div>
              <Seg<Funding> value={e.funding} onChange={(v) => !locked && set({ funding: v })} options={[['advance', '会計から事前に渡したお金'], ['self', '自分で立て替え']]} />
            </div>
            <Field label={`関連する活動日${e.category === 'equipment' ? '（備品は無しでも可）' : ''}`}>
              <select value={e.dayId ?? ''} disabled={locked} onChange={(ev) => set({ dayId: ev.target.value || undefined })}>
                <option value="">関連付けない</option>
                {days.map((x) => (
                  <option key={x.id} value={x.id}>
                    {fmtDate(x.date)} {dayTitle(x)}
                  </option>
                ))}
              </select>
            </Field>
            {!locked && (
              <button className="btn primary block" onClick={save}>
                保存
              </button>
            )}
          </div>
        </Card>
        {existing && existing.funding === 'self' && (
          <Card title="立て替えの精算">
            {existing.settleTxId ? (
              <div className="row">
                <span className="chip ok">精算済 {fmtDate(d.txs.find((t) => t.id === existing.settleTxId)?.date)} {yen(existing.amount)}</span>
                <button className="btn small" onClick={() => update((x) => voidTx(x, existing.settleTxId!, '精算の取り消し'), '精算を取り消しました')}>
                  精算を取り消す
                </button>
              </div>
            ) : (
              <div className="stack">
                {dateBar}
                <button className="btn ok" onClick={() => update((x) => void settleSelfPaid(x, existing.id, date), `${existing.purchaser} へ ${yen(existing.amount)} 支払いました`)}>
                  💴 {existing.purchaser} へ {yen(existing.amount)} を支払った
                </button>
              </div>
            )}
          </Card>
        )}
        {existing && existing.funding === 'advance' && <div className="alert info">準備金からの購入です。活動ページの「準備金の差額精算」で精算してください。</div>}
        {existing && !existing.settleTxId && (
          <button className="btn danger" onClick={() => confirm('この経費を削除しますか？') && update((x) => void (x.expenses = x.expenses.filter((y) => y.id !== existing.id)), '削除しました') && history.back()}>
            この経費を削除
          </button>
        )}
      </main>
    </>
  );
}
