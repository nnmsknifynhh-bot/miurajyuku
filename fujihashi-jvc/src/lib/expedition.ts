import type { AppData, Car, Expedition, Expense, ExpenseType, Rider } from './types';
import { addTx, AppError } from './ledger';
import { addDays, nowIso, today, uid } from './util';

export const EXPENSE_LABEL: Record<ExpenseType, string> = { gas: 'ガソリン代', toll: '高速代', parking: '駐車場代', other: 'その他経費' };

export function newExpedition(date: string = addDays(today(), 7)): Expedition {
  return {
    id: uid('exp_'),
    title: '遠征',
    date,
    destination: '',
    collectDue: addDays(date, -1),
    perPerson: 1000,
    rule: { collectTransport: true, reimburseGas: true, reimburseToll: true, reimburseParking: false, reimburseOther: false },
    cars: [],
    expenses: [],
    createdAt: nowIso(),
  };
}

export function riderAmount(e: Expedition, r: Rider): number {
  return r.amount ?? e.perPerson;
}

export function collectTargets(e: Expedition): { car: Car; rider: Rider }[] {
  const out: { car: Car; rider: Rider }[] = [];
  for (const car of e.cars) for (const rider of car.riders) if (rider.collect) out.push({ car, rider });
  return out;
}

export function expeditionStats(e: Expedition) {
  const targets = e.rule.collectTransport ? collectTargets(e) : [];
  const expected = targets.reduce((s, t) => s + riderAmount(e, t.rider), 0);
  const collected = targets.filter((t) => t.rider.txId).reduce((s, t) => s + riderAmount(e, t.rider), 0);
  const unpaid = targets.filter((t) => !t.rider.txId);
  const exps = e.expenses.filter((x) => isReimbursed(e, x.type));
  const expenseConfirmed = exps.filter((x) => x.confirmed).reduce((s, x) => s + (x.amount ?? 0), 0);
  const expensePaid = exps.filter((x) => x.txId).reduce((s, x) => s + (x.amount ?? 0), 0);
  const unsettled = exps.filter((x) => !x.txId);
  return { targets, expected, collected, unpaid, expenseConfirmed, expensePaid, unsettled, totalPeople: e.cars.reduce((s, c) => s + c.riders.length, 0) };
}

export function isReimbursed(e: Expedition, t: ExpenseType): boolean {
  return t === 'gas' ? e.rule.reimburseGas : t === 'toll' ? e.rule.reimburseToll : t === 'parking' ? e.rule.reimburseParking : e.rule.reimburseOther;
}

/** ルールに従い、車ごとの精算項目（ガソリン・高速など）が無ければ作る */
export function ensureExpenses(e: Expedition) {
  for (const car of e.cars) {
    for (const type of ['gas', 'toll', 'parking'] as ExpenseType[]) {
      if (!isReimbursed(e, type)) continue;
      if (e.expenses.some((x) => x.carId === car.id && x.type === type)) continue;
      e.expenses.push({ id: uid('ex_'), type, carId: car.id, payee: car.driver, label: `${car.name} ${EXPENSE_LABEL[type]}`, confirmed: false });
    }
  }
  // 車が削除された未精算項目を除去
  e.expenses = e.expenses.filter((x) => !x.carId || x.txId || e.cars.some((c) => c.id === x.carId));
}

export function collectRider(d: AppData, expId: string, riderId: string, date?: string) {
  const e = d.expeditions.find((x) => x.id === expId);
  if (!e) throw new AppError('遠征が見つかりません');
  const car = e.cars.find((c) => c.riders.some((r) => r.id === riderId));
  const r = car?.riders.find((x) => x.id === riderId);
  if (!car || !r) throw new AppError('乗車メンバーが見つかりません');
  if (!r.collect) throw new AppError('集金対象になっていません');
  if (r.txId) throw new AppError('すでに入金済みです');
  const tx = addTx(d, {
    date,
    counterparty: r.name,
    amount: riderAmount(e, r),
    direction: 'in',
    category: 'transport',
    description: `${e.title}（${e.date}）交通費 ${car.name}`,
    related: { kind: 'expedition', id: e.id, subId: r.id },
    sourceKey: `exp:${e.id}:rider:${r.id}`,
  });
  r.txId = tx.id;
  return tx;
}

export function confirmExpense(e: Expedition, ex: Expense, amount: number) {
  if (ex.txId) throw new AppError('精算済みの項目は変更できません。出納帳で取り消してから修正してください');
  const a = Math.round(amount);
  if (!Number.isFinite(a) || a < 0) throw new AppError('金額を正しく入力してください');
  ex.amount = a;
  ex.confirmed = true;
  void e;
}

export function settleExpense(d: AppData, expId: string, expenseId: string, date?: string) {
  const e = d.expeditions.find((x) => x.id === expId);
  const ex = e?.expenses.find((x) => x.id === expenseId);
  if (!e || !ex) throw new AppError('精算項目が見つかりません');
  if (!ex.confirmed || !ex.amount) throw new AppError('先に精算額を確定してください');
  if (ex.txId) throw new AppError('すでに精算済みです');
  const cat = ex.type === 'other' ? 'other' : ex.type;
  const tx = addTx(d, {
    date,
    counterparty: ex.payee,
    amount: ex.amount,
    direction: 'out',
    category: cat,
    description: `${e.title}（${e.date}）${ex.label}`,
    related: { kind: 'expedition', id: e.id, subId: ex.id },
    sourceKey: `exp:${e.id}:expense:${ex.id}`,
  });
  ex.txId = tx.id;
  return tx;
}

export function settleDueOf(d: AppData, e: Expedition): string {
  return addDays(e.date, d.settings.reminders.settleDaysAfter);
}
