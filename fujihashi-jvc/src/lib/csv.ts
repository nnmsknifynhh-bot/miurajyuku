import type { AppData } from './types';
import { CATEGORY_LABEL } from './ledger';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  // CSV インジェクション対策（= + - @ で始まる値）
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: unknown[][]): string {
  return '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function ledgerCsv(d: AppData, from: string, to: string): string {
  const relLabel = (t: AppData['txs'][number]) => {
    if (!t.related) return '';
    if (t.related.kind === 'expedition') return '遠征: ' + (d.expeditions.find((e) => e.id === t.related!.id)?.title ?? '');
    if (t.related.kind === 'duty') {
      const du = d.duties.find((x) => x.id === t.related!.id);
      return du ? `当番: ${du.date} ${du.activity}` : '当番';
    }
    return '部費';
  };
  const rows: unknown[][] = [['日付', '区分', '相手', '入金', '出金', '内容', '科目', '関連する遠征・当番', '記録者', '状態', '修正回数']];
  let bal = 0;
  const list = d.txs.filter((t) => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const t of list) {
    if (!t.voided) bal += t.direction === 'in' ? t.amount : -t.amount;
    rows.push([
      t.date,
      t.direction === 'in' ? '入金' : '出金',
      t.counterparty,
      t.direction === 'in' ? t.amount : '',
      t.direction === 'out' ? t.amount : '',
      t.description,
      CATEGORY_LABEL[t.category],
      relLabel(t),
      t.recorder,
      t.voided ? `取消（${t.voided.reason}）` : '有効',
      t.revisions.length,
    ]);
  }
  rows.push([]);
  rows.push(['期間内差引', '', '', '', '', bal]);
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
