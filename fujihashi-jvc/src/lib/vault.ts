// 端末内暗号化保存: パスコードから PBKDF2 で鍵を導出し AES-GCM で暗号化して IndexedDB に保存
const DB = 'jvc-kaikei';
const STORE = 'kv';
const ITER = 310_000;

export interface Sealed { v: 1; salt: string; iv: string; data: string; iter: number }

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
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
