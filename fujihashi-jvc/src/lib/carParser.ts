import { guessYmd, normalizeText, today } from './util';

export type PersonKind = 'child' | 'adult' | 'sibling';
/** 名簿照合用（家庭の子ども1人ずつ） */
export interface RosterPerson { id: string; name: string; kana?: string; guardian: string; householdId: string }

export interface ParsedRider { name: string; kind: PersonKind; relation?: string }
export interface ParsedCar { name: string; driver: string; riders: ParsedRider[] }
export interface CarSplitResult { date?: string; title?: string; destination?: string; cars: ParsedCar[] }

const ADULT_REL = ['お父さん', 'お母さん', 'おじいちゃん', 'おばあちゃん', '祖父', '祖母', 'じいじ', 'ばあば', 'パパ', 'ママ', '叔父', '叔母', '父', '母'];
const SIB_REL = ['お兄ちゃん', 'お姉ちゃん', '兄', '姉', '弟', '妹'];
const REL_RE = new RegExp(`(${[...ADULT_REL, ...SIB_REL].join('|')})$`);
const HONORIFIC_RE = /(さん|ちゃん|くん|君|様)$/;
const BULLET_RE = /^[\s・\-－ー*＊•●○◯◎■□◆◇▶▷→⇒☆★🚗🚙🚘✅️\d①-⑳]+[\.\)．、]?\s*/u;

export function classify(raw: string): ParsedRider {
  let name = raw.trim().replace(HONORIFIC_RE, '').trim();
  const m = name.match(REL_RE);
  if (m) {
    const relation = m[1].replace(/^お/, '').replace(/(さん|ちゃん)$/, '');
    const rel = relation === '父さん' ? '父' : relation === '母さん' ? '母' : relation;
    const kind: PersonKind = SIB_REL.includes(m[1]) ? 'sibling' : 'adult';
    name = name.replace(/\s+/g, '');
    return { name, kind, relation: rel };
  }
  return { name, kind: 'child' };
}

function isCarHeader(line: string): RegExpMatchArray | null {
  if (/車割|配車|乗車|駐車|洗車|車で|車出し(?!:)/.test(line)) return null;
  return line.match(/^[\s【\[《<〈「『]*(?:[①-⑳]|\d+[\.\)．]|[🚗🚙🚘■◆●▶]+)?\s*([^\s【】\[\]《》:()、,]{1,12}?)\s*(号車|車)\s*(?:[】\]》>〉」』])?/u);
}

function extractDriver(text: string): string | undefined {
  const m =
    text.match(/(?:運転手?|ドライバー|driver)\s*[:は＝=]?\s*([^\s,、)\]】]+)/i) ??
    text.match(/[(（【\[]\s*([^()（）\s]+?)\s*(?:運転|が運転)\s*[)）】\]]/);
  return m ? classify(m[1]).name : undefined;
}

function splitNames(line: string): string[] {
  const body = line.replace(/^(子ども|子供|こども|子|大人|保護者|同乗|乗車)\s*[:：]\s*/, '');
  const parts = body.split(/[、,，/／・\t]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const tokens = p.split(/\s+/).filter(Boolean);
    if (tokens.length === 2 && !tokens.some((t) => REL_RE.test(t.replace(HONORIFIC_RE, '')))) {
      out.push(tokens.join(' ')); // 「三浦 ゆい」は姓名として扱う
    } else out.push(...tokens);
  }
  return out
    .map((s) => s.replace(/[(（]\s*\d+\s*[名人]?\s*[)）]/g, '').replace(/[。!！]+$/, '').trim())
    .filter((s) => s && !/^(計|合計)?\d+\s*[名人]$/.test(s) && !/^(以上|よろしく|お願いします)/.test(s));
}

/** LINE の車割り文章を解析（ルールベース。AI解析が使えない場合も動作） */
export function parseCarSplit(input: string, base = today()): CarSplitResult {
  const text = normalizeText(input);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const res: CarSplitResult = { cars: [] };
  let cur: ParsedCar | null = null;
  for (const line of lines) {
    if (!res.date) {
      const dm = line.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/);
      if (dm && !isCarHeader(line)) {
        res.date = guessYmd(Number(dm[1]), Number(dm[2]), base);
        const rest = line.replace(dm[0], '').replace(/\([日月火水木金土祝・]+\)/g, '').replace(/車割り?|配車|のお知らせ|について/g, '').replace(/[【】\[\]]/g, ' ').trim();
        if (rest && !res.title) res.title = rest.split(/\s+/).find((x) => x.length > 1);
        continue;
      }
    }
    const place = line.match(/(?:場所|会場|行き先|目的地)\s*[:は]\s*(.+)$/) ?? line.match(/@\s*(.+)$/);
    if (place && !cur) {
      res.destination = place[1].trim();
      continue;
    }
    const h = isCarHeader(line);
    if (h) {
      const name = `${h[1].replace(BULLET_RE, '')}${h[2] === '号車' ? '号車' : '車'}`;
      cur = { name, driver: '', riders: [] };
      res.cars.push(cur);
      const rest = line.slice(h[0].length);
      const drv = extractDriver(line);
      if (drv) cur.driver = drv;
      const restNames = rest.replace(/[(（【\[][^)）】\]]*[)）】\]]/g, '').replace(/(運転手?|ドライバー)\s*[:は]?\s*\S+/, '').replace(/^\s*[:：]\s*/, '');
      for (const n of splitNames(restNames)) cur.riders.push(classify(n));
      continue;
    }
    if (!cur) {
      if (!res.title && /遠征|大会|試合|練習/.test(line)) res.title = line.replace(/[【】\[\]]/g, '').trim();
      continue;
    }
    const isDriverLine = /^(運転手?|ドライバー)/.test(line.replace(BULLET_RE, '')) || /^[(（【\[][^)）】\]]*運転\s*[)）】\]]$/.test(line);
    const drv = isDriverLine ? extractDriver(line) : undefined;
    if (drv) {
      cur.driver = drv;
      continue;
    }
    const clean = line.replace(BULLET_RE, '');
    for (const n of splitNames(clean)) cur.riders.push(classify(n));
  }
  for (const c of res.cars) {
    if (!c.driver) continue;
    // 運転手が乗車リストにもいれば重複させない
    c.riders = c.riders.filter((r) => r.name !== c.driver);
  }
  return res;
}

// ---- 名簿との照合 ----

const surname = (m: RosterPerson) => m.name.split(/\s+/)[0];
const given = (m: RosterPerson) => m.name.split(/\s+/).slice(1).join('') || m.name;
export const compact = (s: string) => s.replace(/\s+/g, '');

export function matchPeople(name: string, kind: PersonKind, people: RosterPerson[]): RosterPerson[] {
  const n = compact(name);
  if (kind === 'child' || kind === 'sibling') {
    const direct = people.filter((m) => compact(m.name) === n || given(m) === n || (m.kana && compact(m.kana) === n));
    if (direct.length || kind === 'child') return direct;
  }
  // 「三浦母」「三浦兄」→ 姓で家庭を特定
  const sn = n.replace(REL_RE, '');
  if (!sn) return [];
  return people.filter((m) => surname(m) === sn || compact(m.guardian).startsWith(sn));
}
