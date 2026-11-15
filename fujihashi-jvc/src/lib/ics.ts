import type { Reminder } from './reminders';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** スマホのカレンダーに取り込むとアラームで通知される .ics を作る（追加費用なし） */
export function remindersToIcs(list: Reminder[], hour: number, minute: number, teamName: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fujihashi-jvc//kaikei//JA', 'CALSCALE:GREGORIAN'];
  for (const r of list) {
    const day = r.notifyFrom.replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.key.replace(/[^a-z0-9:_-]/gi, '')}-${day}@jvc-kaikei`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${hh}${mm}00`,
      `DURATION:PT15M`,
      `SUMMARY:${esc(`[${teamName}会計] ${r.title}`)}`,
      `DESCRIPTION:${esc(`期限 ${r.due}\n${r.amount.toLocaleString()}円`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(r.title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
