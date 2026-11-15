import type { Settings } from './types';
import { fmtDate } from './util';

export interface LineVars { content: string; amount: string; due: string; name?: string }

export function buildLineMessage(s: Settings, v: LineVars): string {
  let t = s.lineTemplate
    .replaceAll('{チーム名}', s.teamName)
    .replaceAll('{内容}', v.content)
    .replaceAll('{金額}', v.amount)
    .replaceAll('{期限}', v.due);
  t = t.replaceAll('{名前}', v.name ?? '');
  return t;
}

export function dueLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}月${d}日`;
}

/** LINE アプリの共有画面を開く URL（相手やグループは LINE 側で選択） */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

export { fmtDate };
