import type { AppData, Settings } from './types';

export function defaultSettings(): Settings {
  return {
    teamName: '藤橋JVC',
    recorderName: '会計係',
    fiscalStartMonth: 4,
    fareHighwayPlayer: 1000,
    fareHighwayParent: 1000,
    fareDriver: 0,
    fareNoHighway: 0,
    referencePerson: '先野',
    prepDefault: null, // 要確認
    monthlyFeeDefault: null, // 要確認
    feeDueRule: 'targetMonthEnd', // 要確認
    autoLockMinutes: 5,
    apiToken: '',
  };
}

export function emptyData(): AppData {
  return { version: 2, settings: defaultSettings(), households: [], bills: [], days: [], expenses: [], prepSettlements: [], txs: [] };
}

/** 保存データの不足項目を補う（旧版のデータは空から開始） */
export function migrate(raw: unknown): AppData {
  const d = raw as Partial<AppData> & { version?: number };
  if (d?.version !== 2) {
    const fresh = emptyData();
    // 旧版の現金出納帳は引き継ぐ
    if (Array.isArray((d as { txs?: unknown[] })?.txs)) fresh.txs = (d as AppData).txs.map((t) => ({ ...t, category: (['fee', 'opening', 'other'] as string[]).includes(t.category) ? t.category : 'other' }));
    return fresh;
  }
  const out = { ...emptyData(), ...d } as AppData;
  out.settings = { ...defaultSettings(), ...d.settings };
  return out;
}
