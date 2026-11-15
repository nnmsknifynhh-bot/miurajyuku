import { useState } from 'react';
import { useStore, errorText } from '../store';
import { Amt, Card, Check, Field, Modal, NumInput, Seg, TopBar, go } from '../components/ui';
import { activeAssignees, cancelAssignee, cancelDuty, newDuty, paidButInactive, payDuty, replaceAssignee, type PaidAction } from '../lib/duty';
import { parseDutyChanges, parseScheduleText, type DutyChange, type ParsedDuty } from '../lib/scheduleParser';
import { aiDutyChanges, aiSchedule, fileToBase64 } from '../lib/api';
import { voidTx } from '../lib/ledger';
import { sampleChangeText, sampleScheduleText } from '../lib/sample';
import type { AppData, Duty } from '../lib/types';
import { addDays, fmtDate, today, uid } from '../lib/util';

/** 支払い済みの場合に「保持 / 返金を受け取る」を確認 */
function askPaidAction(msg: string): PaidAction | null {
  if (!confirm(`${msg}\n\nこの当番にはすでに現金を渡しています。自動では削除しません。\n\n［OK］返金を受け取った（入金を記録）\n［キャンセル］次の選択へ`)) {
    return confirm('支払い済みのまま記録を残して変更しますか？（返金なし・後で調整）') ? 'keep' : null;
  }
  return 'refund';
}

export function Duties() {
  const { data: d, update } = useStore();
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [adding, setAdding] = useState(false);
  const t = today();
  const list = [...d.duties].sort((a, b) => a.date.localeCompare(b.date));
  const shown = tab === 'up' ? list.filter((x) => x.date >= addDays(t, -1) || activeAssignees(x).some((a) => !a.txId)) : list.filter((x) => x.date < t).reverse();
  return (
    <>
      <TopBar title="当番" right={<button className="btn small primary" onClick={() => setAdding(true)}>＋追加</button>} />
      <main>
        <div className="fab-row">
          <a className="btn" href="#/duties/import">
            📄 予定表を取り込む
          </a>
          <a className="btn" href="#/duties/change">
            💬 LINE変更連絡
          </a>
        </div>
        <Seg value={tab} onChange={setTab} options={[['up', 'これから・未払い'], ['past', '過去']]} />
        {shown.length === 0 && <div className="empty">当番はありません</div>}
        {shown.map((du) => (
          <DutyCard key={du.id} du={du} />
        ))}
        <p className="muted">当番への現金は活動前に渡します。前日と当日にリマインドが表示されます。</p>
      </main>
      {adding && (
        <Modal title="当番を追加" onClose={() => setAdding(false)}>
          <DutyForm
            onSave={(p) => {
              if (update((x) => void x.duties.push(newDuty(p.date, p.activity, p.names, p.amount ?? x.settings.dutyDefaultAmount)), '追加しました')) setAdding(false);
            }}
            defaultAmount={d.settings.dutyDefaultAmount}
          />
        </Modal>
      )}
    </>
  );
}

function DutyForm(props: { onSave: (p: ParsedDuty) => void; defaultAmount: number }) {
  const [p, setP] = useState<ParsedDuty>({ date: addDays(today(), 1), activity: '練習', names: [], amount: props.defaultAmount });
  const [names, setNames] = useState('');
  return (
    <div className="stack">
      <div className="row">
        <Field label="日付">
          <input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} />
        </Field>
        <Field label="活動">
          <input type="text" value={p.activity} onChange={(e) => setP({ ...p, activity: e.target.value })} />
        </Field>
      </div>
      <Field label="当番担当者（、区切りで複数可）">
        <input type="text" value={names} onChange={(e) => setNames(e.target.value)} placeholder="田中母、佐藤母" />
      </Field>
      <Field label="一人あたり支払額（円）">
        <NumInput value={p.amount} onChange={(n) => setP({ ...p, amount: n })} />
      </Field>
      <button className="btn primary block" disabled={!names.trim() || !p.date} onClick={() => props.onSave({ ...p, names: names.split(/[、,・\s]+/).filter(Boolean) })}>
        追加
      </button>
    </div>
  );
}

function DutyCard({ du }: { du: Duty }) {
  const { update } = useStore();
  const t = today();
  const mut = (fn: (x: AppData) => void, msg?: string) => update(fn, msg);
  const pay = (aid: string, name: string) => {
    let txId = '';
    update(
      (x) => {
        txId = payDuty(x, du.id, aid).id;
      },
      () => ({ text: `${name} へ渡しました`, undo: () => update((x) => voidTx(x, txId, '入力直後の取り消し'), '取り消しました') }),
    );
  };
  const replace = (aid: string, paid: boolean, oldName: string) => {
    const name = prompt(`${oldName} さんの代わりの担当者`);
    if (!name?.trim()) return;
    const action = paid ? askPaidAction(`${oldName} → ${name}`) : undefined;
    if (paid && !action) return;
    mut((x) => replaceAssignee(x, du.id, aid, name, action ?? undefined), '担当者を変更しました');
  };
  const cancelOne = (aid: string, paid: boolean, name: string) => {
    if (!paid && !confirm(`${name} さんの当番を取り消しますか？`)) return;
    const action = paid ? askPaidAction(`${name} さんの当番取消`) : undefined;
    if (paid && !action) return;
    mut((x) => cancelAssignee(x, du.id, aid, action ?? undefined), '取り消しました');
  };
  const cancelAll = () => {
    const paid = activeAssignees(du).some((a) => a.txId);
    if (!paid && !confirm(`${fmtDate(du.date)} ${du.activity} を中止にしますか？`)) return;
    const action = paid ? askPaidAction(`${fmtDate(du.date)} ${du.activity} の中止`) : undefined;
    if (paid && !action) return;
    mut((x) => cancelDuty(x, du.id, action ?? undefined), '中止にしました（未払いの予定と通知を更新）');
  };
  const addOne = () => {
    const name = prompt('追加する当番担当者');
    if (!name?.trim()) return;
    mut((x) => {
      const y = x.duties.find((z) => z.id === du.id)!;
      const amount = y.assignees[0]?.amount ?? x.settings.dutyDefaultAmount;
      y.assignees.push({ id: uid('as_'), name: name.trim(), amount, status: 'active' });
      y.history.push({ at: new Date().toISOString(), text: `${name} を追加` });
    });
  };
  const setAmount = (aid: string, cur: number) => {
    const v = prompt('支払金額（円）', String(cur));
    if (v === null) return;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0) return;
    mut((x) => {
      const a = x.duties.find((z) => z.id === du.id)!.assignees.find((z) => z.id === aid)!;
      if (a.txId) throw new Error('支払い済みの金額は変更できません');
      a.amount = n;
    });
  };
  const alerts = paidButInactive(du);
  return (
    <Card
      title={
        <>
          {fmtDate(du.date)} {du.activity} {du.cancelled && <span className="chip bad">中止</span>}
          {!du.cancelled && du.date === t && <span className="chip warn">今日</span>}
          {!du.cancelled && du.date === addDays(t, 1) && <span className="chip info">明日</span>}
        </>
      }
      right={
        !du.cancelled && (
          <button className="btn small danger" onClick={cancelAll}>
            中止
          </button>
        )
      }
    >
      <ul className="list">
        {du.assignees.map((a) => {
          const active = a.status === 'active' && !du.cancelled;
          return (
            <li key={a.id} className={active ? '' : 'void'} style={active ? undefined : { textDecoration: 'none' }}>
              <div className="main">
                <div className="title" style={active ? undefined : { textDecoration: 'line-through' }}>
                  {a.name}
                </div>
                <div className="meta">
                  {a.status === 'replaced' ? '交代済み' : a.status === 'cancelled' ? '取消' : ''}
                  {active && (
                    <>
                      <button className="btn small" style={{ minHeight: 28, padding: '2px 8px' }} onClick={() => replace(a.id, !!a.txId, a.name)}>
                        変更
                      </button>{' '}
                      <button className="btn small" style={{ minHeight: 28, padding: '2px 8px' }} onClick={() => cancelOne(a.id, !!a.txId, a.name)}>
                        取消
                      </button>
                    </>
                  )}
                </div>
              </div>
              <span onClick={() => active && !a.txId && setAmount(a.id, a.amount)} style={{ cursor: active && !a.txId ? 'pointer' : undefined }}>
                <Amt v={a.amount} />
              </span>
              {active &&
                (a.txId ? (
                  <button className="pay done" disabled>
                    ✓済
                  </button>
                ) : (
                  <button className="pay" onClick={() => pay(a.id, a.name)}>
                    渡す
                  </button>
                ))}
              {!active && a.txId && <span className="chip warn">支払済</span>}
            </li>
          );
        })}
      </ul>
      {alerts.length > 0 && <div className="alert warn">⚠️ 交代・中止前に支払い済み: {alerts.map((a) => a.name).join('、')}（記録は保持しています）</div>}
      {!du.cancelled && (
        <button className="btn small" onClick={addOne} style={{ marginTop: 6 }}>
          ＋ 担当者
        </button>
      )}
      {du.history.length > 1 && (
        <details style={{ marginTop: 6 }}>
          <summary className="muted">変更履歴</summary>
          {du.history.map((h, i) => (
            <div key={i} className="muted">
              {h.at.slice(0, 10)} {h.text}
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}

interface Row extends ParsedDuty {
  key: string;
  use: boolean;
  namesText: string;
}

export function DutyImport() {
  const { data: d, update, toast } = useStore();
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toRows = (list: ParsedDuty[]) =>
    setRows(list.map((p) => ({ ...p, amount: p.amount || d.settings.dutyDefaultAmount, key: uid(), use: !d.duties.some((x) => x.date === p.date && x.activity === p.activity && !x.cancelled), namesText: p.names.join('、') })));
  const roster = d.members.map((m) => m.guardian).filter(Boolean);
  const ai = async () => {
    setBusy(true);
    try {
      const input = mode === 'file' && file ? { file: { mediaType: file.type, data: await fileToBase64(file) } } : { text };
      toRows((await aiSchedule(d.settings.apiToken, input, roster, today())).duties);
      toast('AIで読み取りました。確認してください');
    } catch (e) {
      toast({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const use = rows!.filter((r) => r.use);
    const bad = use.find((r) => !r.date || !r.namesText.trim());
    if (bad) return toast({ text: '日付・担当者が空の行があります', err: true });
    if (update((x) => use.forEach((r) => x.duties.push(newDuty(r.date, r.activity, r.namesText.split(/[、,・\s]+/).filter(Boolean), r.amount ?? x.settings.dutyDefaultAmount))), `${use.length}件の当番を登録しました`)) go('/duties');
  };
  const setRow = (k: string, p: Partial<Row>) => setRows(rows!.map((r) => (r.key === k ? { ...r, ...p } : r)));
  return (
    <>
      <TopBar title="予定表の取り込み" back="/duties" />
      <main>
        {!rows ? (
          <>
            <Seg value={mode} onChange={setMode} options={[['text', 'テキスト'], ['file', '画像・PDF']]} />
            {mode === 'text' ? (
              <Card title="予定表のテキストを貼り付け">
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'11/22(土) 練習 当番：田中母、佐藤母\n11/29(土) 練習試合 当番：高橋母 1500円'} />
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setText(sampleScheduleText())}>
                  サンプル文章を入れる
                </button>
              </Card>
            ) : (
              <Card title="予定表の画像またはPDF">
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <p className="muted">画像・PDF は AI で読み取ります（サーバー設定が必要）。5MB程度まで。</p>
              </Card>
            )}
            <div className="fab-row">
              {mode === 'text' && (
                <button className="btn primary" disabled={!text.trim()} onClick={() => toRows(parseScheduleText(text))}>
                  読み取る（端末内）
                </button>
              )}
              <button className="btn" disabled={busy || (mode === 'text' ? !text.trim() : !file)} onClick={ai}>
                {busy ? 'AI解析中…' : '🤖 AIで読み取る'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="alert info">読み取り結果を確認し、登録する行にチェックを入れてください。</div>
            {rows.length === 0 && <div className="empty">当番が読み取れませんでした</div>}
            {rows.map((r) => {
              const dup = d.duties.some((x) => x.date === r.date && !x.cancelled);
              return (
                <Card key={r.key}>
                  <Check checked={r.use} onChange={(b) => setRow(r.key, { use: b })} label={<b>{fmtDate(r.date)} {r.activity}</b>} />
                  {dup && <div className="alert warn">⚠️ この日はすでに当番が登録されています</div>}
                  <div className="row">
                    <Field label="日付">
                      <input type="date" value={r.date} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                    </Field>
                    <Field label="活動">
                      <input type="text" value={r.activity} onChange={(e) => setRow(r.key, { activity: e.target.value })} />
                    </Field>
                  </div>
                  <div className="row">
                    <Field label="当番担当者">
                      <input type="text" value={r.namesText} onChange={(e) => setRow(r.key, { namesText: e.target.value })} />
                    </Field>
                    <Field label="金額/人" style={{ maxWidth: 110 }}>
                      <NumInput value={r.amount} onChange={(n) => setRow(r.key, { amount: n })} />
                    </Field>
                  </div>
                </Card>
              );
            })}
            <div className="fab-row">
              <button className="btn" onClick={() => setRows(null)}>
                ← 戻る
              </button>
              <button className="btn primary" disabled={!rows.some((r) => r.use)} onClick={save}>
                {rows.filter((r) => r.use).length}件を登録
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

interface ChangeRow { key: string; c: DutyChange; use: boolean; action: PaidAction }

export function DutyChangeImport() {
  const { data: d, update, toast } = useStore();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toRows = (cs: DutyChange[]) => setRows(cs.map((c) => ({ key: uid(), c, use: true, action: 'keep' })));
  const findDuty = (c: DutyChange) => d.duties.filter((x) => x.date === c.date && !x.cancelled);
  const findA = (du: Duty | undefined, name: string) => du && activeAssignees(du).find((a) => a.name === name || a.name.replace(/\s/g, '') === name.replace(/\s/g, ''));
  const ai = async () => {
    setBusy(true);
    try {
      const ctx = d.duties.filter((x) => x.date >= addDays(today(), -7)).map((x) => ({ date: x.date, activity: x.activity, names: activeAssignees(x).map((a) => a.name) }));
      const r = await aiDutyChanges(d.settings.apiToken, text, ctx, today());
      toRows(r.changes.map((c) => normalizeChange(c as DutyChange & Record<string, string>)));
    } catch (e) {
      toast({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  const describe = (row: ChangeRow) => {
    const c = row.c;
    const du = findDuty(c)[0];
    if (!du) return { text: `${fmtDate(c.date)} の当番が見つかりません`, ok: false, paid: false };
    if (c.type === 'cancel') return { text: `${fmtDate(c.date)} ${du.activity} を中止`, ok: true, paid: activeAssignees(du).some((a) => a.txId) };
    if (c.type === 'add') return { text: `${fmtDate(c.date)} ${du.activity} に ${c.name} を追加`, ok: true, paid: false };
    const name = c.type === 'replace' ? c.from : c.name;
    const a = findA(du, name);
    if (!a) return { text: `${fmtDate(c.date)} の担当者に「${name}」がいません`, ok: false, paid: false };
    return { text: c.type === 'replace' ? `${fmtDate(c.date)} ${du.activity}: ${c.from} → ${c.to}` : `${fmtDate(c.date)} ${du.activity}: ${c.name} を取消`, ok: true, paid: !!a.txId };
  };
  const apply = () => {
    const use = rows!.filter((r) => r.use && describe(r).ok);
    const ok = update((x) => {
      for (const r of use) {
        const c = r.c;
        const du = x.duties.find((y) => y.date === c.date && !y.cancelled)!;
        if (c.type === 'cancel') cancelDuty(x, du.id, r.action);
        else if (c.type === 'add') {
          du.assignees.push({ id: uid('as_'), name: c.name, amount: du.assignees[0]?.amount ?? x.settings.dutyDefaultAmount, status: 'active' });
          du.history.push({ at: new Date().toISOString(), text: `${c.name} を追加（LINE連絡）` });
        } else {
          const a = findA(du, c.type === 'replace' ? c.from : c.name)!;
          if (c.type === 'replace') replaceAssignee(x, du.id, a.id, c.to, a.txId ? r.action : undefined);
          else cancelAssignee(x, du.id, a.id, a.txId ? r.action : undefined);
        }
      }
    }, `${use.length}件の変更を反映しました`);
    if (ok) go('/duties');
  };
  return (
    <>
      <TopBar title="LINE変更連絡から更新" back="/duties" />
      <main>
        {!rows ? (
          <>
            <Card title="変更連絡を貼り付け">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'11/24の当番 鈴木母→山本母に変更\n11/30 練習は中止です'} />
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setText(sampleChangeText())}>
                サンプル文章を入れる
              </button>
            </Card>
            <div className="fab-row">
              <button className="btn primary" disabled={!text.trim()} onClick={() => toRows(parseDutyChanges(text, d.duties))}>
                変更候補を作る（端末内）
              </button>
              <button className="btn" disabled={busy || !text.trim()} onClick={ai}>
                {busy ? 'AI解析中…' : '🤖 AIで読み取る'}
              </button>
            </div>
          </>
        ) : (
          <>
            {rows.length === 0 && <div className="empty">変更が読み取れませんでした</div>}
            {rows.map((r) => {
              const info = describe(r);
              return (
                <Card key={r.key}>
                  <Check checked={r.use && info.ok} disabled={!info.ok} onChange={(b) => setRows(rows.map((x) => (x.key === r.key ? { ...x, use: b } : x)))} label={info.text} />
                  {!info.ok && <div className="alert warn">⚠️ 反映できません。手動で確認してください。</div>}
                  {info.ok && info.paid && (
                    <div className="stack">
                      <div className="alert warn">⚠️ すでに現金を渡しています。自動削除はしません。</div>
                      <Seg<PaidAction> value={r.action} onChange={(v) => setRows(rows.map((x) => (x.key === r.key ? { ...x, action: v } : x)))} options={[['keep', '支払い済みのまま保持'], ['refund', '返金を受け取った']]} />
                    </div>
                  )}
                </Card>
              );
            })}
            <div className="fab-row">
              <button className="btn" onClick={() => setRows(null)}>
                ← 戻る
              </button>
              <button className="btn primary" disabled={!rows.some((r) => r.use && describe(r).ok)} onClick={apply}>
                確認して反映
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function normalizeChange(c: DutyChange & Record<string, string>): DutyChange {
  if (c.type === 'replace') return { type: 'replace', date: c.date, from: c.from, to: c.to };
  if (c.type === 'cancel') return { type: 'cancel', date: c.date, reason: c.reason };
  if (c.type === 'add') return { type: 'add', date: c.date, name: c.name };
  return { type: 'remove', date: c.date, name: c.name };
}

