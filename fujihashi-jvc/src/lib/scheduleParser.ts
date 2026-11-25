import { guessYmd, normalizeText, today } from './util';

/** 予定表の1活動（AI・テキスト解析の共通形） */
export interface ScheduleItem {
  date: string;
  activity: string;
  venue: string;
  duties: string[];
  /** 読み取れなかった・不確かな項目（推測しない） */
  review: string[];
}

const DATE_RE = /(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*(?:\([^)]*\))?/;
const cleanName = (s: string) => s.trim().replace(/(さん|様)$/, '').trim();

function splitNames(s: string): string[] {
  return s.split(/[、,，・/／&＆\s]+/).map(cleanName).filter((x) => x && !/^(なし|無し|-|ー)$/.test(x));
}

/** 予定表テキスト（1行1活動）を端末内で解析。無料・オフライン */
export function parseScheduleText(input: string, base = today()): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  let lastDate = '';
  for (const raw of normalizeText(input).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const dm = line.match(DATE_RE);
    if (!dm && !lastDate) continue;
    const date = dm ? guessYmd(Number(dm[1]), Number(dm[2]), base) : lastDate;
    lastDate = date;
    let rest = dm ? line.slice((dm.index ?? 0) + dm[0].length).trim() : line.replace(/^[・\-\s]+/, '');
    const review: string[] = [];
    let duties: string[] = [];
    const tm = rest.match(/当番\s*[:は]?\s*(.*)$/);
    if (tm) {
      duties = splitNames(tm[1].replace(/[\d,]+\s*円/, ''));
      rest = rest.slice(0, tm.index).trim();
    }
    let venue = '';
    const vm = rest.match(/(?:@|＠|会場\s*[:は]?|場所\s*[:は]?)\s*([^\s].*?)$/) ?? rest.match(/[(（]([^)）]+)[)）]\s*$/);
    if (vm) {
      venue = vm[1].trim();
      rest = rest.slice(0, vm.index).trim();
    }
    const activity = rest.replace(/^[\s:\-|]+|[\s:\-|]+$/g, '').replace(/\s+/g, ' ');
    if (/^(休み|オフ|なし)$/.test(activity) && !duties.length) continue;
    if (!activity) review.push('活動名');
    if (/[?？□■]/.test(line)) review.push('読み取れない文字');
    out.push({ date, activity: activity || '要確認', venue, duties, review });
  }
  return out;
}
