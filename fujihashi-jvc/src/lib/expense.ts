import type { AppData, ExpenseCategory } from './types';
import { addTx, AppError } from './ledger';
import { compact } from './carParser';
import { fmtDate, nowIso, today, uid } from './util';
import { dayTitle } from './day';

export const CATEGORY: Record<ExpenseCategory, string> = { drink: '飲み物', bento: '弁当', equipment: '備品', other: 'その他' };

/** 立て替え分を全額支払う */
export function settleSelfPaid(d: AppData, expenseId: string, date = today()) {
  const e = d.expenses.find((x) => x.id === expenseId);
  if (!e) throw new AppError('経費が見つかりません');
  if (e.funding !== 'self') throw new AppError('事前渡し金からの購入は「差額精算」で精算します');
  if (e.settleTxId) throw new AppError('すでに精算済みです');
  if (!(e.amount > 0)) throw new AppError('金額を入力してください');
  const tx = addTx(d, {
    date,
    counterparty: e.purchaser,
    amount: e.amount,
    direction: 'out',
    category: 'expense',
    description: `${CATEGORY[e.category]} ${e.items}（${e.date} 購入・立て替え）`,
    related: { kind: 'expense', id: e.id },
    sourceKey: `expense:${e.id}`,
  });
  e.settleTxId = tx.id;
  return tx;
}

export interface PrepGroup {
  dayId: string;
  person: string;
  handed: number; // 渡した準備金
  spent: number; // 準備金から買った額
  diff: number; // 全体の差額（+ 追加で払う / − 返してもらう）
  settledDiff: number; // 精算済みの差額
  remaining: number; // これから精算する差額
  settled: boolean;
  label: string;
}

/** 活動日×当番ごとの「準備金 − 購入額」 */
export function prepGroups(d: AppData): PrepGroup[] {
  const out: PrepGroup[] = [];
  for (const day of d.days) {
    const people = new Map<string, { handed: number; spent: number; name: string }>();
    for (const du of day.duties) {
      if (!du.handedTxId) continue;
      const tx = d.txs.find((t) => t.id === du.handedTxId);
      const k = compact(du.name);
      const g = people.get(k) ?? { handed: 0, spent: 0, name: du.name };
      g.handed += tx?.amount ?? 0;
      people.set(k, g);
    }
    for (const e of d.expenses) {
      if (e.dayId !== day.id || e.funding !== 'advance') continue;
      const k = compact(e.purchaser);
      const g = people.get(k) ?? { handed: 0, spent: 0, name: e.purchaser };
      g.spent += e.amount;
      people.set(k, g);
    }
    for (const g of people.values()) {
      const done = d.prepSettlements.filter((s) => s.dayId === day.id && compact(s.person) === compact(g.name));
      const settledDiff = done.reduce((a, s) => a + s.diff, 0);
      const diff = g.spent - g.handed;
      // あとからレシートが追加・削除されたら、残りの差額を再び未精算にする
      const settled = done.length > 0 && diff === settledDiff;
      out.push({ dayId: day.id, person: g.name, handed: g.handed, spent: g.spent, diff, settledDiff, remaining: diff - settledDiff, settled, label: `${fmtDate(day.date)} ${dayTitle(day)}` });
    }
  }
  return out;
}

/** 差額精算: 多く使った→差額を支払う、余った→返してもらう */
export function settlePrep(d: AppData, dayId: string, person: string, date = today()) {
  const g = prepGroups(d).find((x) => x.dayId === dayId && compact(x.person) === compact(person));
  if (!g) throw new AppError('精算対象が見つかりません');
  if (g.settled) throw new AppError('すでに精算済みです');
  const r = g.remaining;
  const n = d.prepSettlements.filter((s) => s.dayId === dayId && compact(s.person) === compact(person)).length;
  let txId: string | undefined;
  if (r !== 0) {
    const tx = addTx(d, {
      date,
      counterparty: person,
      amount: Math.abs(r),
      direction: r > 0 ? 'out' : 'in',
      category: 'prepSettle',
      description: `${g.label} 準備金の差額${r > 0 ? '支払い' : '返金'}（渡し${g.handed}円・購入${g.spent}円${n ? `・追加精算` : ''}）`,
      related: { kind: 'day', id: dayId },
      sourceKey: `prepSettle:${dayId}:${compact(person)}:${n}`,
    });
    txId = tx.id;
  }
  d.prepSettlements.push({ id: uid('ps_'), dayId, person, txId, diff: r, at: nowIso() });
}
