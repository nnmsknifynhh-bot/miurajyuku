import { checkAuth, json } from '../lib/auth.mts';

// Google Maps Platform Routes API で走行距離（と取得できれば高速料金）を取得
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

interface GRoute {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  travelAdvisory?: { tollInfo?: { estimatedPrice?: { currencyCode?: string; units?: string; nanos?: number }[] } };
}

export default async (req: Request) => {
  const denied = checkAuth(req);
  if (denied) return denied;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json({ error: 'サーバー側に GOOGLE_MAPS_API_KEY が設定されていません。距離を手入力してください' }, 500);

  let b: { origin?: string; destination?: string; waypoints?: string[] };
  try {
    b = await req.json();
  } catch {
    return json({ error: 'リクエストが不正です' }, 400);
  }
  const origin = (b.origin ?? '').trim();
  const destination = (b.destination ?? '').trim();
  const waypoints = (b.waypoints ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 8);
  if (!origin || !destination || origin.length > 200 || destination.length > 200) return json({ error: '出発地と目的地を入力してください' }, 400);

  const body = {
    origin: { address: origin },
    destination: { address: destination },
    intermediates: waypoints.map((address) => ({ address })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: waypoints.length === 0, // 経由地ありでは別ルート候補は返らない
    extraComputations: ['TOLLS'],
    routeModifiers: { vehicleInfo: { emissionType: 'GASOLINE' } },
    languageCode: 'ja',
    regionCode: 'JP',
    units: 'METRIC',
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.description,routes.travelAdvisory.tollInfo',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return json({ error: `ルート検索に失敗しました (${res.status})。住所を確認するか距離を手入力してください` }, 502);
  }
  const data = (await res.json()) as { routes?: GRoute[] };
  const routes = (data.routes ?? []).map((r) => {
    const price = r.travelAdvisory?.tollInfo?.estimatedPrice?.find((p) => p.currencyCode === 'JPY');
    return {
      distanceKm: Math.round((r.distanceMeters ?? 0) / 100) / 10,
      durationMin: Math.round(parseInt(r.duration ?? '0', 10) / 60),
      summary: r.description || '推奨ルート',
      tollYen: price ? Number(price.units ?? 0) + Math.round((price.nanos ?? 0) / 1e9) : undefined,
    };
  });
  if (!routes.length) return json({ error: 'ルートが見つかりませんでした' }, 404);
  return json({ routes });
};
