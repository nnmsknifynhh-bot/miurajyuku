import type { AppData, Member } from './types';
import { emptyData } from './defaults';
import { ensureFeeCharges, payFee } from './fees';
import { addTx } from './ledger';
import { newDuty, payDuty } from './duty';
import { buildDraft, parseCarSplit } from './carParser';
import { collectRider, ensureExpenses, newExpedition } from './expedition';
import { addDays, addMonths, monthOf, today, uid } from './util';

// 架空のサンプル名簿（実在の人物とは関係ありません）
const FAMILIES: [string, string, string][] = [
  ['三浦', 'ゆい', '6年'], ['田中', 'はな', '6年'], ['佐藤', 'りん', '6年'], ['鈴木', 'さくら', '5年'], ['高橋', 'みお', '5年'],
  ['伊藤', 'あおい', '5年'], ['渡辺', 'ひなた', '5年'], ['山本', 'ことね', '4年'], ['中村', 'ゆな', '4年'], ['小林', 'めい', '4年'],
  ['加藤', 'えま', '4年'], ['吉田', 'つむぎ', '3年'], ['山田', 'いろは', '3年'], ['佐々木', 'こはる', '3年'], ['山口', 'すず', '3年'],
  ['松本', 'あかり', '2年'], ['井上', 'ひまり', '2年'], ['木村', 'のあ', '2年'], ['林', 'みゆ', '1年'], ['清水', 'りこ', '1年'],
];

export const SAMPLE_CAR_TEXT = `11/23(月・祝) 練習試合 車割り
場所: 市民体育館

🚗三浦車（運転：三浦父）
・三浦 ゆい
・田中 はな、田中母
・佐藤 りん

🚗鈴木車
運転手 鈴木母
鈴木 さくら、高橋 みお、伊藤 あおい
鈴木弟

🚗山本車(山本母運転)
・山本 ことね
・中村 ゆな
・小林めい
・ゆい

よろしくお願いします！`;

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 予定表のサンプル（今日から1〜2週間後） */
export function sampleScheduleText(base = today()): string {
  return [
    `${md(addDays(base, 8))} 練習 当番：田中母、佐藤母`,
    `${md(addDays(base, 9))} 練習 当番：鈴木母`,
    `${md(addDays(base, 14))} 練習試合 当番：高橋母・伊藤母 1500円`,
    `${md(addDays(base, 15))} 休み`,
  ].join('\n');
}

/** サンプルデータの当番（明日・6日後）に対する変更連絡 */
export function sampleChangeText(base = today()): string {
  return `${md(addDays(base, 1))}の当番 佐藤母→山本母に変更になりました。\n${md(addDays(base, 6))} 練習試合は中止です。`;
}

export function sampleData(): AppData {
  const d = emptyData();
  const t = today();
  d.settings.recorderName = '会計係（サンプル）';
  d.settings.feeStartMonth = addMonths(monthOf(t), -1);
  d.members = FAMILIES.map(([sn, gn, grade]): Member => ({ id: uid('m_'), name: `${sn} ${gn}`, grade, guardian: `${sn}母`, monthlyFee: 2000, active: true }));
  addTx(d, { date: `${d.settings.feeStartMonth}-01`, counterparty: '前年度より', amount: 45000, direction: 'in', category: 'opening', description: '前年度繰越金', sourceKey: 'opening:sample' });
  ensureFeeCharges(d, t);
  // 先月分は数名を除き入金済み、今月分は半分入金済み
  const prev = d.settings.feeStartMonth;
  d.fees.filter((f) => f.month === prev).forEach((f, i) => i % 7 !== 3 && payFee(d, f.id, `${prev}-15`));
  d.fees.filter((f) => f.month === monthOf(t)).forEach((f, i) => i % 2 === 0 && payFee(d, f.id, t));

  // 遠征（今日から8日後）: 車割りサンプルから作成
  const exp = newExpedition(addDays(t, 8));
  const draft = buildDraft(parseCarSplit(SAMPLE_CAR_TEXT), d.members);
  exp.title = '練習試合';
  exp.destination = '市民体育館';
  exp.cars = draft.cars.map(({ issues: _i, ...c }) => c);
  // サンプルなので重複「ゆい」を外す
  exp.cars[2].riders = exp.cars[2].riders.filter((r) => r.name !== 'ゆい');
  exp.perPerson = 500;
  ensureExpenses(exp);
  d.expeditions.push(exp);
  collectRider(d, exp.id, exp.cars[0].riders[1].id);

  // 終了済み遠征（精算待ち）
  const past = newExpedition(addDays(t, -3));
  past.title = '交流大会';
  past.destination = '県立総合体育館';
  past.rule = { collectTransport: false, reimburseGas: true, reimburseToll: true, reimburseParking: false, reimburseOther: false, note: '高速代とガソリン代のみ精算' };
  past.cars = buildDraft(parseCarSplit('🚗田中車（運転：田中父）\n田中 はな、佐藤 りん\n🚗渡辺車（運転：渡辺母）\n渡辺 ひなた、山田 いろは'), d.members).cars.map(({ issues: _i, ...c }) => c);
  ensureExpenses(past);
  past.expenses.filter((x) => x.type === 'gas').forEach((x) => (x.estimate = 1680));
  d.expeditions.push(past);

  // 当番
  const d1 = newDuty(addDays(t, 1), '練習', ['田中母', '佐藤母'], 1000);
  const d2 = newDuty(addDays(t, 6), '練習試合', ['高橋母'], 1500);
  const d3 = newDuty(addDays(t, -2), '練習', ['山本母'], 1000);
  d.duties.push(d1, d2, d3);
  payDuty(d, d3.id, d3.assignees[0].id, addDays(t, -3));
  return d;
}
