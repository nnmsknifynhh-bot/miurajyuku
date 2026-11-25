// 日本の祝日（内閣府の規則に基づく計算。2000〜2099年）。臨時の変更は「活動日を手動追加」で対応。
const cache = new Map<number, Map<string, string>>();
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(y, m - 1, 1).getDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

export function holidaysOf(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const h = new Map<string, string>();
  const add = (m: number, d: number, name: string) => h.set(ymd(y, m, d), name);
  add(1, 1, '元日');
  add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthMonday(y, 7, 3), '海の日');
  if (y >= 2016) add(8, 11, '山の日');
  add(9, nthMonday(y, 9, 3), '敬老の日');
  add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '秋分の日');
  add(10, nthMonday(y, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  // 国民の休日（祝日に挟まれた平日）
  for (const [k] of [...h]) {
    const d = new Date(k + 'T00:00:00');
    d.setDate(d.getDate() + 2);
    const k2 = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    d.setDate(d.getDate() - 1);
    const mid = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (h.has(k2) && !h.has(mid) && d.getDay() !== 0) h.set(mid, '国民の休日');
  }
  // 振替休日
  for (const [k] of [...h].sort()) {
    const d = new Date(k + 'T00:00:00');
    if (d.getDay() !== 0) continue;
    do d.setDate(d.getDate() + 1);
    while (h.has(ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())));
    h.set(ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()), '振替休日');
  }
  cache.set(y, h);
  return h;
}

export function holidayName(date: string): string | undefined {
  return holidaysOf(Number(date.slice(0, 4))).get(date);
}

/** 土曜・日曜・祝日か */
export function isWeekendOrHoliday(date: string): boolean {
  const w = new Date(date + 'T00:00:00').getDay();
  return w === 0 || w === 6 || !!holidayName(date);
}

export function dayLabel(date: string): string {
  const w = new Date(date + 'T00:00:00').getDay();
  const hn = holidayName(date);
  return hn ? hn : w === 0 ? '日曜' : w === 6 ? '土曜' : '平日';
}
