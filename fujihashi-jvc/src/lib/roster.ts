import type { AppData, Household } from './types';
import type { RosterPerson } from './carParser';
import { normalizeText, uid } from './util';

export function rosterPeople(d: AppData): RosterPerson[] {
  return d.households.flatMap((h) => h.children.map((c) => ({ id: c.id, name: c.name, guardian: h.guardian, householdId: h.id })));
}

export function childName(d: AppData, childId?: string): string | undefined {
  for (const h of d.households) for (const c of h.children) if (c.id === childId) return c.name;
  return undefined;
}

/**
 * 名簿の一括取り込み。1行に1人「姓 名, 学年, 保護者名」（区切りはカンマ・タブ・空白）。
 * 姓が同じ子は同じ家庭にまとめる（あとで編集可）。
 */
export function parseRoster(text: string, monthlyFee: number | null): Household[] {
  const map = new Map<string, Household>();
  for (const raw of normalizeText(text).split('\n')) {
    const line = raw.trim();
    if (!line || /^(氏名|名前|選手)/.test(line)) continue;
    const cells = line.split(/[,\t、]+/).map((s) => s.trim()).filter(Boolean);
    let name = cells[0] ?? '';
    let grade = cells.find((c, i) => i > 0 && /(年|年生)$/.test(c));
    let guardian = cells.find((c, i) => i > 0 && c !== grade) ?? '';
    // 「三浦 ゆい 5年 三浦母」のように空白区切りの場合
    if (cells.length === 1) {
      const t = line.split(/\s+/);
      grade = t.find((x) => /年(生)?$/.test(x));
      const rest = t.filter((x) => x !== grade);
      name = rest.slice(0, 2).join(' ');
      guardian = rest.slice(2).join(' ');
    }
    const sn = name.split(/\s+/)[0];
    if (!sn) continue;
    const h = map.get(sn) ?? { id: uid('h_'), name: `${sn}家`, guardian: guardian || `${sn}（保護者）`, children: [], monthlyFee, active: true };
    if (guardian && h.guardian.endsWith('（保護者）')) h.guardian = guardian;
    h.children.push({ id: uid('c_'), name, grade });
    map.set(sn, h);
  }
  return [...map.values()];
}
