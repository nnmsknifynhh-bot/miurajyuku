import { describe, expect, it } from 'vitest';
import { parseCarSplit } from '../src/lib/carParser';
import { parseScheduleText } from '../src/lib/scheduleParser';
import { sampleCarText, sampleData } from '../src/lib/sample';
import { addTx, balance, editTx, voidTx } from '../src/lib/ledger';
import { collectFee, createBills, feeDueDate, outstanding } from '../src/lib/fees';
import { applyScheduleChange, carsFromParsed, collectFare, defaultFare, diffSchedule, driverBase, fareStats, handPrep, payDriver, syncDriverPayments } from '../src/lib/day';
import { prepGroups, settlePrep, settleSelfPaid } from '../src/lib/expense';
import { rosterPeople, parseRoster } from '../src/lib/roster';
import { holidayName, isWeekendOrHoliday } from '../src/lib/holidays';
import { ledgerCsv, transportCsv } from '../src/lib/csv';
import { emptyData } from '../src/lib/defaults';
import { monthEnd, uid } from '../src/lib/util';

const BASE = '2026-11-15';

describe('祝日・月末', () => {
  it('祝日と振替休日', () => {
    expect(holidayName('2026-11-23')).toBe('勤労感謝の日');
    expect(holidayName('2026-05-06')).toBe('振替休日'); // 5/3 が日曜
    expect(holidayName('2026-09-22')).toBe('国民の休日');
    expect(holidayName('2027-03-21')).toBe('春分の日');
    expect(isWeekendOrHoliday('2026-11-24')).toBe(false);
    expect(isWeekendOrHoliday('2026-11-21')).toBe(true);
  });
  it('31日が無い月の末日', () => {
    expect(monthEnd('2027-02')).toBe('2027-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-11')).toBe('2026-11-30');
  });
});

describe('予定表 → 日別会計ページ', () => {
  it('テキスト解析（会場・当番）', () => {
    const r = parseScheduleText('11/21(土) 練習 @藤橋小体育館 当番：田中母、佐藤父\n11/22(日) 練習試合 (市民体育館)\n11/29 休み', BASE);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ date: '2026-11-21', activity: '練習', venue: '藤橋小体育館', duties: ['田中母', '佐藤父'] });
    expect(r[1]).toMatchObject({ venue: '市民体育館', activity: '練習試合' });
  });
  it('同じ日の複数活動は1ページ。再取り込みで記録を消さず差分のみ', () => {
    const d = emptyData();
    const items = parseScheduleText('11/22 練習試合 @A 当番：鈴木母\n11/22 合同練習 @A', BASE);
    for (const c of diffSchedule(d, items)) applyScheduleChange(d, c);
    expect(d.days).toHaveLength(1);
    expect(d.days[0].activities).toHaveLength(2);
    d.settings.prepDefault = 3000;
    d.days[0].duties[0].amount = 3000;
    handPrep(d, d.days[0].id, d.days[0].duties[0].id);
    // 当番交代・会場変更・活動追加
    const changes = diffSchedule(d, parseScheduleText('11/22 練習試合 @B 当番：山本母\n11/22 合同練習 @A', BASE));
    const kinds = changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(['addDuty', 'missingDuty', 'venue']);
    expect(changes.find((c) => c.kind === 'missingDuty')).toMatchObject({ paid: true });
    for (const c of changes) applyScheduleChange(d, c);
    const du = d.days[0].duties.find((x) => x.name === '鈴木母')!;
    expect(du.cancelled).toBe(true);
    expect(du.handedTxId).toBeTruthy(); // 記録は残る
    expect(d.days[0].review.join()).toContain('返金');
    expect(diffSchedule(d, parseScheduleText('11/22 練習試合 @B 当番：山本母\n11/22 合同練習 @A', BASE))).toEqual([]);
  });
});

describe('配車表と交通費', () => {
  const setup = () => {
    const d = sampleData();
    const day = d.days.find((x) => x.cars.length)!;
    return { d, day };
  };
  it('分類: 運転手・選手・帯同保護者、兄弟は1人ずつ、重複検出', () => {
    const d = sampleData();
    const r = carsFromParsed(parseCarSplit(sampleCarText(BASE), BASE), rosterPeople(d));
    const c0 = r.cars[0].riders.map((x) => `${x.name}:${x.role}`);
    expect(c0).toEqual(['三浦母:driver', '三浦 ゆい:player', '田中 はな:player', '田中 こころ:player', '田中母:parent']);
    expect(r.cars[1].riders[0]).toMatchObject({ name: '佐藤父', role: 'driver' });
    expect(r.issues.join()).toContain('重複');
  });
  it('高速あり: 選手1000・保護者1000・運転手0。運転手の子は集金対象', () => {
    const { d, day } = setup();
    day.usesHighway = true;
    const s = d.settings;
    expect(defaultFare(s, day, 'player')).toBe(1000);
    expect(defaultFare(s, day, 'parent')).toBe(1000);
    expect(defaultFare(s, day, 'driver')).toBe(0);
    const st = fareStats(s, day);
    // 三浦車: 選手3人(運転手=三浦母の子ゆい含む)+保護者1 = 4000、佐藤車: 選手3=3000（先野コーチは0円）、伊藤車: 選手2=2000
    expect(st.expected).toBe(9000);
    expect(day.cars[1].riders.find((r) => r.name.includes('先野'))).toMatchObject({ amountOverride: 0 });
    expect(day.driverPay.refCarId).toBe(day.cars[1].id);
    day.usesHighway = false;
    expect(fareStats(s, day).expected).toBe(0);
    day.usesHighway = null;
    expect(fareStats(s, day).unknown.length).toBeGreaterThan(0);
  });
  it('集金の二重計上防止・個別金額', () => {
    const { d, day } = setup();
    const r = day.cars[0].riders[1];
    expect(() => collectFare(d, day.id, r.id)).toThrow(/集金済み/);
    const r2 = day.cars[1].riders[1];
    r2.amountOverride = 500;
    const tx = collectFare(d, day.id, r2.id, '2026-11-20');
    expect(tx.amount).toBe(500);
    expect(tx.date).toBe('2026-11-20');
  });
  it('運転手へ同額支給', () => {
    const { d, day } = setup();
    syncDriverPayments(day);
    expect(day.driverPay.payments.map((p) => p.driverName)).toEqual(['三浦母', '佐藤父', '伊藤母']);
    expect(() => payDriver(d, day.id, day.driverPay.payments[0].id)).toThrow(/確定/);
    Object.assign(day.driverPay, { distanceKm: 84, gasYen: 1800, tollRoundTripYen: 2400, confirmed: true });
    expect(driverBase(day)).toBe(4200);
    const bal = balance(d);
    for (const p of day.driverPay.payments) payDriver(d, day.id, p.id);
    expect(balance(d)).toBe(bal - 4200 * 3);
  });
});

describe('準備金と経費', () => {
  it('準備金の差額精算・立て替え精算', () => {
    const { d, day } = (() => {
      const d = sampleData();
      return { d, day: d.days.find((x) => x.cars.length)! };
    })();
    const du = day.duties[0]; // 3000円渡し済み
    d.expenses.push({ id: uid(), date: day.date, purchaser: du.name, items: 'お茶', category: 'drink', amount: 1200, funding: 'advance', dayId: day.id, receiptIds: [], review: [], createdAt: '' });
    d.expenses.push({ id: uid(), date: day.date, purchaser: du.name, items: '弁当', category: 'bento', amount: 2500, funding: 'advance', dayId: day.id, receiptIds: [], review: [], createdAt: '' });
    const g = prepGroups(d).find((x) => x.dayId === day.id)!;
    expect(g).toMatchObject({ handed: 3000, spent: 3700, diff: 700, settled: false });
    const bal = balance(d);
    settlePrep(d, day.id, du.name);
    expect(balance(d)).toBe(bal - 700);
    expect(() => settlePrep(d, day.id, du.name)).toThrow();
    // 精算後にレシートを追加 → 残りの差額だけ再び未精算
    d.expenses.push({ id: uid(), date: day.date, purchaser: du.name, items: '氷', category: 'drink', amount: 300, funding: 'advance', dayId: day.id, receiptIds: [], review: [], createdAt: '' });
    expect(prepGroups(d).find((x) => x.dayId === day.id)).toMatchObject({ settled: false, remaining: 300 });
    settlePrep(d, day.id, du.name);
    expect(balance(d)).toBe(bal - 1000);
    expect(prepGroups(d).find((x) => x.dayId === day.id)!.settled).toBe(true);
    const self = { id: uid(), date: '2026-11-10', purchaser: '小林母', items: 'テーピング', category: 'equipment' as const, amount: 880, funding: 'self' as const, receiptIds: [], review: [], createdAt: '' };
    d.expenses.push(self);
    settleSelfPaid(d, self.id);
    expect(() => settleSelfPaid(d, self.id)).toThrow();
  });
});

describe('月謝（家庭単位）', () => {
  it('回収期限・一部入金・未回収', () => {
    const d = emptyData();
    d.households = parseRoster('三浦 ゆい, 6年, 三浦母\n田中 はな, 6年, 田中母\n田中 こころ, 3年\n佐藤 りん 6年 佐藤父', null);
    expect(d.households.map((h) => `${h.name}:${h.children.length}`)).toEqual(['三浦家:1', '田中家:2', '佐藤家:1']);
    expect(d.households[2].guardian).toBe('佐藤父');
    const r = createBills(d, '2026-12');
    expect(r.created).toBe(0);
    expect(r.missing).toHaveLength(3); // 金額は要確認
    d.households.forEach((h) => (h.monthlyFee = 2000 * h.children.length));
    createBills(d, '2027-02', '2027-01-31');
    expect(d.bills[0].dueDate).toBe('2027-02-28');
    d.settings.feeDueRule = 'distributionMonthEnd';
    expect(feeDueDate(d, '2027-03')).toBe('2027-02-28');
    const b = d.bills[1];
    collectFee(d, b.id, 2000);
    expect(outstanding(b)).toBe(2000);
    expect(() => collectFee(d, b.id, 3000)).toThrow(/超えて/);
    const tx = collectFee(d, b.id, 2000);
    expect(outstanding(b)).toBe(0);
    voidTx(d, tx.id, '誤入力');
    expect(outstanding(b)).toBe(2000);
  });
});

describe('出納帳', () => {
  it('修正履歴・年度締め・CSV', () => {
    const d = sampleData();
    const t = addTx(d, { date: '2026-11-10', counterparty: 'A', amount: 100, direction: 'out', category: 'other', description: 'x' });
    editTx(d, t.id, { amount: 120 }, '訂正');
    expect(t.revisions[0].before.amount).toBe(100);
    d.settings.closedThrough = '2026-11-10';
    expect(() => voidTx(d, t.id, 'x')).toThrow(/締め/);
    expect(ledgerCsv(d, '2000-01-01', '2100-01-01').startsWith('﻿日付')).toBe(true);
    expect(transportCsv(d)).toContain('選手');
  });
});
