import { useStore } from '../store';
import { Amt, Card, TopBar } from '../components/ui';
import { activeTxs, balance, CATEGORY_LABEL } from '../lib/ledger';
import { outstanding } from '../lib/fees';
import { dayTitle, driverBase, fareStats } from '../lib/day';
import { prepGroups } from '../lib/expense';
import { dayLabel } from '../lib/holidays';
import { fmtDate, monthOf, today, yen } from '../lib/util';

export function useOutstanding() {
  const { data: d } = useStore();
  const t = today();
  const fees = d.bills.filter((b) => outstanding(b) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const fares = d.days.flatMap((day) => {
    const st = fareStats(d.settings, day);
    return st.unpaid.length || st.unknown.length ? [{ day, ...st }] : [];
  });
  const driversDue = d.days.flatMap((day) => day.driverPay.payments.filter((p) => !p.txId).map((p) => ({ day, p, amount: p.amountOverride ?? driverBase(day) })));
  const preps = d.days.flatMap((day) => day.duties.filter((du) => !du.cancelled && !du.handedTxId).map((du) => ({ day, du })));
  const selfExp = d.expenses.filter((e) => e.funding === 'self' && !e.settleTxId);
  const prepSet = prepGroups(d).filter((g) => !g.settled && (g.spent > 0 || d.days.find((x) => x.id === g.dayId)!.date < t));
  return { t, fees, fares, driversDue, preps, selfExp, prepSet };
}

export function Home() {
  const { data: d } = useStore();
  const o = useOutstanding();
  const month = monthOf(o.t);
  const days = d.days.filter((x) => monthOf(x.date) === month).sort((a, b) => a.date.localeCompare(b.date));
  const hh = (id: string) => d.households.find((h) => h.id === id);
  const recent = [...activeTxs(d)].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <>
      <TopBar
        title={`${d.settings.teamName} 会計`}
        right={
          <a className="icon-btn" href="#/settings" aria-label="設定" style={{ textDecoration: 'none' }}>
            ⚙️
          </a>
        }
      />
      <main>
        <section className="card hero">
          <div className="label">現在の現金残高</div>
          <div className="big">{yen(balance(d))}</div>
          <div className="sub">
            未回収 {yen(sum(o.fees.map(outstanding)) + sum(o.fares.map((f) => f.unpaid.reduce((a, u) => a + u.fare, 0))))} ／ 未払い{' '}
            {yen(sum(o.driversDue.map((x) => x.amount ?? 0)) + sum(o.preps.map((x) => x.du.amount ?? 0)) + sum(o.selfExp.map((e) => e.amount)))}（残高には含みません）
          </div>
        </section>

        <div className="wide2">
          <Card title={`📅 今月の土日祝の会計ページ（${days.length}日）`} right={<a href="#/days" className="muted">カレンダー ›</a>}>
            {days.length === 0 ? (
              <div className="empty">
                今月の会計ページはまだありません。
                <br />
                <a href="#/schedule">月間予定表を取り込む</a>
              </div>
            ) : (
              <ul className="list">
                {days.map((day) => {
                  const st = fareStats(d.settings, day);
                  const todo = st.unpaid.length + day.duties.filter((x) => !x.cancelled && !x.handedTxId).length + day.driverPay.payments.filter((p) => !p.txId).length;
                  return (
                    <li key={day.id}>
                      <a className="main" href={`#/day/${day.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="title">
                          {fmtDate(day.date)} {dayTitle(day)}
                        </div>
                        <div className="meta">
                          {dayLabel(day.date)}・{day.activities.map((a) => a.venue).filter(Boolean).join('、') || '会場未設定'}{' '}
                          {day.review.length > 0 && <span className="chip warn">要確認{day.review.length}</span>} {todo > 0 ? <span className="chip info">未処理{todo}</span> : <span className="chip ok">完了</span>}
                        </div>
                      </a>
                      <span className="muted">›</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title={`💴 月謝の未回収（${o.fees.length}件）`} right={<a href="#/fees" className="muted">月謝 ›</a>}>
            {o.fees.length === 0 ? (
              <div className="empty">未回収はありません</div>
            ) : (
              <ul className="list">
                {o.fees.slice(0, 8).map((b) => (
                  <li key={b.id}>
                    <div className="main">
                      <div className="title">{hh(b.householdId)?.name}</div>
                      <div className="meta">
                        {Number(b.month.slice(5))}月分・期限 {fmtDate(b.dueDate)} {b.dueDate < o.t && <span className="chip bad">期限超過</span>}
                      </div>
                    </div>
                    <Amt v={outstanding(b)} />
                  </li>
                ))}
                {o.fees.length > 8 && <li className="muted">ほか {o.fees.length - 8} 件</li>}
              </ul>
            )}
          </Card>

          <Card title="🚗 遠征交通費の未集金">
            {o.fares.length === 0 ? (
              <div className="empty">未集金はありません</div>
            ) : (
              <ul className="list">
                {o.fares.map((f) => (
                  <li key={f.day.id}>
                    <a className="main" href={`#/day/${f.day.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">
                        {fmtDate(f.day.date)} {dayTitle(f.day)} {f.day.date < o.t && f.unpaid.length > 0 && <span className="chip bad">当日を過ぎています</span>}
                      </div>
                      <div className="meta">
                        {f.unpaid.map((u) => u.r.name).join('、')}
                        {f.unknown.length > 0 && <span className="chip warn">金額要確認 {f.unknown.length}名</span>}
                      </div>
                    </a>
                    <Amt v={f.unpaid.reduce((a, u) => a + u.fare, 0)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="⛽ 運転手への未払い">
            {o.driversDue.length === 0 ? (
              <div className="empty">未払いはありません</div>
            ) : (
              <ul className="list">
                {o.driversDue.map(({ day, p, amount }) => (
                  <li key={p.id}>
                    <a className="main" href={`#/day/${day.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">{p.driverName}</div>
                      <div className="meta">
                        {fmtDate(day.date)} {dayTitle(day)} {day.date > o.t ? '・遠征後に支払い' : ''}
                      </div>
                    </a>
                    {amount === null ? <span className="chip warn">金額未確定</span> : <Amt v={amount} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="🙋 当番への準備金 未渡し">
            {o.preps.length === 0 ? (
              <div className="empty">未渡しはありません</div>
            ) : (
              <ul className="list">
                {o.preps.map(({ day, du }) => (
                  <li key={du.id}>
                    <a className="main" href={`#/day/${day.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">{du.name}</div>
                      <div className="meta">
                        {fmtDate(day.date)} {dayTitle(day)} {day.date <= o.t && <span className="chip bad">活動日を過ぎています</span>}
                      </div>
                    </a>
                    {du.amount === null ? <span className="chip warn">金額要確認</span> : <Amt v={du.amount} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="🧾 未精算の経費" right={<a href="#/expenses" className="muted">経費 ›</a>}>
            {o.selfExp.length + o.prepSet.length === 0 ? (
              <div className="empty">未精算はありません</div>
            ) : (
              <ul className="list">
                {o.selfExp.map((e) => (
                  <li key={e.id}>
                    <a className="main" href={`#/expense/${e.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">{e.purchaser}（立て替え）</div>
                      <div className="meta">
                        {fmtDate(e.date)} {e.items}
                      </div>
                    </a>
                    <Amt v={e.amount} />
                  </li>
                ))}
                {o.prepSet.map((g) => (
                  <li key={g.dayId + g.person}>
                    <a className="main" href={`#/day/${g.dayId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">{g.person}（準備金の差額）</div>
                      <div className="meta">
                        {g.label}・渡し {yen(g.handed)} / 購入 {yen(g.spent)}
                      </div>
                    </a>
                    <span className="amt">{g.remaining > 0 ? `支払 ${yen(g.remaining)}` : g.remaining < 0 ? `返金 ${yen(-g.remaining)}` : '差額なし'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="📒 最近の入出金" right={<a href="#/ledger" className="muted">出納帳 ›</a>}>
          {recent.length === 0 ? (
            <div className="empty">まだ記録はありません</div>
          ) : (
            <ul className="list">
              {recent.map((t) => (
                <li key={t.id}>
                  <div className="main">
                    <div className="title">{t.description}</div>
                    <div className="meta">
                      {fmtDate(t.date)}・{t.counterparty}・{CATEGORY_LABEL[t.category]}
                    </div>
                  </div>
                  <Amt v={t.amount} dir={t.direction} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
