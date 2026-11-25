import type { AppData, Tx, TxCategory, TxRelated } from './types';
import { monthRange, nowIso, today, uid, monthOf, fiscalYearOf, fiscalRange } from './util';

export class AppError extends Error {}

export interface NewTx {
  date?: string;
  counterparty: string;
  amount: number;
  direction: 'in' | 'out';
  category: TxCategory;
  description: string;
  related?: TxRelated;
  sourceKey?: string;
}

export function activeTxs(d: AppData): Tx[] {
  return d.txs.filter((t) => !t.voided);
}

export function balance(d: AppData, until?: string): number {
  return activeTxs(d)
    .filter((t) => !until || t.date <= until)
    .reduce((s, t) => s + (t.direction === 'in' ? t.amount : -t.amount), 0);
}

function assertOpen(d: AppData, date: string) {
  if (d.settings.closedThrough && date <= d.settings.closedThrough) {
    throw new AppError(`${d.settings.closedThrough} までは年度締め済みのため変更できません`);
  }
}

/** 入出金を記録。sourceKey が同じ有効な取引があれば二重計上としてエラー。 */
export function addTx(d: AppData, n: NewTx): Tx {
  const amount = Math.round(Number(n.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('金額を正しく入力してください');
  const date = n.date || today();
  assertOpen(d, date);
  if (n.sourceKey && activeTxs(d).some((t) => t.sourceKey === n.sourceKey)) {
    throw new AppError('この取引はすでに記録されています（二重計上防止）');
  }
  const tx: Tx = {
    id: uid('tx_'),
    date,
    counterparty: n.counterparty.trim(),
    amount,
    direction: n.direction,
    category: n.category,
    description: n.description,
    related: n.related,
    sourceKey: n.sourceKey,
    recorder: d.settings.recorderName || '会計係',
    createdAt: nowIso(),
    revisions: [],
  };
  d.txs.push(tx);
  return tx;
}

/** 取引を取り消し（履歴は残る）。関連する入金済み状態も解除する。 */
export function voidTx(d: AppData, id: string, reason: string) {
  const t = d.txs.find((x) => x.id === id);
  if (!t) throw new AppError('取引が見つかりません');
  if (t.voided) return;
  if (!reason.trim()) throw new AppError('取り消し理由を入力してください');
  assertOpen(d, t.date);
  t.voided = { at: nowIso(), by: d.settings.recorderName || '会計係', reason };
  unlinkTx(d, id);
}

export function unlinkTx(d: AppData, id: string) {
  for (const b of d.bills) b.collections = b.collections.filter((c) => c.txId !== id);
  for (const day of d.days) {
    for (const c of day.cars) for (const r of c.riders) if (r.txId === id) delete r.txId;
    for (const p of day.driverPay.payments) if (p.txId === id) delete p.txId;
    for (const du of day.duties) if (du.handedTxId === id) delete du.handedTxId;
  }
  for (const e of d.expenses) if (e.settleTxId === id) delete e.settleTxId;
  d.prepSettlements = d.prepSettlements.filter((p) => p.txId !== id);
}

export function editTx(
  d: AppData,
  id: string,
  patch: Partial<Pick<Tx, 'date' | 'counterparty' | 'amount' | 'description' | 'category'>>,
  reason: string,
) {
  const t = d.txs.find((x) => x.id === id);
  if (!t) throw new AppError('取引が見つかりません');
  if (t.voided) throw new AppError('取り消し済みの取引は修正できません');
  if (!reason.trim()) throw new AppError('修正理由を入力してください');
  assertOpen(d, t.date);
  if (patch.date) assertOpen(d, patch.date);
  if (patch.amount !== undefined) {
    const a = Math.round(Number(patch.amount));
    if (!Number.isFinite(a) || a <= 0) throw new AppError('金額を正しく入力してください');
    patch.amount = a;
  }
  t.revisions.push({
    at: nowIso(),
    by: d.settings.recorderName || '会計係',
    reason,
    before: { date: t.date, counterparty: t.counterparty, amount: t.amount, direction: t.direction, description: t.description, category: t.category },
  });
  Object.assign(t, patch);
}

export const CATEGORY_LABEL: Record<TxCategory, string> = {
  fee: '月謝',
  transport: '遠征交通費（集金）',
  driver: '運転手への交通費',
  prep: '当番準備金',
  prepSettle: '準備金の差額精算',
  expense: '経費（立て替え精算）',
  opening: '繰越',
  other: 'その他',
};

export function summarizeByMonth(d: AppData, from: string, to: string) {
  const rows = monthRange(monthOf(from), monthOf(to)).map((m) => ({ month: m, in: 0, out: 0 }));
  for (const t of activeTxs(d)) {
    if (t.date < from || t.date > to) continue;
    const r = rows.find((x) => x.month === monthOf(t.date));
    if (r) r[t.direction] += t.amount;
  }
  return rows;
}

export function summarizeByCategory(d: AppData, from: string, to: string) {
  const map = new Map<TxCategory, { in: number; out: number }>();
  for (const t of activeTxs(d)) {
    if (t.date < from || t.date > to) continue;
    const r = map.get(t.category) ?? { in: 0, out: 0 };
    r[t.direction] += t.amount;
    map.set(t.category, r);
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v }));
}

export function currentFiscal(d: AppData) {
  const fy = fiscalYearOf(today(), d.settings.fiscalStartMonth);
  return { fy, ...fiscalRange(fy, d.settings.fiscalStartMonth) };
}

