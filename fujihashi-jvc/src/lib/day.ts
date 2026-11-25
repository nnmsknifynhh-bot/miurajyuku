import type { AppData, Car, DayPage, Rider, Role, Settings } from './types';
import { addTx, AppError } from './ledger';
import { classify, compact, matchPeople, type CarSplitResult, type RosterPerson } from './carParser';
import type { ScheduleItem } from './scheduleParser';
import { fmtDate, nowIso, today, uid } from './util';

export const ROLE_LABEL: Record<Role, string> = { driver: '運転手', player: '選手', parent: '帯同保護者', other: 'その他（要確認）' };

export function newDay(date: string): DayPage {
  return { id: uid('day_'), date, activities: [], duties: [], usesHighway: null, cars: [], driverPay: { confirmed: false, payments: [] }, review: [], history: [{ at: nowIso(), text: '作成' }] };
}

export function dayTitle(day: DayPage): string {
  return day.activities.map((a) => a.name).filter(Boolean).join('・') || '活動';
}

// ---------- 交通費（集金） ----------

/** 規定の集金額。高速利用が未確認なら null（要確認） */
export function defaultFare(s: Settings, day: DayPage, role: Role): number | null {
  if (role === 'driver') return s.fareDriver;
  if (day.usesHighway === null) return null;
  if (!day.usesHighway) return s.fareNoHighway;
  if (role === 'player') return s.fareHighwayPlayer;
  if (role === 'parent') return s.fareHighwayParent;
  return null; // その他は要確認
}

export function riderFare(s: Settings, day: DayPage, r: Rider): number | null {
  return r.amountOverride ?? defaultFare(s, day, r.role);
}

export function allRiders(day: DayPage): { car: Car; r: Rider }[] {
  return day.cars.flatMap((car) => car.riders.map((r) => ({ car, r })));
}

export function fareStats(s: Settings, day: DayPage) {
  let expected = 0;
  let got = 0;
  const unpaid: { car: Car; r: Rider; fare: number }[] = [];
  const unknown: Rider[] = [];
  for (const { car, r } of allRiders(day)) {
    const f = riderFare(s, day, r);
    if (f === null) {
      unknown.push(r);
      continue;
    }
    if (f <= 0) continue;
    expected += f;
    if (r.txId) got += f;
    else unpaid.push({ car, r, fare: f });
  }
  return { expected, got, unpaid, unknown };
}

export function collectFare(d: AppData, dayId: string, riderId: string, date = today()) {
  const day = d.days.find((x) => x.id === dayId);
  const found = day && allRiders(day).find((x) => x.r.id === riderId);
  if (!day || !found) throw new AppError('メンバーが見つかりません');
  const { r } = found;
  if (r.txId) throw new AppError('すでに集金済みです');
  const fare = riderFare(d.settings, day, r);
  if (fare === null) throw new AppError('集金額が未確定です（高速利用の有無か個別金額を設定してください）');
  if (fare <= 0) throw new AppError('集金額が0円です');
  const tx = addTx(d, {
    date,
    counterparty: r.name,
    amount: fare,
    direction: 'in',
    category: 'transport',
    description: `${fmtDate(day.date)} ${dayTitle(day)} 交通費`,
    related: { kind: 'day', id: day.id, subId: r.id },
    sourceKey: `fare:${day.id}:${r.id}`,
  });
  r.txId = tx.id;
  return tx;
}

// ---------- 運転手への支払い ----------

export function drivers(day: DayPage): string[] {
  return [...new Set(day.cars.flatMap((c) => c.riders.filter((r) => r.role === 'driver').map((r) => r.name)).filter(Boolean))];
}

/** 基準車両で確定した ガソリン代＋往復高速代 を全運転手に同額 */
export function driverBase(day: DayPage): number | null {
  const p = day.driverPay;
  if (!p.confirmed || p.gasYen === undefined) return null;
  return (p.gasYen ?? 0) + (p.tollRoundTripYen ?? 0);
}

/** 運転手リストと支払い行を同期（既存の支払い記録は消さない） */
export function syncDriverPayments(day: DayPage) {
  for (const name of drivers(day)) {
    if (!day.driverPay.payments.some((p) => compact(p.driverName) === compact(name))) day.driverPay.payments.push({ id: uid('dp_'), driverName: name });
  }
  day.driverPay.payments = day.driverPay.payments.filter((p) => p.txId || drivers(day).some((n) => compact(n) === compact(p.driverName)));
}

export function payDriver(d: AppData, dayId: string, paymentId: string, date = today()) {
  const day = d.days.find((x) => x.id === dayId);
  const p = day?.driverPay.payments.find((x) => x.id === paymentId);
  if (!day || !p) throw new AppError('支払い先が見つかりません');
  if (p.txId) throw new AppError('すでに支払い済みです');
  const amount = p.amountOverride ?? driverBase(day);
  if (amount === null) throw new AppError('基準車両のガソリン代・高速代を確定してください');
  const tx = addTx(d, {
    date,
    counterparty: p.driverName,
    amount,
    direction: 'out',
    category: 'driver',
    description: `${fmtDate(day.date)} ${dayTitle(day)} 運転手交通費`,
    related: { kind: 'day', id: day.id, subId: p.id },
    sourceKey: `driver:${day.id}:${p.id}`,
  });
  p.txId = tx.id;
  return tx;
}

// ---------- 当番準備金 ----------

export function handPrep(d: AppData, dayId: string, dutyId: string, date = today()) {
  const day = d.days.find((x) => x.id === dayId);
  const du = day?.duties.find((x) => x.id === dutyId);
  if (!day || !du) throw new AppError('当番が見つかりません');
  if (du.handedTxId) throw new AppError('すでに渡しています');
  if (du.amount === null || du.amount <= 0) throw new AppError('準備金の金額を入力してください');
  const tx = addTx(d, {
    date,
    counterparty: du.name,
    amount: du.amount,
    direction: 'out',
    category: 'prep',
    description: `${fmtDate(day.date)} ${dayTitle(day)} 当番準備金`,
    related: { kind: 'day', id: day.id, subId: du.id },
    sourceKey: `prep:${day.id}:${du.id}`,
  });
  du.handedTxId = tx.id;
  return tx;
}

// ---------- 配車表の取り込み ----------

export interface CarDraftResult { cars: Car[]; issues: string[]; date?: string; refCarId?: string }

/** 解析結果を名簿と照合し、運転手・選手・帯同保護者に分類。指導者（基準車両の目印）は集金0円 */
export function carsFromParsed(r: CarSplitResult, people: RosterPerson[], referencePerson = ''): CarDraftResult {
  const issues: string[] = [];
  let refCarId: string | undefined;
  const cars: Car[] = r.cars.map((c) => {
    const riders: Rider[] = [];
    const carId = uid('car_');
    if (c.driver) riders.push(makeRider(c.driver, 'driver', people, issues, c.name));
    else issues.push(`${c.name}: 運転手が読み取れません（要確認）`);
    for (const p of c.riders) {
      if (referencePerson && p.name.includes(referencePerson)) {
        refCarId = carId;
        riders.push({ id: uid('r_'), name: p.name.replace(/(が)?同乗$/, ''), role: 'other', amountOverride: 0 });
        continue;
      }
      const k = p.kind;
      const role: Role = k === 'child' ? 'player' : k === 'adult' ? 'parent' : 'other';
      riders.push(makeRider(p.name, role, people, issues, c.name, k));
    }
    return { id: carId, name: c.name, riders };
  });
  issues.push(...duplicateIssues(cars));
  if (referencePerson && !refCarId) issues.push(`${referencePerson}さんが乗る基準車両が読み取れません（運転手への支払い欄で選んでください）`);
  return { cars, issues, date: r.date, refCarId };
}

function makeRider(name: string, role: Role, people: RosterPerson[], issues: string[], carName: string, kind = classify(name).kind): Rider {
  const r: Rider = { id: uid('r_'), name, role };
  if (role === 'driver' || role === 'parent') {
    const fam = matchPeople(name, 'adult', people);
    if (fam.length >= 1) r.householdId = fam[0].householdId;
    return r;
  }
  const m = matchPeople(name, kind, people);
  if (m.length === 1 && compact(m[0].name).includes(compact(name).replace(/(兄|姉|弟|妹)$/, ''))) {
    r.childId = m[0].id;
    r.householdId = m[0].householdId;
    r.role = 'player'; // 名簿にいる兄弟も選手として1人ずつ
  } else if (m.length > 1) issues.push(`${carName}: 「${name}」が名簿の複数人（${m.map((x) => x.name).join('・')}）に該当（要確認）`);
  else if (role === 'player') issues.push(`${carName}: 「${name}」は名簿に見つかりません（要確認）`);
  else if (role === 'other') issues.push(`${carName}: 「${name}」の分類（選手か同乗者か）を確認してください`);
  return r;
}

/** 同じ日に同じ人が2回登録されていないか */
export function duplicateIssues(cars: Car[]): string[] {
  const seen = new Map<string, string[]>();
  for (const c of cars)
    for (const r of c.riders) {
      const key = r.childId ?? compact(r.name);
      if (!key) continue;
      seen.set(key, [...(seen.get(key) ?? []), `${c.name}(${r.name})`]);
    }
  return [...seen.values()].filter((v) => v.length > 1).map((v) => `重複: ${v.join('、')}`);
}

// ---------- 予定表の反映（既存の会計記録は消さない） ----------

export type ScheduleChange =
  | { kind: 'newDay'; date: string; items: ScheduleItem[] }
  | { kind: 'addActivity'; dayId: string; date: string; name: string; venue: string }
  | { kind: 'venue'; dayId: string; date: string; activityId: string; name: string; from: string; to: string }
  | { kind: 'addDuty'; dayId: string; date: string; name: string }
  | { kind: 'missingDuty'; dayId: string; date: string; dutyId: string; name: string; paid: boolean }
  | { kind: 'missingActivity'; dayId: string; date: string; name: string };

export function diffSchedule(d: AppData, items: ScheduleItem[]): ScheduleChange[] {
  const byDate = new Map<string, ScheduleItem[]>();
  for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  const out: ScheduleChange[] = [];
  for (const [date, its] of [...byDate].sort()) {
    const day = d.days.find((x) => x.date === date);
    if (!day) {
      out.push({ kind: 'newDay', date, items: its });
      continue;
    }
    for (const it of its) {
      const a = day.activities.find((x) => compact(x.name) === compact(it.activity));
      if (!a) out.push({ kind: 'addActivity', dayId: day.id, date, name: it.activity, venue: it.venue });
      else if (it.venue && compact(a.venue) !== compact(it.venue)) out.push({ kind: 'venue', dayId: day.id, date, activityId: a.id, name: a.name, from: a.venue, to: it.venue });
    }
    const names = its.flatMap((i) => i.duties);
    for (const n of names) if (!day.duties.some((x) => !x.cancelled && compact(x.name) === compact(n))) out.push({ kind: 'addDuty', dayId: day.id, date, name: n });
    for (const du of day.duties) if (!du.cancelled && !names.some((n) => compact(n) === compact(du.name))) out.push({ kind: 'missingDuty', dayId: day.id, date, dutyId: du.id, name: du.name, paid: !!du.handedTxId });
    for (const a of day.activities) if (!its.some((i) => compact(i.activity) === compact(a.name))) out.push({ kind: 'missingActivity', dayId: day.id, date, name: a.name });
  }
  return out;
}

export function applyScheduleChange(d: AppData, c: ScheduleChange) {
  const at = nowIso();
  if (c.kind === 'newDay') {
    const day = newDay(c.date);
    for (const it of c.items) {
      if (!day.activities.some((a) => compact(a.name) === compact(it.activity))) day.activities.push({ id: uid('a_'), name: it.activity, venue: it.venue });
      for (const n of it.duties) if (!day.duties.some((x) => compact(x.name) === compact(n))) day.duties.push({ id: uid('du_'), name: n, amount: d.settings.prepDefault });
      for (const rv of it.review) day.review.push(`${it.activity}: ${rv}`);
    }
    day.history.push({ at, text: '予定表から作成' });
    d.days.push(day);
    return;
  }
  const day = d.days.find((x) => x.id === c.dayId);
  if (!day) return;
  if (c.kind === 'addActivity') day.activities.push({ id: uid('a_'), name: c.name, venue: c.venue });
  if (c.kind === 'venue') day.activities.find((a) => a.id === c.activityId)!.venue = c.to;
  if (c.kind === 'addDuty') day.duties.push({ id: uid('du_'), name: c.name, amount: d.settings.prepDefault });
  if (c.kind === 'missingDuty') {
    const du = day.duties.find((x) => x.id === c.dutyId)!;
    du.cancelled = true; // 記録は残す
    if (du.handedTxId) day.review.push(`${du.name} は予定表から外れましたが準備金を渡し済みです（返金を確認）`);
  }
  if (c.kind === 'missingActivity') day.review.push(`予定表から「${c.name}」が消えています（中止か確認）`);
  day.history.push({ at, text: `予定表の変更を反映: ${describeChange(c)}` });
}

export function describeChange(c: ScheduleChange): string {
  switch (c.kind) {
    case 'newDay':
      return `${fmtDate(c.date)} の会計ページを新規作成（${c.items.map((i) => i.activity).join('・')}）`;
    case 'addActivity':
      return `${fmtDate(c.date)} に活動「${c.name}」を追加`;
    case 'venue':
      return `${fmtDate(c.date)} ${c.name} の会場: ${c.from || '未設定'} → ${c.to}`;
    case 'addDuty':
      return `${fmtDate(c.date)} の当番に ${c.name} を追加`;
    case 'missingDuty':
      return `${fmtDate(c.date)} の当番 ${c.name} が予定表にありません → 取消扱い${c.paid ? '（準備金渡し済み・記録は保持）' : ''}`;
    case 'missingActivity':
      return `${fmtDate(c.date)} の「${c.name}」が予定表にありません（要確認メモを追加）`;
  }
}
