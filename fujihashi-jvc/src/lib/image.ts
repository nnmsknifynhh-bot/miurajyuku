/** 写真を縮小して JPEG に（容量と送信量を抑える） */
export async function shrinkImage(file: File, max = 1600, quality = 0.82): Promise<{ bytes: ArrayBuffer; type: string; base64: string }> {
  if (file.type === 'application/pdf') {
    const bytes = await file.arrayBuffer();
    return { bytes, type: file.type, base64: toB64(bytes) };
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像を変換できません'))), 'image/jpeg', quality));
  const bytes = await blob.arrayBuffer();
  return { bytes, type: 'image/jpeg', base64: toB64(bytes) };
}

function toB64(b: ArrayBuffer): string {
  const u = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
