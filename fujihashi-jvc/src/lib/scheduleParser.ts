import type { Duty } from './types';
import { guessYmd, normalizeText, today } from './util';

export interface ParsedDuty { date: string; activity: string; names: string[]; amount?: number }

export type DutyChange =
  | { type: 'replace'; date: string; from: string; to: string }
  | { type: 'cancel'; date: string; reason?: string }
  | { type: 'add'; date: string; name: string }
  | { type: 'remove'; date: string; name: string };

const DATE_RE = /(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*(?:\([^)]*\))?/;
const cleanName = (s: string) => s.trim().replace(/(さん|様)$/, '').trim();

function splitNames(s: string): string[] {
  return s.split(/[、,，・/／&＆\s]+|と(?=[^\s])/).map(cleanName).filter((x) => x && !/^(なし|無し|-|ー)$/.test(x));
}

/** 予定表テキスト（1行1活動）を解析 */
export function parseScheduleText(input: string, base = today()): ParsedDuty[] {
  const out: ParsedDuty[] = [];
  for (const raw of normalizeText(input).split('\n')) {
    const line = raw.trim();
    const dm = line.match(DATE_RE);
    if (!dm) continue;
    const date = guessYmd(Number(dm[1]), Number(dm[2]), base);
    let rest = line.slice((dm.index ?? 0) + dm[0].length).trim();
    let amount: number | undefined;
    const am = rest.match(/([\d,]+)\s*円/);
    if (am) {
      amount = Number(am[1].replace(/,/g, ''));
      rest = rest.replace(am[0], ' ');
    }
    let names: string[] = [];
    const tm = rest.match(/当番\s*[:は]?\s*(.*)$/);
    if (tm) {
      names = splitNames(tm[1]);
      rest = rest.slice(0, tm.index).trim();
    }
    const activity = rest.replace(/^[\s:\-|]+|[\s:\-|]+$/g, '').replace(/\s+/g, ' ') || '活動';
    if (/休み|なし|オフ/.test(activity) && !names.length) continue;
    out.push({ date, activity, names, amount });
  }
  return out;
}

/** LINE の変更連絡から変更候補を作る */
export function parseDutyChanges(input: string, duties: Duty[], base = today()): DutyChange[] {
  const out: DutyChange[] = [];
  const text = normalizeText(input);
  for (const raw of text.split(/\n|。/)) {
    const line = raw.trim();
    const dm = line.match(DATE_RE);
    if (!dm) continue;
    const date = guessYmd(Number(dm[1]), Number(dm[2]), base);
    const rest = line.slice((dm.index ?? 0) + dm[0].length);
    if (/中止|休み|キャンセル|なくなり|無くなり|延期/.test(rest) && !/→|⇒|から|交代|代わり|変更/.test(rest)) {
      out.push({ type: 'cancel', date, reason: rest.trim() });
      continue;
    }
    const rm =
      rest.match(/([^\s、,:の]+?)(?:さん)?\s*(?:→|⇒|->|から)\s*([^\s、,。に]+?)(?:さん)?\s*(?:に|へ)?\s*(?:変更|交代|代わり|$)/) ??
      rest.match(/([^\s、,:の]+?)(?:さん)?\s*の代わりに\s*([^\s、,。が]+?)(?:さん)?/);
    if (rm) {
      out.push({ type: 'replace', date, from: cleanName(rm[1].replace(/^.*当番\s*[:は]?/, '')), to: cleanName(rm[2]) });
      continue;
    }
    const add = rest.match(/([^\s、,:の]+?)(?:さん)?\s*(?:を)?\s*(?:追加|も当番|も入り)/);
    if (add) {
      out.push({ type: 'add', date, name: cleanName(add[1]) });
      continue;
    }
    const rem = rest.match(/([^\s、,:の]+?)(?:さん)?\s*(?:は|が)?\s*(?:不参加|外れ|抜け|取り消し|取消)/);
    if (rem) out.push({ type: 'remove', date, name: cleanName(rem[1]) });
  }
  // 存在しない当番日は除外せず残す（確認画面で警告）
  void duties;
  return out;
}
