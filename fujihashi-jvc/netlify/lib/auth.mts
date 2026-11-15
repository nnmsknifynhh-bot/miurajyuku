import { timingSafeEqual, createHash } from 'node:crypto';

/** 会計係の端末だけが呼べるよう、共有トークンで保護する */
export function checkAuth(req: Request): Response | null {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected || expected.length < 16) return json({ error: 'サーバー側に APP_ACCESS_TOKEN（16文字以上）が設定されていません' }, 500);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const got = req.headers.get('x-app-token') ?? '';
  const h = (s: string) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(h(got), h(expected))) return json({ error: 'トークンが正しくありません' }, 401);
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
