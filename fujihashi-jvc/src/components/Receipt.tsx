import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { loadImage } from '../lib/vault';
import { Modal } from './ui';

/** 端末内に暗号化保存した画像を表示（ロック解除中のみ復号） */
export function ReceiptImg(props: { id: string; onRemove?: () => void }) {
  const { session } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    loadImage(session, props.id)
      .then((b) => {
        if (b) setUrl((u = URL.createObjectURL(b)));
      })
      .catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [props.id, session]);
  if (!url) return <div className="chip">読込中…</div>;
  return (
    <>
      <img src={url} alt="レシート" onClick={() => setBig(true)} />
      {big && (
        <Modal title="レシート" onClose={() => setBig(false)}>
          <img src={url} alt="レシート" style={{ width: '100%', borderRadius: 12 }} />
          {props.onRemove && (
            <button className="btn danger" onClick={() => confirm('この画像を外しますか？') && (props.onRemove!(), setBig(false))}>
              この画像を外す
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
