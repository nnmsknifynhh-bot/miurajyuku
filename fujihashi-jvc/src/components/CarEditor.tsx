import type { Car, PersonKind, Rider } from '../lib/types';
import { uid } from '../lib/util';

const KIND: [PersonKind, string][] = [
  ['child', '子ども'],
  ['adult', '大人'],
  ['sibling', '兄弟姉妹'],
];

/** 車ごとの乗車メンバー編集。collect（集金対象）は入金確認とは別に管理 */
export function CarEditor(props: {
  cars: Car[];
  onChange: (cars: Car[]) => void;
  issues?: Record<string, string[]>;
  memberName?: (id?: string) => string | undefined;
}) {
  const setCar = (i: number, c: Car) => props.onChange(props.cars.map((x, j) => (j === i ? c : x)));
  const setRider = (i: number, r: Rider) => setCar(i, { ...props.cars[i], riders: props.cars[i].riders.map((x) => (x.id === r.id ? r : x)) });
  return (
    <div className="stack">
      {props.cars.map((car, i) => {
        const driver = car.riders.find((r) => r.isDriver);
        return (
          <div className="car" key={car.id}>
            <div className="car-head">
              <input type="text" value={car.name} onChange={(e) => setCar(i, { ...car, name: e.target.value })} style={{ flex: 1, minWidth: 100, fontWeight: 700 }} aria-label="車の名前" />
              <button
                className="btn small danger"
                disabled={car.riders.some((r) => r.txId)}
                onClick={() => confirm(`${car.name} を削除しますか？`) && props.onChange(props.cars.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </div>
            {props.issues?.[car.id]?.map((m) => (
              <div key={m} className="alert warn" style={{ marginTop: 6 }}>
                ⚠️ {m}
              </div>
            ))}
            <div className="rider">
              <span className="chip info">運転手</span>
              <input
                type="text"
                className="nm"
                value={car.driver}
                placeholder="運転手（例: 三浦父）"
                onChange={(e) => {
                  const name = e.target.value;
                  const riders = driver
                    ? car.riders.map((r) => (r.isDriver ? { ...r, name } : r))
                    : [{ id: uid('r_'), name, kind: 'adult' as PersonKind, isDriver: true, collect: false }, ...car.riders];
                  setCar(i, { ...car, driver: name, riders });
                }}
              />
              {driver && (
                <label className="check" title="チェックすると運転手からも集金します">
                  <input type="checkbox" checked={driver.collect} disabled={!!driver.txId} onChange={(e) => setRider(i, { ...driver, collect: e.target.checked })} />
                  <span style={{ fontSize: 13 }}>{driver.collect ? '集金する' : '免除'}</span>
                </label>
              )}
            </div>
            {car.riders
              .filter((r) => !r.isDriver)
              .map((r) => (
                <div className="rider" key={r.id}>
                  <input type="checkbox" checked={r.collect} disabled={!!r.txId} onChange={(e) => setRider(i, { ...r, collect: e.target.checked })} aria-label={`${r.name}を集金対象にする`} style={{ width: 22, height: 22 }} />
                  <input type="text" className="nm" value={r.name} disabled={!!r.txId} onChange={(e) => setRider(i, { ...r, name: e.target.value, memberId: undefined })} />
                  <select value={r.kind} onChange={(e) => setRider(i, { ...r, kind: e.target.value as PersonKind })} style={{ width: 'auto', minHeight: 38, padding: '4px 6px' }}>
                    {KIND.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {r.memberId && props.memberName && <span className="chip ok">{r.kind === 'child' ? '名簿' : '家族'}:{props.memberName(r.memberId)}</span>}
                  {r.txId ? (
                    <span className="chip ok">入金済</span>
                  ) : (
                    <button className="icon-btn" aria-label="削除" onClick={() => setCar(i, { ...car, riders: car.riders.filter((x) => x.id !== r.id) })}>
                      🗑
                    </button>
                  )}
                </div>
              ))}
            <button
              className="btn small"
              style={{ marginTop: 6 }}
              onClick={() => setCar(i, { ...car, riders: [...car.riders, { id: uid('r_'), name: '', kind: 'child', collect: true }] })}
            >
              ＋ 乗車メンバー
            </button>
          </div>
        );
      })}
      <button className="btn" onClick={() => props.onChange([...props.cars, { id: uid('car_'), name: `車${props.cars.length + 1}`, driver: '', riders: [] }])}>
        ＋ 車を追加
      </button>
      <p className="muted">☑ = 集金対象。実際に受け取ったかどうかは遠征画面の「集金」で別に記録します。</p>
    </div>
  );
}
