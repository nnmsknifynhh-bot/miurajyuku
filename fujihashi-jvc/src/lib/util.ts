export function uid(prefix = ''): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso(): string {
  return new Date().toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toYmd(new Date());
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 86400000);
}

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDate(ymd?: string): string {
  if (!ymd) return '';
  const d = parseYmd(ymd);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

export function fmtMonth(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  return `${m}月`;
}

export function yen(n: number | undefined): string {
  return `${(n ?? 0).toLocaleString('ja-JP')}円`;
}

/** 年度（4月始まりなら 2026/3 は 2025 年度） */
export function fiscalYearOf(ymd: string, startMonth: number): number {
  const d = parseYmd(ymd);
  return d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
}

export function fiscalRange(fy: number, startMonth: number): { from: string; to: string } {
  const from = `${fy}-${pad(startMonth)}-01`;
  const end = new Date(fy + 1, startMonth - 1, 0);
  return { from, to: toYmd(end) };
}

/** 全角数字→半角、全角スペース→半角 */
export function normalizeText(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[／]/g, '/')
    .replace(/[：]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\r\n?/g, '\n');
}

/** 指定年月日の妥当な Y-M-D（年は基準日から近い方を推定） */
export function guessYmd(month: number, day: number, base: string = today()): string {
  const by = parseYmd(base).getFullYear();
  const candidates = [by - 1, by, by + 1].map((y) => toYmd(new Date(y, month - 1, day)));
  candidates.sort((a, b) => Math.abs(diffDays(a, base)) - Math.abs(diffDays(b, base)));
  return candidates[0];
}
