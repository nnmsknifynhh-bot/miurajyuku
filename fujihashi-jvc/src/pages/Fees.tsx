import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Amt, Card, Check, Field, Modal, NumInput, Seg, TopBar } from '../components/ui';
import { payFee } from '../lib/fees';
import { voidTx } from '../lib/ledger';
import { buildLineMessage, dueLabel, lineShareUrl } from '../lib/line';
import type { Member } from '../lib/types';
import { addMonths, fmtDate, fmtMonth, monthOf, today, uid, yen } from '../lib/util';

export function Fees() {
  const { data: d, update } = useStore();
  const [month, setMonth] = useState(monthOf(today()));
  const [filter, setFilter] = useState<'unpaid' | 'all'>('all');
  const [lineOpen, setLineOpen] = useState(false);
  const charges = d.fees.filter((f) => f.month === month);
  const rows = d.members
    .map((m) => ({ m, f: charges.find((c) => c.memberId === m.id) }))
    .filter((r) => r.f && (filter === 'all' || (!r.f.txId && !r.f.waived)));
  const paid = charges.filter((c) => c.txId);
  const unpaid = charges.filter((c) => !c.txId && !c.waived);

  const tap = (feeId: string, name: string) => {
    let txId = '';
    update(
      (x) => {
        txId = payFee(x, feeId).id;
      },
      () => ({ text: `${name} の部費を受け取りました`, undo: () => update((x) => voidTx(x, txId, '入力直後の取り消し'), '取り消しました') }),
    );
  };

  return (
    <>
      <TopBar title="部費" right={<a className="btn small" href="#/members">部員名簿</a>} />
      <main>
        <div className="row">
          <button className="btn small" onClick={() => setMonth(addMonths(month, -1))} aria-label="前月">
            ‹
          </button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ flex: 1 }} />
          <button className="btn small" onClick={() => setMonth(addMonths(month, 1))} aria-label="翌月">
            ›
          </button>
        </div>
        <div className="grid2">
          <div className="card stat">
            <div className="label">入金済み {paid.length}名</div>
            <div className="val in">{yen(paid.reduce((a, f) => a + f.amount, 0))}</div>
          </div>
          <div className="card stat">
            <div className="label">未入金 {unpaid.length}名</div>
            <div className="val out">{yen(unpaid.reduce((a, f) => a + f.amount, 0))}</div>
          </div>
        </div>
        {unpaid.length > 0 && (
          <button className="btn line block" onClick={() => setLineOpen(true)}>
            💬 未入金者へのLINE確認メッセージを作成
          </button>
        )}
        <Seg value={filter} onChange={setFilter} options={[['all', 'すべて'], ['unpaid', '未入金のみ']]} />
        <Card>
          {charges.length === 0 ? (
            <div className="empty">
              {fmtMonth(month)}の部費予定はありません。
              <br />
              （名簿に部員を登録すると毎月自動で作成されます）
            </div>
          ) : (
            <ul className="list">
              {rows.map(({ m, f }) => (
                <li key={m.id}>
                  <div className="main">
                    <div className="title">{m.name}</div>
                    <div className="meta">
                      {m.grade} {m.guardian}・期限 {fmtDate(f!.dueDate)}
                      {f!.waived && <span className="chip">免除</span>}
                    </div>
                  </div>
                  <Amt v={f!.amount} />
                  {f!.txId ? (
                    <button className="pay done" disabled aria-label="入金済み">
                      ✓済
                    </button>
                  ) : f!.waived ? (
                    <button className="pay" onClick={() => update((x) => void (x.fees.find((y) => y.id === f!.id)!.waived = false))}>
                      戻す
                    </button>
                  ) : (
                    <button className="pay" onClick={() => tap(f!.id, m.name)} aria-label={`${m.name}の入金を記録`}>
                      受取
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="muted">「受取」を1回タップすると今日の日付で現金出納帳に入金が記録されます。間違えた場合は直後の「取り消す」、または出納帳から取り消せます。</p>
      </main>
      {lineOpen && <LineModal month={month} names={unpaid.map((f) => d.members.find((m) => m.id === f.memberId)?.name ?? '')} amount={unpaid[0]?.amount ?? 0} due={unpaid[0]?.dueDate ?? ''} onClose={() => setLineOpen(false)} />}
    </>
  );
}

export function LineModal(props: { month: string; names: string[]; amount: number; due: string; onClose: () => void; content?: string }) {
  const { data: d, toast } = useStore();
  const [text, setText] = useState(() =>
    buildLineMessage(d.settings, { content: props.content ?? `${Number(props.month.slice(5))}月分部費`, amount: yen(props.amount), due: dueLabel(props.due) }),
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('コピーしました');
    } catch {
      toast({ text: 'コピーできませんでした。長押しで選択してください', err: true });
    }
  };
  return (
    <Modal title="LINE 支払い確認メッセージ" onClose={props.onClose}>
      <div className="muted">未入金: {props.names.join('、')}（{props.names.length}名）</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 280 }} />
      <div className="row">
        <button className="btn" onClick={copy} style={{ flex: 1 }}>
          📋 コピー
        </button>
        <a className="btn line" href={lineShareUrl(text)} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
          LINEで送る
        </a>
      </div>
      <p className="muted">メッセージに個人名は入れていません。個別に送る場合は LINE で相手を選んでください。文面の雛形は設定画面で変更できます。</p>
    </Modal>
  );
}

export function Members() {
  const { data: d, update } = useStore();
  const [edit, setEdit] = useState<Member | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const list = useMemo(() => d.members.filter((m) => showInactive || m.active), [d.members, showInactive]);
  const blank = (): Member => ({ id: uid('m_'), name: '', guardian: '', grade: '', monthlyFee: d.settings.defaultMonthlyFee, active: true });
  return (
    <>
      <TopBar title={`部員名簿（${d.members.filter((m) => m.active).length}名）`} back="/fees" right={<button className="btn small primary" onClick={() => setEdit(blank())}>＋追加</button>} />
      <main>
        <Check checked={showInactive} onChange={setShowInactive} label="退部・休部中も表示" />
        <Card>
          {list.length === 0 ? (
            <div className="empty">部員が登録されていません</div>
          ) : (
            <ul className="list">
              {list.map((m) => (
                <li key={m.id} onClick={() => setEdit(m)} style={{ cursor: 'pointer' }}>
                  <div className="main">
                    <div className="title">
                      {m.name} {!m.active && <span className="chip">休・退部</span>}
                    </div>
                    <div className="meta">
                      {m.grade} {m.guardian}
                    </div>
                  </div>
                  <span className="muted">{yen(m.monthlyFee)}/月 ›</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="muted">名前は「姓 名」（例: 三浦 ゆい）で登録すると、LINE車割りの「ゆい」「三浦母」などと自動で照合できます。</p>
      </main>
      {edit && (
        <MemberModal
          m={edit}
          onClose={() => setEdit(null)}
          onSave={(m) => {
            if (!m.name.trim()) return;
            const ok = update((x) => {
              const i = x.members.findIndex((y) => y.id === m.id);
              if (i >= 0) {
                const old = x.members[i];
                x.members[i] = m;
                // 未入金の今後の部費は新しい金額に合わせる
                if (old.monthlyFee !== m.monthlyFee) for (const f of x.fees) if (f.memberId === m.id && !f.txId && f.month >= monthOf(today())) f.amount = m.monthlyFee;
              } else x.members.push(m);
            }, '保存しました');
            if (ok) setEdit(null);
          }}
        />
      )}
    </>
  );
}

function MemberModal(props: { m: Member; onClose: () => void; onSave: (m: Member) => void }) {
  const [m, setM] = useState(props.m);
  const set = (p: Partial<Member>) => setM({ ...m, ...p });
  return (
    <Modal title={props.m.name ? '部員の編集' : '部員の追加'} onClose={props.onClose}>
      <Field label="子どもの氏名（姓 名）">
        <input type="text" value={m.name} onChange={(e) => set({ name: e.target.value })} placeholder="三浦 ゆい" />
      </Field>
      <div className="row">
        <Field label="学年">
          <input type="text" value={m.grade ?? ''} onChange={(e) => set({ grade: e.target.value })} placeholder="5年" />
        </Field>
        <Field label="保護者（呼び方）">
          <input type="text" value={m.guardian} onChange={(e) => set({ guardian: e.target.value })} placeholder="三浦母" />
        </Field>
      </div>
      <Field label="毎月の部費（円）">
        <NumInput value={m.monthlyFee} onChange={(n) => set({ monthlyFee: n })} />
      </Field>
      <Field label="メモ">
        <input type="text" value={m.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <Check checked={m.active} onChange={(b) => set({ active: b })} label="在籍中（部費を自動作成する）" />
      <button className="btn primary block" disabled={!m.name.trim()} onClick={() => props.onSave(m)}>
        保存
      </button>
    </Modal>
  );
}
