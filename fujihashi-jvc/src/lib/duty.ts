import type { AppData, Duty, DutyAssignee } from './types';
import { addTx, AppError } from './ledger';
import { fmtDate, nowIso, uid } from './util';

export function newDuty(date: string, activity: string, names: string[], amount: number): Duty {
  return {
    id: uid('duty_'),
    date,
    activity,
    cancelled: false,
    assignees: names.map((name) => ({ id: uid('as_'), name, amount, status: 'active' })),
    history: [{ at: nowIso(), text: '登録' }],
  };
}

export function activeAssignees(d: Duty): DutyAssignee[] {
  return d.cancelled ? [] : d.assignees.filter((a) => a.status === 'active');
}

/** 支払い済みなのに取り消し/交代となった担当者（返金や確認が必要） */
export function paidButInactive(d: Duty): DutyAssignee[] {
  return d.assignees.filter((a) => a.txId && (d.cancelled || a.status !== 'active'));
}

export function payDuty(d: AppData, dutyId: string, assigneeId: string, date?: string) {
  const du = d.duties.find((x) => x.id === dutyId);
  const a = du?.assignees.find((x) => x.id === assigneeId);
  if (!du || !a) throw new AppError('当番が見つかりません');
  if (du.cancelled || a.status !== 'active') throw new AppError('この当番は中止・交代済みです');
  if (a.txId) throw new AppError('すでに支払い済みです');
  const tx = addTx(d, {
    date,
    counterparty: a.name,
    amount: a.amount,
    direction: 'out',
    category: 'duty',
    description: `${fmtDate(du.date)} ${du.activity} 当番`,
    related: { kind: 'duty', id: du.id, subId: a.id },
    sourceKey: `duty:${du.id}:${a.id}`,
  });
  a.txId = tx.id;
  return tx;
}

export type PaidAction = 'keep' | 'refund';

/** 担当者を交代。支払い済みの場合は action が必須（自動削除しない） */
export function replaceAssignee(d: AppData, dutyId: string, assigneeId: string, newName: string, action?: PaidAction) {
  const du = d.duties.find((x) => x.id === dutyId);
  const a = du?.assignees.find((x) => x.id === assigneeId);
  if (!du || !a) throw new AppError('当番が見つかりません');
  if (a.txId && !action) throw new AppError('NEEDS_CONFIRM');
  a.status = 'replaced';
  if (a.txId && action === 'refund') refundFrom(d, du, a);
  du.assignees.push({ id: uid('as_'), name: newName.trim(), amount: a.amount, status: 'active' });
  du.history.push({ at: nowIso(), text: `担当変更: ${a.name} → ${newName}${a.txId ? (action === 'refund' ? '（返金受領）' : '（支払い済みのまま保持）') : ''}` });
}

export function cancelDuty(d: AppData, dutyId: string, action?: PaidAction) {
  const du = d.duties.find((x) => x.id === dutyId);
  if (!du) throw new AppError('当番が見つかりません');
  const paid = du.assignees.filter((a) => a.status === 'active' && a.txId);
  if (paid.length && !action) throw new AppError('NEEDS_CONFIRM');
  du.cancelled = true;
  if (action === 'refund') for (const a of paid) refundFrom(d, du, a);
  du.history.push({ at: nowIso(), text: `中止${paid.length ? (action === 'refund' ? '（返金受領）' : '（支払い済みのまま保持）') : ''}` });
}

export function cancelAssignee(d: AppData, dutyId: string, assigneeId: string, action?: PaidAction) {
  const du = d.duties.find((x) => x.id === dutyId);
  const a = du?.assignees.find((x) => x.id === assigneeId);
  if (!du || !a) throw new AppError('当番が見つかりません');
  if (a.txId && !action) throw new AppError('NEEDS_CONFIRM');
  a.status = 'cancelled';
  if (a.txId && action === 'refund') refundFrom(d, du, a);
  du.history.push({ at: nowIso(), text: `${a.name} の当番を取消` });
}

function refundFrom(d: AppData, du: Duty, a: DutyAssignee) {
  addTx(d, {
    counterparty: a.name,
    amount: a.amount,
    direction: 'in',
    category: 'refund',
    description: `${fmtDate(du.date)} ${du.activity} 当番費の返金`,
    related: { kind: 'duty', id: du.id, subId: a.id },
    sourceKey: `duty-refund:${du.id}:${a.id}`,
  });
}
