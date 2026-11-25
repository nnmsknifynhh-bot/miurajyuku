import type { AppData, FeeBill } from './types';
import { addTx, AppError } from './ledger';
import { addMonths, monthEnd, today, uid } from './util';

/** 回収期限（設定のルールによる。未確認のため選択式） */
export function feeDueDate(d: AppData, month: string): string {
  return d.settings.feeDueRule === 'targetMonthEnd' ? monthEnd(month) : monthEnd(addMonths(month, -1));
}

export const collected = (b: FeeBill) => b.collections.reduce((s, c) => s + c.amount, 0);
export const outstanding = (b: FeeBill) => Math.max(0, b.amount - collected(b));

/** 対象月の月謝袋を在籍家庭ぶん作成（既存は変更しない）。金額未設定の家庭は作らず名前を返す */
export function createBills(d: AppData, month: string, distributedOn?: string): { created: number; missing: string[] } {
  let created = 0;
  const missing: string[] = [];
  for (const h of d.households) {
    if (!h.active) continue;
    if (d.bills.some((b) => b.householdId === h.id && b.month === month)) continue;
    if (h.monthlyFee === null) {
      missing.push(h.name);
      continue;
    }
    d.bills.push({ id: uid('bill_'), householdId: h.id, month, amount: h.monthlyFee, distributedOn, dueDate: feeDueDate(d, month), collections: [] });
    created++;
  }
  return { created, missing };
}

export function collectFee(d: AppData, billId: string, amount: number, date = today()) {
  const b = d.bills.find((x) => x.id === billId);
  if (!b) throw new AppError('月謝が見つかりません');
  const rest = outstanding(b);
  if (rest <= 0) throw new AppError('すでに全額回収済みです');
  if (amount > rest) throw new AppError(`未回収額（${rest.toLocaleString()}円）を超えています`);
  const h = d.households.find((x) => x.id === b.householdId);
  const n = b.collections.length;
  const tx = addTx(d, {
    date,
    counterparty: h?.guardian || h?.name || '',
    amount,
    direction: 'in',
    category: 'fee',
    description: `${Number(b.month.slice(5))}月分 月謝（${h?.name ?? ''}）${n ? `${n + 1}回目` : ''}`,
    related: { kind: 'fee', id: b.id },
    sourceKey: `fee:${b.id}:${n}:${amount}`,
  });
  b.collections.push({ id: uid('col_'), date, amount, txId: tx.id });
  return tx;
}
