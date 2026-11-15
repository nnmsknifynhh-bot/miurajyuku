import { describe, expect, it } from 'vitest';
import { buildDraft, parseCarSplit } from '../src/lib/carParser';
import { parseDutyChanges, parseScheduleText } from '../src/lib/scheduleParser';
import { SAMPLE_CAR_TEXT, sampleChangeText, sampleData, sampleScheduleText } from '../src/lib/sample';
import { addTx, balance, editTx, voidTx } from '../src/lib/ledger';
import { ensureFeeCharges, payFee, unpaidFees } from '../src/lib/fees';
import { calcGas } from '../src/lib/gas';
import { collectRider, settleExpense, confirmExpense } from '../src/lib/expedition';
import { cancelDuty, newDuty, payDuty, replaceAssignee } from '../src/lib/duty';
import { computeReminders } from '../src/lib/reminders';
import { ledgerCsv } from '../src/lib/csv';

describe('車割り解析', () => {
  it('サンプル文章から日付・車・運転手・乗車メンバーを抽出', () => {
    const r = parseCarSplit(SAMPLE_CAR_TEXT, '2026-11-15');
    expect(r.date).toBe('2026-11-23');
    expect(r.destination).toBe('市民体育館');
    expect(r.cars.map((c) => c.name)).toEqual(['三浦車', '鈴木車', '山本車']);
    expect(r.cars.map((c) => c.driver)).toEqual(['三浦父', '鈴木母', '山本母']);
    expect(r.cars[0].riders.map((x) => x.name)).toEqual(['三浦 ゆい', '田中 はな', '田中母', '佐藤 りん']);
    expect(r.cars[0].riders[2]).toMatchObject({ kind: 'adult', relation: '母' });
    expect(r.cars[1].riders.find((x) => x.name === '鈴木弟')).toMatchObject({ kind: 'sibling', relation: '弟' });
    expect(r.cars[2].riders.map((x) => x.name)).toContain('小林めい');
  });

  it('名簿照合・重複と不明名の確認', () => {
    const d = sampleData();
    const draft = buildDraft(parseCarSplit(SAMPLE_CAR_TEXT, '2026-11-15'), d.members);
    const msgs = draft.issues.map((i) => i.message).join('\n');
    expect(msgs).toContain('ゆい');
    // 運転手は免除（集金対象外）が初期値
    expect(draft.cars[0].riders[0]).toMatchObject({ isDriver: true, collect: false, name: '三浦父' });
    expect(draft.cars[0].riders[1].memberId).toBeTruthy();
    const kobayashi = draft.cars[2].riders.find((r) => r.name === '小林めい');
    expect(kobayashi?.memberId).toBeTruthy();
  });

  it('いろいろな書式', () => {
    const r = parseCarSplit('12月7日 遠征\n①佐藤車 運転:佐藤パパ\nりん・はな・ゆい\n②田中号車\n(田中母運転)\nはな\n田中姉', '2026-11-15');
    expect(r.date).toBe('2026-12-07');
    expect(r.cars[0]).toMatchObject({ name: '佐藤車', driver: '佐藤パパ' });
    expect(r.cars[0].riders.map((x) => x.name)).toEqual(['りん', 'はな', 'ゆい']);
    expect(r.cars[1].name).toBe('田中号車');
    expect(r.cars[1].driver).toBe('田中母');
    expect(r.cars[1].riders.map((x) => x.kind)).toEqual(['child', 'sibling']);
  });
});

describe('予定表・変更連絡', () => {
  it('予定表テキスト', () => {
    const r = parseScheduleText(sampleScheduleText('2026-11-14'), '2026-11-15');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ date: '2026-11-22', activity: '練習', names: ['田中母', '佐藤母'] });
    expect(r[2]).toMatchObject({ amount: 1500, names: ['高橋母', '伊藤母'], activity: '練習試合' });
  });
  it('変更連絡', () => {
    const r = parseDutyChanges(sampleChangeText('2026-11-23'), [], '2026-11-15');
    expect(r[0]).toEqual({ type: 'replace', date: '2026-11-24', from: '佐藤母', to: '山本母' });
    expect(r[1]).toMatchObject({ type: 'cancel', date: '2026-11-29' });
  });
});

describe('出納帳・二重計上防止', () => {
  it('部費入金は二重計上できず、取消で未払いに戻る', () => {
    const d = sampleData();
    const f = unpaidFees(d)[0];
    const before = balance(d);
    const tx = payFee(d, f.id);
    expect(balance(d)).toBe(before + f.amount);
    expect(() => payFee(d, f.id)).toThrow();
    expect(() => addTx(d, { counterparty: 'x', amount: f.amount, direction: 'in', category: 'fee', description: '', sourceKey: `fee:${f.id}` })).toThrow(/二重/);
    voidTx(d, tx.id, '誤入力');
    expect(d.fees.find((x) => x.id === f.id)!.txId).toBeUndefined();
    expect(balance(d)).toBe(before);
    payFee(d, f.id); // 取消後は再記録できる
    expect(ensureFeeCharges(d)).toBe(0);
  });
  it('修正履歴と年度締め', () => {
    const d = sampleData();
    const t = addTx(d, { date: '2026-11-10', counterparty: 'A', amount: 100, direction: 'out', category: 'other', description: 'x' });
    editTx(d, t.id, { amount: 120 }, '金額訂正');
    expect(t.revisions[0].before.amount).toBe(100);
    d.settings.closedThrough = '2026-11-10';
    expect(() => voidTx(d, t.id, 'x')).toThrow(/締め/);
  });
  it('CSV出力', () => {
    const d = sampleData();
    const csv = ledgerCsv(d, '2000-01-01', '2100-01-01');
    expect(csv.startsWith('﻿日付')).toBe(true);
  });
});

describe('遠征・当番', () => {
  it('ガソリン代 A/B', () => {
    expect(calcGas({ distanceKm: 42, roundTrip: true, method: 'perKm', yenPerKm: 20, kmPerL: 0, yenPerL: 0 }).result).toBe(1680);
    expect(calcGas({ distanceKm: 60, roundTrip: false, method: 'fuel', yenPerKm: 0, kmPerL: 12, yenPerL: 175 }).result).toBe(875);
  });
  it('集金と精算', () => {
    const d = sampleData();
    const e = d.expeditions[0];
    const target = e.cars[1].riders.find((r) => r.collect)!;
    collectRider(d, e.id, target.id);
    expect(() => collectRider(d, e.id, target.id)).toThrow();
    const driver = e.cars[0].riders[0];
    expect(() => collectRider(d, e.id, driver.id)).toThrow(/集金対象/);
    const ex = e.expenses.find((x) => x.type === 'toll')!;
    expect(() => settleExpense(d, e.id, ex.id)).toThrow(/確定/);
    confirmExpense(e, ex, 1200);
    settleExpense(d, e.id, ex.id);
    expect(() => confirmExpense(e, ex, 1300)).toThrow();
  });
  it('支払い済み当番の交代・中止は確認を求める', () => {
    const d = sampleData();
    const du = newDuty('2026-11-22', '練習', ['田中母'], 1000);
    d.duties.push(du);
    payDuty(d, du.id, du.assignees[0].id);
    expect(() => replaceAssignee(d, du.id, du.assignees[0].id, '佐藤母')).toThrow('NEEDS_CONFIRM');
    const bal = balance(d);
    replaceAssignee(d, du.id, du.assignees[0].id, '佐藤母', 'refund');
    expect(balance(d)).toBe(bal + 1000);
    expect(du.assignees.filter((a) => a.status === 'active').map((a) => a.name)).toEqual(['佐藤母']);
    cancelDuty(d, du.id);
    expect(du.cancelled).toBe(true);
  });
  it('リマインド', () => {
    const d = sampleData();
    const kinds = new Set(computeReminders(d).map((r) => r.kind));
    expect(kinds.has('fee')).toBe(true);
    expect(kinds.has('duty')).toBe(true);
    expect(kinds.has('settle')).toBe(true);
  });
});
