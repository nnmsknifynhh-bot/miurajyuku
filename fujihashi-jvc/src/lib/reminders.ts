import type { AppData } from './types';
import { unpaidFees } from './fees';
import { expeditionStats, riderAmount, settleDueOf } from './expedition';
import { activeAssignees } from './duty';
import { addDays, diffDays, fmtDate, today } from './util';

export type ReminderKind = 'fee' | 'transport' | 'duty' | 'settle';
export type Level = 'overdue' | 'today' | 'soon';

export interface Reminder {
  key: string;
  kind: ReminderKind;
  level: Level;
  due: string;
  notifyFrom: string; // この日から表示・通知
  title: string;
  detail: string;
  amount: number;
  direction: 'in' | 'out';
  link: string;
}

export const KIND_LABEL: Record<ReminderKind, string> = { fee: '部費の未回収', transport: '遠征前の交通費集金', duty: '当番への現金受け渡し', settle: 'ガソリン代・高速代精算' };

function level(due: string, base: string): Level {
  const dd = diffDays(due, base);
  return dd < 0 ? 'overdue' : dd === 0 ? 'today' : 'soon';
}

/** 全リマインド（表示開始日前のものは includeFuture=true の時のみ） */
export function computeReminders(d: AppData, base = today(), includeFuture = false): Reminder[] {
  const s = d.settings.reminders;
  const out: Reminder[] = [];
  const memberName = (id: string) => d.members.find((m) => m.id === id)?.name ?? '';

  const feeSource = includeFuture ? d.fees.filter((f) => !f.txId && !f.waived) : unpaidFees(d, base);
  const byMonth = new Map<string, typeof feeSource>();
  for (const f of feeSource) byMonth.set(f.month, [...(byMonth.get(f.month) ?? []), f]);
  for (const [month, list] of byMonth) {
    const due = list[0].dueDate;
    out.push({
      key: `fee:${month}`,
      kind: 'fee',
      level: level(due, base),
      due,
      notifyFrom: addDays(due, -s.feeDaysBefore),
      title: `${Number(month.slice(5))}月分部費 未回収 ${list.length}名`,
      detail: list.map((f) => memberName(f.memberId)).join('、'),
      amount: list.reduce((a, f) => a + f.amount, 0),
      direction: 'in',
      link: '#/fees',
    });
  }

  for (const e of d.expeditions) {
    const st = expeditionStats(e);
    if (e.rule.collectTransport && st.unpaid.length) {
      out.push({
        key: `transport:${e.id}`,
        kind: 'transport',
        level: level(e.collectDue, base),
        due: e.collectDue,
        notifyFrom: addDays(e.collectDue, -s.transportDaysBefore),
        title: `${e.title}（${fmtDate(e.date)}）交通費 未集金 ${st.unpaid.length}名`,
        detail: st.unpaid.map((t) => t.rider.name).join('、'),
        amount: st.unpaid.reduce((a, t) => a + riderAmount(e, t.rider), 0),
        direction: 'in',
        link: `#/exp/${e.id}`,
      });
    }
    if (st.unsettled.length && e.cars.length) {
      const due = settleDueOf(d, e);
      out.push({
        key: `settle:${e.id}`,
        kind: 'settle',
        level: level(due, base),
        due,
        notifyFrom: e.date,
        title: `${e.title}（${fmtDate(e.date)}）精算 未完了 ${st.unsettled.length}件`,
        detail: st.unsettled.map((x) => `${x.label}${x.confirmed ? '' : '（金額未確定）'}`).join('、'),
        amount: st.unsettled.reduce((a, x) => a + (x.amount ?? x.estimate ?? 0), 0),
        direction: 'out',
        link: `#/exp/${e.id}`,
      });
    }
  }

  for (const du of d.duties) {
    const unpaid = activeAssignees(du).filter((a) => !a.txId);
    if (!unpaid.length) continue;
    const from = s.dutyDayBefore ? addDays(du.date, -1) : s.dutySameDay ? du.date : addDays(du.date, -1);
    out.push({
      key: `duty:${du.id}`,
      kind: 'duty',
      level: level(du.date, base),
      due: du.date,
      notifyFrom: from,
      title: `${fmtDate(du.date)} ${du.activity} 当番へ支払い`,
      detail: unpaid.map((a) => `${a.name} ${a.amount.toLocaleString()}円`).join('、'),
      amount: unpaid.reduce((a, x) => a + x.amount, 0),
      direction: 'out',
      link: '#/duties',
    });
  }

  return out
    .filter((r) => includeFuture || r.notifyFrom <= base)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** 通知すべき（今日まだ通知していない、表示期間内、通知時刻を過ぎた）リマインド */
export function dueNotifications(d: AppData, now = new Date()): Reminder[] {
  const base = today();
  const { notifyHour, notifyMinute, dutySameDay, dutyDayBefore } = d.settings.reminders;
  if (now.getHours() * 60 + now.getMinutes() < notifyHour * 60 + notifyMinute) return [];
  return computeReminders(d, base).filter((r) => {
    if (d.reminderState.notified[r.key] === base) return false;
    if (d.reminderState.dismissed[r.key] === base) return false;
    if (r.kind === 'duty') {
      const dd = diffDays(r.due, base);
      if (dd === 1 && !dutyDayBefore) return false;
      if (dd === 0 && !dutySameDay) return false;
    }
    return true;
  });
}
