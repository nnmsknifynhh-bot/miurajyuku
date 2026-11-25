import type { AppData } from './types';
import { CATEGORY_LABEL } from './ledger';
import { collected, outstanding } from './fees';
import { allRiders, dayTitle, riderFare, ROLE_LABEL } from './day';
import { CATEGORY } from './expense';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // CSV インジェクション対策
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

const txDate = (d: AppData, id?: string) => (id ? (d.txs.find((t) => t.id === id)?.date ?? '') : '');

export function ledgerCsv(d: AppData, from: string, to: string): string {
  const rel = (t: AppData['txs'][number]) => {
    if (!t.related) return '';
    if (t.related.kind === 'day') {
      const day = d.days.find((x) => x.id === t.related!.id);
      return day ? `${day.date} ${dayTitle(day)}` : '';
    }
    if (t.related.kind === 'expense') return '経費';
    return '月謝';
  };
  const rows: unknown[][] = [['日付', '区分', '相手', '入金', '出金', '内容', '科目', '関連する活動', '記録者', '状態', '修正回数']];
  let bal = 0;
  const list = d.txs.filter((t) => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const t of list) {
    if (!t.voided) bal += t.direction === 'in' ? t.amount : -t.amount;
    rows.push([t.date, t.direction === 'in' ? '入金' : '出金', t.counterparty, t.direction === 'in' ? t.amount : '', t.direction === 'out' ? t.amount : '', t.description, CATEGORY_LABEL[t.category], rel(t), t.recorder, t.voided ? `取消（${t.voided.reason}）` : '有効', t.revisions.length]);
  }
  rows.push([], ['期間内差引', '', '', '', '', bal]);
  return toCsv(rows);
}

export function feesCsv(d: AppData): string {
  const rows: unknown[][] = [['対象月', '家庭', '保護者', '請求額', '配布日', '回収期限', '回収済み', '未回収', '最終集金日']];
  for (const b of [...d.bills].sort((a, b2) => a.month.localeCompare(b2.month))) {
    const h = d.households.find((x) => x.id === b.householdId);
    rows.push([b.month, h?.name, h?.guardian, b.amount, b.distributedOn ?? '', b.dueDate, collected(b), outstanding(b), b.collections.at(-1)?.date ?? '']);
  }
  return toCsv(rows);
}

export function transportCsv(d: AppData): string {
  const rows: unknown[][] = [['日付', '活動', '高速利用', '車', '氏名', '分類', '集金額', '集金済み', '集金日']];
  for (const day of [...d.days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const { car, r } of allRiders(day)) {
      const f = riderFare(d.settings, day, r);
      rows.push([day.date, dayTitle(day), day.usesHighway === null ? '要確認' : day.usesHighway ? 'あり' : 'なし', car.name, r.name, ROLE_LABEL[r.role], f ?? '要確認', r.txId ? '済' : '', txDate(d, r.txId)]);
    }
  }
  return toCsv(rows);
}

export function expensesCsv(d: AppData): string {
  const rows: unknown[][] = [['購入日', '購入者', '品目', '分類', '金額', '支払い元', '関連する活動', '精算日', 'レシート枚数']];
  for (const e of [...d.expenses].sort((a, b) => a.date.localeCompare(b.date))) {
    const day = d.days.find((x) => x.id === e.dayId);
    rows.push([e.date, e.purchaser, e.items, CATEGORY[e.category], e.amount, e.funding === 'advance' ? '事前渡し金' : '立て替え', day ? `${day.date} ${dayTitle(day)}` : '', txDate(d, e.settleTxId), e.receiptIds.length]);
  }
  return toCsv(rows);
}

export function download(filename: string, content: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
