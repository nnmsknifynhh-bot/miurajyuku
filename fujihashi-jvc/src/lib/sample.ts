import type { AppData, Household } from './types';
import { emptyData } from './defaults';
import { createBills, collectFee } from './fees';
import { addTx } from './ledger';
import { parseCarSplit } from './carParser';
import { applyScheduleChange, carsFromParsed, collectFare, diffSchedule, handPrep, syncDriverPayments } from './day';
import { rosterPeople } from './roster';
import { addDays, addMonths, monthOf, today, uid } from './util';
import { parseScheduleText as parseSchedule } from './scheduleParser';
import { isWeekendOrHoliday } from './holidays';

// 架空のサンプル（実在の人物とは関係ありません）
const FAMILIES: [string, string[], string][] = [
  ['三浦', ['ゆい:6年'], '三浦母'], ['田中', ['はな:6年', 'こころ:3年'], '田中母'], ['佐藤', ['りん:6年'], '佐藤父'],
  ['鈴木', ['さくら:5年'], '鈴木母'], ['高橋', ['みお:5年'], '高橋母'], ['伊藤', ['あおい:5年'], '伊藤母'],
  ['渡辺', ['ひなた:4年'], '渡辺母'], ['山本', ['ことね:4年'], '山本母'], ['中村', ['ゆな:4年'], '中村母'],
  ['小林', ['めい:3年'], '小林母'], ['加藤', ['えま:3年'], '加藤母'], ['吉田', ['つむぎ:2年'], '吉田母'],
];

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 今日以降の土日を n 個 */
function nextWeekendDays(n: number, base = today()): string[] {
  const out: string[] = [];
  for (let i = 1; out.length < n && i < 60; i++) {
    const d = addDays(base, i);
    if (isWeekendOrHoliday(d)) out.push(d);
  }
  return out;
}

export function sampleScheduleText(base = today()): string {
  const [a, b, c, e] = nextWeekendDays(4, base);
  return [
    `${md(a)} 練習 @藤橋小体育館 当番：田中母、佐藤父`,
    `${md(b)} 練習試合 @市民体育館 当番：鈴木母`,
    `${md(b)} 午後 合同練習 @市民体育館`,
    `${md(c)} 県大会 @県立総合体育館 当番：高橋母・伊藤母`,
    `${md(e)} 休み`,
  ].join('\n');
}

export function sampleCarText(base = today()): string {
  const b = nextWeekendDays(2, base)[1];
  return `${md(b)} 練習試合 配車
🚗三浦車（運転：三浦母）
・三浦 ゆい
・田中 はな、田中 こころ
・田中母
🚗佐藤車（運転：佐藤父）先野コーチ同乗
佐藤 りん、鈴木 さくら、高橋 みお
🚗伊藤車（伊藤母運転）
・伊藤 あおい
・渡辺 ひなた
・ゆい`;
}

export function sampleData(): AppData {
  const d = emptyData();
  const t = today();
  d.settings.recorderName = '会計係（サンプル）';
  d.settings.prepDefault = 3000;
  d.settings.monthlyFeeDefault = 2000;
  d.households = FAMILIES.map(([sn, kids, g]): Household => ({
    id: uid('h_'),
    name: `${sn}家`,
    guardian: g,
    monthlyFee: 2000 * kids.length,
    active: true,
    children: kids.map((k) => ({ id: uid('c_'), name: `${sn} ${k.split(':')[0]}`, grade: k.split(':')[1] })),
  }));
  addTx(d, { date: `${monthOf(addMonths(monthOf(t), -1))}-01`, counterparty: '前年度より', amount: 45000, direction: 'in', category: 'opening', description: '前年度繰越金', sourceKey: 'opening:sample' });

  // 今月分の月謝（先月末に配布）
  const cur = monthOf(t);
  const distributed = addDays(`${cur}-01`, -1);
  createBills(d, cur, distributed);
  d.bills.forEach((b, i) => i % 3 !== 0 && collectFee(d, b.id, b.amount, t));
  const partial = d.bills.find((b) => b.collections.length === 0 && b.amount > 2000);
  if (partial) collectFee(d, partial.id, 2000, t);

  // 予定表 → 会計ページ
  for (const c of diffSchedule(d, parseSchedule(sampleScheduleText(t), t))) applyScheduleChange(d, c);

  // 2つ目の活動日に配車を登録（高速利用あり）
  const day = d.days.sort((a, b) => a.date.localeCompare(b.date))[1];
  if (day) {
    const r = carsFromParsed(parseCarSplit(sampleCarText(t), t), rosterPeople(d), d.settings.referencePerson);
    day.cars = r.cars;
    day.cars[2].riders = day.cars[2].riders.filter((x) => x.name !== 'ゆい'); // サンプルの重複を解消
    day.usesHighway = true;
    day.driverPay.refCarId = r.refCarId;
    syncDriverPayments(day);
    collectFare(d, day.id, day.cars[0].riders[1].id, t);
    handPrep(d, day.id, day.duties[0].id, t);
  }
  return d;
}

