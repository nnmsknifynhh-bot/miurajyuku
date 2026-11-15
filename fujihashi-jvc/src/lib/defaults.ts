import type { AppData, Settings } from './types';
import { monthOf, today } from './util';

export const DEFAULT_LINE_TEMPLATE = `【{チーム名} 会計リマインダー】

いつもご協力ありがとうございます。

お支払い期限が近づいておりますので、ご案内いたします。

■ お支払い内容：{内容}

■ 金額：{金額}

■ 支払期限：{期限}

お手数ですが、期限までにお支払いをお願いいたします。

すでにお支払い済みの場合は、行き違いのご案内となりますことをご了承ください。`;

export function defaultSettings(): Settings {
  return {
    teamName: '藤橋JVC',
    recorderName: '会計係',
    defaultMonthlyFee: 2000,
    feeDueDay: 20,
    feeStartMonth: monthOf(today()),
    fiscalStartMonth: 4,
    dutyDefaultAmount: 1000,
    gas: { method: 'perKm', yenPerKm: 20, kmPerL: 12, yenPerL: 175, roundTrip: true },
    reminders: { feeDaysBefore: 5, transportDaysBefore: 3, dutyDayBefore: true, dutySameDay: true, settleDaysAfter: 7, notifyHour: 19, notifyMinute: 0 },
    lineTemplate: DEFAULT_LINE_TEMPLATE,
    autoLockMinutes: 5,
    apiToken: '',
  };
}

export function emptyData(): AppData {
  return { version: 1, settings: defaultSettings(), members: [], fees: [], expeditions: [], duties: [], txs: [], reminderState: { dismissed: {}, notified: {} } };
}

/** 古いデータに不足項目を補う */
export function migrate(d: AppData): AppData {
  const def = defaultSettings();
  d.settings = { ...def, ...d.settings, gas: { ...def.gas, ...d.settings?.gas }, reminders: { ...def.reminders, ...d.settings?.reminders } };
  d.reminderState ??= { dismissed: {}, notified: {} };
  for (const k of ['members', 'fees', 'expeditions', 'duties', 'txs'] as const) (d as unknown as Record<string, unknown[]>)[k] ??= [];
  return d;
}
