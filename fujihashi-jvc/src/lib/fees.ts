import type { AppData, FeeCharge } from './types';
import { addTx, AppError } from './ledger';
import { addMonths, monthOf, monthRange, today, uid } from './util';

function dueDateOf(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** 開始月〜今月（+来月）までの部費予定を自動生成。既存は変更しない。生成件数を返す */
export function ensureFeeCharges(d: AppData, base = today()): number {
  const to = addMonths(monthOf(base), 1);
  const from = d.settings.feeStartMonth || monthOf(base);
  let n = 0;
  for (const month of monthRange(from, to)) {
    for (const m of d.members) {
      if (!m.active || m.monthlyFee <= 0) continue;
      if (d.fees.some((f) => f.memberId === m.id && f.month === month)) continue;
      d.fees.push({ id: uid('fee_'), memberId: m.id, month, amount: m.monthlyFee, dueDate: dueDateOf(month, d.settings.feeDueDay) });
      n++;
    }
  }
  return n;
}

export function payFee(d: AppData, chargeId: string, date?: string) {
  const f = d.fees.find((x) => x.id === chargeId);
  if (!f) throw new AppError('部費予定が見つかりません');
  if (f.txId) throw new AppError('すでに入金済みです');
  const m = d.members.find((x) => x.id === f.memberId);
  const tx = addTx(d, {
    date,
    counterparty: m ? `${m.guardian || m.name}` : '不明',
    amount: f.amount,
    direction: 'in',
    category: 'fee',
    description: `${Number(f.month.slice(5))}月分部費（${m?.name ?? ''}）`,
    related: { kind: 'fee', id: f.id },
    sourceKey: `fee:${f.id}`,
  });
  f.txId = tx.id;
  return tx;
}

/** 期限が来ている（または今月分の）未払い部費 */
export function unpaidFees(d: AppData, base = today()): FeeCharge[] {
  const cur = monthOf(base);
  return d.fees
    .filter((f) => !f.txId && !f.waived && f.month <= cur)
    .filter((f) => d.members.find((m) => m.id === f.memberId)?.active !== false)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export { dueDateOf };
