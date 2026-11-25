// サーバー関数（Netlify Functions）への接続。APIキーはサーバー側の環境変数にのみ保存します。
import type { CarSplitResult } from './carParser';
import type { ScheduleItem } from './scheduleParser';

export interface FileInput { mediaType: string; data: string }

export interface ReceiptResult { date: string; store: string; items: string; total: number | null; category: 'drink' | 'bento' | 'equipment' | 'other' | ''; review: string[] }

async function call<T>(token: string, body: unknown): Promise<T> {
  if (!token) throw new Error('画像の読み取りにはサーバー設定が必要です（設定 → サーバー接続トークン）。テキストは「端末内で読み取る」を使えます');
  const res = await fetch('/.netlify/functions/ai-parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Token': token },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `通信エラー (${res.status})` }));
  if (!res.ok) throw new Error(json.error || `エラー (${res.status})`);
  return json as T;
}

export const aiSchedule = (token: string, input: { text?: string; file?: FileInput }, baseDate: string) =>
  call<{ items: ScheduleItem[] }>(token, { task: 'schedule', ...input, baseDate });

export const aiCarSplit = (token: string, input: { text?: string; file?: FileInput }, roster: string[], baseDate: string) =>
  call<CarSplitResult & { review: string[] }>(token, { task: 'carSplit', ...input, roster, baseDate });

export const aiReceipt = (token: string, file: FileInput, baseDate: string) => call<ReceiptResult>(token, { task: 'receipt', file, baseDate });
