import type { ScheduleItem } from './scheduleParser';
import { guessYmd, normalizeText, toYmd, today } from './util';

/** スプレッドシート（Googleスプレッドシート・Excel）からコピーした表、または CSV を2次元配列に */
export function parseTable(input: string): string[][] {
  const text = input.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!text.trim()) return [];
  const sep = text.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

export type ColRole = 'date' | 'activity' | 'venue' | 'duty' | 'ignore';
export const COL_LABEL: Record<ColRole, string> = { date: '日付', activity: '活動名', venue: '会場', duty: '当番', ignore: '使わない' };

export interface Mapping { headerRow: number; cols: ColRole[] }

/** 日付として読めるか（読めない場合 null） */
export function parseDateCell(raw: string, base = today()): string | null {
  const s = normalizeText(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})/);
  if (m) return toYmd(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/^(\d{1,2})\s*[\/月.]\s*(\d{1,2})\s*日?/);
  if (m) return guessYmd(Number(m[1]), Number(m[2]), base);
  if (/^\d{5}$/.test(s)) {
    // Excel のシリアル値
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return toYmd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

/** 見出し行と列の役割を推測（画面で変更できる） */
export function guessMapping(rows: string[][]): Mapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i];
    const cols: ColRole[] = Array.from({ length: width }, (_, j) => {
      const h = (r[j] ?? '').replace(/\s/g, '');
      if (/日付|月日|日にち|^日$/.test(h)) return 'date';
      if (/当番|担当|係/.test(h)) return 'duty';
      if (/会場|場所|体育館/.test(h)) return 'venue';
      if (/活動|内容|予定|行事|練習|試合|イベント/.test(h)) return 'activity';
      return 'ignore';
    });
    if (cols.includes('date') && (cols.includes('duty') || cols.includes('activity'))) return { headerRow: i, cols };
  }
  // 見出しが無い場合: 日付が多い列を日付に、その右を活動に
  const score = Array.from({ length: width }, (_, j) => rows.filter((r) => parseDateCell(r[j] ?? '')).length);
  const dateCol = score.indexOf(Math.max(...score));
  const cols: ColRole[] = Array.from({ length: width }, (_, j) => (j === dateCol ? 'date' : 'ignore'));
  if (dateCol + 1 < width) cols[dateCol + 1] = 'activity';
  return { headerRow: -1, cols };
}

const splitNames = (s: string) =>
  normalizeText(s)
    .split(/[、,，・/／&＆\n]+|\s{1,}/)
    .map((x) => x.trim().replace(/(さん|様)$/, ''))
    .filter((x) => x && !/^(なし|無し|-|ー|－|―)$/.test(x));

/** 表 → 予定（空の日付セルは上の行の日付を引き継ぐ＝セル結合対応） */
export function tableToItems(rows: string[][], map: Mapping, base = today()): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  let lastDate: string | null = null;
  rows.forEach((r, i) => {
    if (i <= map.headerRow) return;
    const get = (role: ColRole) => map.cols.flatMap((c, j) => (c === role && r[j] ? [r[j]] : []));
    const dateRaw = get('date')[0] ?? '';
    const activity = get('activity').join(' ').trim();
    const venue = get('venue').join(' ').trim();
    const duties = get('duty').flatMap(splitNames);
    if (!activity && !venue && !duties.length && !dateRaw) return;
    const parsed = dateRaw ? parseDateCell(dateRaw, base) : lastDate;
    const review: string[] = [];
    if (dateRaw && !parsed) review.push(`日付「${dateRaw}」を読めません`);
    if (parsed) lastDate = parsed;
    if (/^(休み|オフ|なし|休)$/.test(activity) && !duties.length) return;
    if (!activity) review.push('活動名が空です');
    out.push({ date: parsed ?? '', activity: activity || '要確認', venue, duties, review });
  });
  return out;
}
