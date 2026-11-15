// サーバー関数（Netlify Functions）への接続。APIキーはサーバー側の環境変数にのみ保存します。
import type { CarSplitResult } from './carParser';
import type { DutyChange, ParsedDuty } from './scheduleParser';

export interface RouteOption { distanceKm: number; durationMin: number; summary: string; tollYen?: number }

async function call<T>(fn: string, token: string, body: unknown): Promise<T> {
  if (!token) throw new Error('設定画面で「サーバー接続トークン」を入力してください');
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Token': token },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `通信エラー (${res.status})` }));
  if (!res.ok) throw new Error(json.error || `エラー (${res.status})`);
  return json as T;
}

export function aiCarSplit(token: string, text: string, roster: string[], baseDate: string) {
  return call<CarSplitResult>('ai-parse', token, { task: 'carSplit', text, roster, baseDate });
}

export function aiSchedule(token: string, input: { text?: string; file?: { mediaType: string; data: string } }, roster: string[], baseDate: string) {
  return call<{ duties: ParsedDuty[] }>('ai-parse', token, { task: 'schedule', ...input, roster, baseDate });
}

export function aiDutyChanges(token: string, text: string, duties: { date: string; activity: string; names: string[] }[], baseDate: string) {
  return call<{ changes: DutyChange[] }>('ai-parse', token, { task: 'dutyChange', text, duties, baseDate });
}

export function fetchRoutes(token: string, origin: string, destination: string, waypoints: string[]) {
  return call<{ routes: RouteOption[] }>('route', token, { origin, destination, waypoints });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
