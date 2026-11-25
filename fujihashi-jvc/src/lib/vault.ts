// 端末内暗号化保存: パスコードから PBKDF2 で鍵を導出し AES-GCM で暗号化して IndexedDB に保存
const DB = 'jvc-kaikei';
const STORE = 'kv';
const ITER = 310_000;

export interface Sealed { v: 1; salt: string; iv: string; data: string; iter: number }

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result as T | undefined);
    q.onerror = () => rej(q.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function kvDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function deriveKey(passcode: string, salt: Uint8Array, iter = ITER): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface Session { key: CryptoKey; salt: Uint8Array; iter: number }

export async function newSession(passcode: string): Promise<Session> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(passcode, salt), salt, iter: ITER };
}

export async function seal(s: Session, obj: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, s.key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(s.salt), iv: b64(iv), data: b64(ct), iter: s.iter };
}

export async function unseal<T>(sealed: Sealed, passcode: string): Promise<{ data: T; session: Session }> {
  const salt = unb64(sealed.salt);
  const key = await deriveKey(passcode, salt, sealed.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, key, unb64(sealed.data) as BufferSource);
  return { data: JSON.parse(new TextDecoder().decode(pt)) as T, session: { key, salt, iter: sealed.iter } };
}

export const VAULT_KEY = 'vault';
export const VAULT_PREV_KEY = 'vault.prev';

export async function saveVault(s: Session, data: unknown) {
  const sealed = await seal(s, data);
  const cur = await kvGet<Sealed>(VAULT_KEY);
  if (cur) await kvSet(VAULT_PREV_KEY, cur); // 1世代前を保持
  await kvSet(VAULT_KEY, sealed);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* noop */
  }
}

// ---- 画像（レシート・スクリーンショット）の暗号化保存 ----
export const IMG_PREFIX = 'img:';

export async function saveImage(s: Session, id: string, bytes: ArrayBuffer, type: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, s.key, bytes);
  await kvSet(IMG_PREFIX + id, { iv: b64(iv), data: b64(ct), type });
}

export async function loadImage(s: Session, id: string): Promise<Blob | null> {
  const v = await kvGet<{ iv: string; data: string; type: string }>(IMG_PREFIX + id);
  if (!v) return null;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) as BufferSource }, s.key, unb64(v.data) as BufferSource);
  return new Blob([pt], { type: v.type });
}

export async function kvKeys(prefix = ''): Promise<string[]> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).getAllKeys();
    q.onsuccess = () => res((q.result as string[]).filter((k) => String(k).startsWith(prefix)));
    q.onerror = () => rej(q.error);
  });
}

/** パスコード変更時: 画像を新しい鍵で暗号化し直す */
export async function reencryptImages(from: Session, to: Session) {
  for (const k of await kvKeys(IMG_PREFIX)) {
    const id = k.slice(IMG_PREFIX.length);
    const blob = await loadImage(from, id);
    if (blob) await saveImage(to, id, await blob.arrayBuffer(), blob.type);
  }
}

export async function exportImages(s: Session): Promise<Record<string, { type: string; data: string }>> {
  const out: Record<string, { type: string; data: string }> = {};
  for (const k of await kvKeys(IMG_PREFIX)) {
    const id = k.slice(IMG_PREFIX.length);
    const blob = await loadImage(s, id);
    if (blob) out[id] = { type: blob.type, data: b64(await blob.arrayBuffer()) };
  }
  return out;
}

export async function importImages(s: Session, imgs: Record<string, { type: string; data: string }>) {
  for (const [id, v] of Object.entries(imgs)) await saveImage(s, id, unb64(v.data).buffer as ArrayBuffer, v.type);
}

export async function clearAll() {
  const db = await openDb();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---- パスコードの入力ゆれ対策 ----
/** 全角→半角（NFKC）・前後の空白を除いた形。新しく設定するパスコードはこの形で保存する */
export function normPass(p: string): string {
  return p.normalize('NFKC').trim();
}

/** 入力ゆれの候補（全角/半角・空白・先頭の大文字小文字） */
export function passCandidates(p: string): string[] {
  const out = [p, normPass(p), p.trim()];
  for (const x of [...out]) {
    if (!x) continue;
    const f = x[0];
    const flip = f === f.toUpperCase() ? f.toLowerCase() : f.toUpperCase();
    if (flip !== f) out.push(flip + x.slice(1));
  }
  // 半角で入力して、設定時は全角だった場合
  const wide = p.trim().replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  out.push(wide);
  return [...new Set(out.filter(Boolean))];
}

/** 候補を順に試して復号 */
export async function unsealAny<T>(sealed: Sealed, typed: string): Promise<{ data: T; session: Session }> {
  let last: unknown;
  for (const p of passCandidates(typed)) {
    try {
      return await unseal<T>(sealed, p);
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error('wrong');
}
