import type { GasCalcSnapshot, GasMethod, Settings } from './types';
import { nowIso } from './util';

export interface GasInput {
  distanceKm: number;
  roundTrip: boolean;
  method: GasMethod;
  yenPerKm: number;
  kmPerL: number;
  yenPerL: number;
  routeSummary?: string;
}

export function gasInputFromSettings(s: Settings, distanceKm: number): GasInput {
  return { distanceKm, roundTrip: s.gas.roundTrip, method: s.gas.method, yenPerKm: s.gas.yenPerKm, kmPerL: s.gas.kmPerL, yenPerL: s.gas.yenPerL };
}

/** A: 距離×円/km  B: 距離÷燃費×ガソリン単価。1円未満は四捨五入 */
export function calcGas(i: GasInput): GasCalcSnapshot {
  const totalKm = Math.round(i.distanceKm * (i.roundTrip ? 2 : 1) * 10) / 10;
  let result: number;
  if (i.method === 'perKm') {
    result = Math.round(totalKm * i.yenPerKm);
  } else {
    if (!(i.kmPerL > 0)) throw new Error('燃費は0より大きい値にしてください');
    result = Math.round((totalKm / i.kmPerL) * i.yenPerL);
  }
  return {
    method: i.method,
    distanceKm: i.distanceKm,
    roundTrip: i.roundTrip,
    totalKm,
    yenPerKm: i.method === 'perKm' ? i.yenPerKm : undefined,
    kmPerL: i.method === 'fuel' ? i.kmPerL : undefined,
    yenPerL: i.method === 'fuel' ? i.yenPerL : undefined,
    result,
    routeSummary: i.routeSummary,
    at: nowIso(),
  };
}

export function describeCalc(c: GasCalcSnapshot): string {
  const km = `${c.totalKm}km${c.roundTrip ? '（往復）' : '（片道）'}`;
  return c.method === 'perKm'
    ? `${km} × ${c.yenPerKm}円/km = ${c.result.toLocaleString()}円`
    : `${km} ÷ ${c.kmPerL}km/L × ${c.yenPerL}円/L = ${c.result.toLocaleString()}円`;
}
