// 日本の祝日（振替休日・国民の休日もふくむ）を計算で求める。毎年の入力はいらない
// 春分・秋分は 1980〜2099年の近似式（国立天文台の発表とほぼ同じ）
const cache = new Map(); // 年 -> Set('YYYY-MM-DD')
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const wd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const nthMonday = (y, m, n) => { const first = wd(y, m, 1); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const list = [];
  const add = (m, d) => list.push(ymd(y, m, d));
  add(1, 1);                          // 元日
  add(1, nthMonday(y, 1, 2));         // 成人の日
  add(2, 11);                         // 建国記念の日
  if (y >= 2020) add(2, 23);          // 天皇誕生日
  add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))); // 春分の日
  add(4, 29);                         // 昭和の日
  add(5, 3); add(5, 4); add(5, 5);    // 憲法記念日・みどりの日・こどもの日
  add(7, nthMonday(y, 7, 3));         // 海の日
  add(8, 11);                         // 山の日
  add(9, nthMonday(y, 9, 3));         // 敬老の日
  add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))); // 秋分の日
  add(10, nthMonday(y, 10, 2));       // スポーツの日
  add(11, 3);                         // 文化の日
  add(11, 23);                        // 勤労感謝の日
  const set = new Set(list);
  // 国民の休日：祝日にはさまれた平日
  for (const day of [...set].sort()) {
    const d2 = new Date(day + 'T00:00:00Z'); d2.setUTCDate(d2.getUTCDate() + 2);
    const mid = new Date(day + 'T00:00:00Z'); mid.setUTCDate(mid.getUTCDate() + 1);
    const m = mid.toISOString().slice(0, 10);
    if (set.has(d2.toISOString().slice(0, 10)) && !set.has(m) && mid.getUTCDay() !== 0) set.add(m);
  }
  // 振替休日：祝日が日曜日なら、そのあとの最初の祝日でない日
  for (const day of [...set].sort()) {
    const d = new Date(day + 'T00:00:00Z');
    if (d.getUTCDay() !== 0) continue;
    do d.setUTCDate(d.getUTCDate() + 1); while (set.has(d.toISOString().slice(0, 10)));
    set.add(d.toISOString().slice(0, 10));
  }
  cache.set(y, set);
  return set;
}
/** その日（'YYYY-MM-DD'）が祝日・振替休日・国民の休日か */
function isHoliday(day) { return holidaysOf(Number(day.slice(0, 4))).has(day); }
module.exports = { isHoliday, holidaysOf };
