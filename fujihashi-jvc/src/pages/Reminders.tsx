import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Amt, Card, TopBar } from '../components/ui';
import { computeReminders, dueNotifications, KIND_LABEL, type ReminderKind } from '../lib/reminders';
import { remindersToIcs } from '../lib/ics';
import { download } from '../lib/csv';
import { fmtDate, today } from '../lib/util';

function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** アプリを開いている間、通知時刻を過ぎたリマインドを端末通知で表示 */
export function useNotifier() {
  const { data, update } = useStore();
  useEffect(() => {
    const tick = async () => {
      if (!notifySupported() || Notification.permission !== 'granted') return;
      const list = dueNotifications(data);
      if (!list.length) return;
      const title = `${data.settings.teamName} 会計: ${list.length}件のリマインド`;
      const body = list.slice(0, 4).map((r) => `・${r.title}`).join('\n');
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(title, { body, tag: 'jvc-reminder', icon: '/icon.svg' });
        else new Notification(title, { body, tag: 'jvc-reminder' });
      } catch {
        return;
      }
      const t = today();
      update((x) => list.forEach((r) => (x.reminderState.notified[r.key] = t)));
    };
    tick();
    const iv = window.setInterval(tick, 60_000);
    return () => window.clearInterval(iv);
  }, [data, update]);
}

export function Reminders() {
  const { data: d, update, toast } = useStore();
  const t = today();
  const all = computeReminders(d, t);
  const list = all.filter((r) => d.reminderState.dismissed[r.key] !== t);
  const [perm, setPerm] = useState(notifySupported() ? Notification.permission : 'unsupported');
  const ask = async () => {
    if (!notifySupported()) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') toast('通知を許可しました。アプリを開いている時に通知時刻を過ぎると通知します');
  };
  const ics = () => {
    const future = computeReminders(d, t, true).filter((r) => r.notifyFrom >= t || r.level !== 'soon');
    if (!future.length) return toast('予定されているリマインドはありません');
    download(`jvc-reminders-${t}.ics`, remindersToIcs(future.map((r) => ({ ...r, notifyFrom: r.notifyFrom < t ? t : r.notifyFrom })), d.settings.reminders.notifyHour, d.settings.reminders.notifyMinute, d.settings.teamName), 'text/calendar;charset=utf-8');
  };
  const kinds: ReminderKind[] = ['fee', 'transport', 'duty', 'settle'];
  return (
    <>
      <TopBar title="リマインド" back="/" />
      <main>
        {list.length === 0 && <div className="alert info">✅ 今日対応が必要なリマインドはありません</div>}
        {kinds.map((k) => {
          const xs = list.filter((r) => r.kind === k);
          if (!xs.length) return null;
          return (
            <Card key={k} title={KIND_LABEL[k]}>
              <ul className="list">
                {xs.map((r) => (
                  <li key={r.key}>
                    <a className="main" href={r.link} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="title">
                        {r.level === 'overdue' && <span className="chip bad">期限超過</span>} {r.level === 'today' && <span className="chip warn">今日</span>} {r.title}
                      </div>
                      <div className="meta">
                        期限 {fmtDate(r.due)}・{r.detail}
                      </div>
                    </a>
                    <Amt v={r.amount} dir={r.direction} />
                    <button className="icon-btn" title="今日は非表示" aria-label="今日は非表示" onClick={() => update((x) => void (x.reminderState.dismissed[r.key] = t))}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        <Card title="🔔 スマホへの通知">
          <div className="stack">
            {perm === 'unsupported' ? (
              <div className="muted">この環境は通知に対応していません。iPhone はホーム画面に追加したアプリ（iOS 16.4以降）で通知を利用できます。</div>
            ) : perm === 'granted' ? (
              <div className="alert info">通知は許可されています（毎日 {d.settings.reminders.notifyHour}:{String(d.settings.reminders.notifyMinute).padStart(2, '0')} 以降、アプリを開いた時・開いている間に通知）</div>
            ) : perm === 'denied' ? (
              <div className="alert warn">通知がブロックされています。端末の設定から許可してください。</div>
            ) : (
              <button className="btn primary" onClick={ask}>
                通知を許可する
              </button>
            )}
            <button className="btn" onClick={ics}>
              📅 リマインドをカレンダーに追加（.ics）
            </button>
            <div className="muted">
              アプリを閉じている間も確実に知らせたい場合は、.ics ファイルをスマホのカレンダーに取り込んでください。指定時刻にカレンダーのアラームで通知されます（追加費用なし）。データが変わったら取り込み直してください。通知時刻は設定画面で変更できます。
            </div>
          </div>
        </Card>
      </main>
    </>
  );
}
