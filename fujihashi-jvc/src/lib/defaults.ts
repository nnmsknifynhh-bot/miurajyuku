import type { AppData, Settings } from './types';
import { uid } from './util';

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
    // 旧版の部員名簿は、姓ごとに家庭へまとめて引き継ぐ
    const old = (d as { members?: { name: string; grade?: string; guardian?: string; monthlyFee?: number; active?: boolean }[] })?.members;
    if (Array.isArray(old)) {
      const map = new Map<string, AppData['households'][number]>();
      for (const m of old) {
        const sn = (m.name ?? '').trim().split(/\s+/)[0];
        if (!sn) continue;
        const h = map.get(sn) ?? { id: uid('h_'), name: `${sn}家`, guardian: m.guardian || `${sn}（保護者）`, children: [], monthlyFee: 0, active: m.active !== false, note: '旧版から引き継ぎ（月謝額を確認してください）' };
        h.children.push({ id: uid('c_'), name: m.name.trim(), grade: m.grade });
        h.monthlyFee = (h.monthlyFee ?? 0) + (m.monthlyFee ?? 0);
        if (m.active !== false) h.active = true;
        map.set(sn, h);
      }
      fresh.households = [...map.values()].map((h) => ({ ...h, monthlyFee: h.monthlyFee || null }));
    }
    return fresh;
  }
  const out = { ...emptyData(), ...d } as AppData;
  out.settings = { ...defaultSettings(), ...d.settings };
  return out;
}
