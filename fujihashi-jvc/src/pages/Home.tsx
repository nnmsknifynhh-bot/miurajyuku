import { useStore } from '../store';
import { Amt, Card, TopBar } from '../components/ui';
import { balance } from '../lib/ledger';
import { unpaidFees } from '../lib/fees';
import { expeditionStats, riderAmount, settleDueOf } from '../lib/expedition';
import { activeAssignees } from '../lib/duty';
import { computeReminders } from '../lib/reminders';
import { addDays, fmtDate, today, yen } from '../lib/util';

export function useOutlook() {
  const { data: d } = useStore();
  const t = today();
  const fees = unpaidFees(d, t);
  const feeDueNow = fees.filter((f) => f.dueDate <= t);
  const transport = d.expeditions.flatMap((e) =>
    e.rule.collectTransport ? expeditionStats(e).unpaid.map((u) => ({ e, ...u, amount: riderAmount(e, u.rider) })) : [],
  );
  const transportDueNow = transport.filter((x) => x.e.collectDue <= t);
  const unsettled = d.expeditions.flatMap((e) => expeditionStats(e).unsettled.map((x) => ({ e, x, due: settleDueOf(d, e) })));
  const unsettledDone = unsettled.filter((u) => u.e.date <= t);
  const dutyPays = d.duties.flatMap((du) => activeAssignees(du).filter((a) => !a.txId).map((a) => ({ du, a })));
  const dutyNow = dutyPays.filter((p) => p.du.date <= t);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const allFees = d.fees.filter((f) => !f.txId && !f.waived);
  return {
    t,
    fees,
    transport,
    unsettled,
    unsettledDone,
    dutyPays,
    collectNow: sum(feeDueNow.map((f) => f.amount)) + sum(transportDueNow.map((x) => x.amount)),
    payNow: sum(dutyNow.map((p) => p.a.amount)) + sum(unsettledDone.filter((u) => u.due <= t).map((u) => u.x.amount ?? u.x.estimate ?? 0)),
    futureIn: sum(allFees.map((f) => f.amount)) + sum(transport.map((x) => x.amount)),
    futureOut: sum(dutyPays.map((p) => p.a.amount)) + sum(unsettled.map((u) => u.x.amount ?? u.x.estimate ?? 0)),
  };
}

export function Home() {
  const { data: d } = useStore();
  const o = useOutlook();
  const reminders = computeReminders(d, o.t);
  const overdue = reminders.filter((r) => r.level === 'overdue');
  const todayR = reminders.filter((r) => r.level === 'today');
  const member = (id: string) => d.members.find((m) => m.id === id);
  const bal = balance(d);
  const upcomingDuty = o.dutyPays.filter((p) => p.du.date <= addDays(o.t, 14)).sort((a, b) => a.du.date.localeCompare(b.du.date));

  return (
    <>
      <TopBar
        title={`${d.settings.teamName} 会計`}
        right={
          <>
            <a className="icon-btn" href="#/reminders" aria-label="リマインド" style={{ textDecoration: 'none' }}>
              🔔{reminders.length ? <sup style={{ color: 'var(--bad)', fontSize: 11 }}>{reminders.length}</sup> : null}
            </a>
            <a className="icon-btn" href="#/settings" aria-label="設定" style={{ textDecoration: 'none' }}>
              ⚙️
            </a>
          </>
        }
      />
      <main>
        <section className="card hero">
          <div className="label">現在の現金残高</div>
          <div className="big">{yen(bal)}</div>
          <div className="sub">
            今後の予定 集金 {yen(o.futureIn)} / 支払い {yen(o.futureOut)}（残高には含みません）
          </div>
        </section>

        <div className="grid2">
          <a className="card stat" href="#/reminders">
            <div className="label">今日までに集めるお金</div>
            <div className="val in">{yen(o.collectNow)}</div>
          </a>
          <a className="card stat" href="#/reminders">
            <div className="label">今日までに渡すお金</div>
            <div className="val out">{yen(o.payNow)}</div>
          </a>
        </div>

        {(overdue.length > 0 || todayR.length > 0) && (
          <div className="stack">
            {overdue.map((r) => (
              <a key={r.key} className="alert bad" href={r.link}>
                ⚠️ <span><b>期限超過</b> {r.title}（期限 {fmtDate(r.due)}）</span>
              </a>
            ))}
            {todayR.map((r) => (
              <a key={r.key} className="alert warn" href={r.link}>
                ⏰ <span><b>今日</b> {r.title}</span>
              </a>
            ))}
          </div>
        )}

        <Card title={`💴 部費の未払い（${o.fees.length}件）`} right={<a href="#/fees" className="muted">すべて ›</a>}>
          {o.fees.length === 0 ? (
            <div className="empty">未払いはありません 🎉</div>
          ) : (
            <ul className="list">
              {o.fees.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <div className="main">
                    <div className="title">{member(f.memberId)?.name}</div>
                    <div className="meta">
                      {Number(f.month.slice(5))}月分・期限 {fmtDate(f.dueDate)} {f.dueDate < o.t && <span className="chip bad">超過</span>}
                    </div>
                  </div>
                  <Amt v={f.amount} />
                </li>
              ))}
              {o.fees.length > 6 && <li className="muted">ほか {o.fees.length - 6} 件</li>}
            </ul>
          )}
        </Card>

        <Card title={`🚗 遠征費の未回収（${o.transport.length}名）`} right={<a href="#/exp" className="muted">遠征 ›</a>}>
          {o.transport.length === 0 ? (
            <div className="empty">未回収はありません</div>
          ) : (
            <ul className="list">
              {groupBy(o.transport, (x) => x.e.id).map(([id, xs]) => (
                <li key={id}>
                  <a className="main" href={`#/exp/${id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="title">
                      {xs[0].e.title}（{fmtDate(xs[0].e.date)}）
                    </div>
                    <div className="meta">
                      集金期限 {fmtDate(xs[0].e.collectDue)}・{xs.map((x) => x.rider.name).join('、')}
                    </div>
                  </a>
                  <Amt v={xs.reduce((a, x) => a + x.amount, 0)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`⛽ ガソリン代・高速代の未精算（${o.unsettledDone.length}件）`}>
          {o.unsettled.length > o.unsettledDone.length && (
            <div className="muted">これからの遠征の精算予定 {o.unsettled.length - o.unsettledDone.length}件（活動後に表示）</div>
          )}
          {o.unsettledDone.length === 0 ? (
            <div className="empty">未精算はありません</div>
          ) : (
            <ul className="list">
              {o.unsettledDone.map(({ e, x, due }) => (
                <li key={x.id}>
                  <a className="main" href={`#/exp/${e.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="title">{x.label} → {x.payee}</div>
                    <div className="meta">
                      {e.title}（{fmtDate(e.date)}）{e.date > o.t ? '・活動後に精算' : `・精算期限 ${fmtDate(due)}`}{' '}
                      {!x.confirmed && <span className="chip warn">金額未確定</span>}
                      {due < o.t && <span className="chip bad">超過</span>}
                    </div>
                  </a>
                  <span className="amt">{x.amount !== undefined ? yen(x.amount) : x.estimate ? `見積${yen(x.estimate)}` : '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="🙋 直近の当番への支払い予定" right={<a href="#/duties" className="muted">当番 ›</a>}>
          {upcomingDuty.length === 0 ? (
            <div className="empty">2週間以内の支払い予定はありません</div>
          ) : (
            <ul className="list">
              {upcomingDuty.map(({ du, a }) => (
                <li key={a.id}>
                  <div className="main">
                    <div className="title">{a.name}</div>
                    <div className="meta">
                      {fmtDate(du.date)} {du.activity} {du.date < o.t ? <span className="chip bad">超過</span> : du.date === o.t ? <span className="chip warn">今日</span> : du.date === addDays(o.t, 1) ? <span className="chip info">明日</span> : null}
                    </div>
                  </div>
                  <Amt v={a.amount} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}

function groupBy<T>(xs: T[], k: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
  return [...m.entries()];
}
