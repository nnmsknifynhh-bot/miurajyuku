import { useState } from 'react';
import { useStore } from '../store';
import { Card, Check, Field, Seg, TopBar, go, needs } from '../components/ui';
import { applyScheduleChange, dayTitle, describeChange, diffSchedule, newDay, type ScheduleChange } from '../lib/day';
import { parseScheduleText, type ScheduleItem } from '../lib/scheduleParser';
import { COL_LABEL, guessMapping, parseTable, tableToItems, type ColRole, type Mapping } from '../lib/sheetImport';
import { dayLabel, holidayName, isWeekendOrHoliday } from '../lib/holidays';
import { sampleScheduleText } from '../lib/sample';
import { addMonths, fmtDate, monthEnd, monthOf, today, uid, weekday } from '../lib/util';

export function Days() {
  const { data: d, update } = useStore();
  const [month, setMonth] = useState(monthOf(today()));
  const t = today();
  const last = Number(monthEnd(month).slice(8));
  const firstW = weekday(`${month}-01`);
  const cells: (string | null)[] = [...Array(firstW).fill(null), ...Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const days = d.days.filter((x) => monthOf(x.date) === month).sort((a, b) => a.date.localeCompare(b.date));
  const open = (date: string) => {
    const ex = d.days.find((x) => x.date === date);
    if (ex) return go(`/day/${ex.id}`);
    if (!isWeekendOrHoliday(date) && !confirm(`${fmtDate(date)} は平日です。会計ページを作成しますか？`)) return;
    const day = newDay(date);
    if (update((x) => void x.days.push(day), '会計ページを作成しました')) go(`/day/${day.id}`);
  };
  return (
    <>
      <TopBar title="活動日（会計ページ）" />
      <main>
        <a className="btn primary" href="#/schedule">
          📄 当番表（スプレッドシート）を取り込む
        </a>
        <Card>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn small" onClick={() => setMonth(addMonths(month, -1))} aria-label="前月">‹</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>
              {month.slice(0, 4)}年{Number(month.slice(5))}月
            </div>
            <button className="btn small" onClick={() => setMonth(addMonths(month, 1))} aria-label="翌月">›</button>
          </div>
          <div className="cal">
            {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
              <div key={w} className={`h ${i === 0 ? 'we' : i === 6 ? 'sat' : ''}`}>
                {w}
              </div>
            ))}
            {cells.map((c, i) => {
              if (!c) return <span key={i} />;
              const day = d.days.find((x) => x.date === c);
              const w = weekday(c);
              const cls = [holidayName(c) || w === 0 ? 'we' : w === 6 ? 'sat' : '', day ? 'has' : '', c === t ? 'today' : ''].join(' ');
              return isWeekendOrHoliday(c) || day ? (
                <a key={c} className={cls} href={`#/days`} onClick={(e) => (e.preventDefault(), open(c))} title={holidayName(c) ?? ''}>
                  {Number(c.slice(8))}
                  {day && day.review.length > 0 && <span className="dot" />}
                </a>
              ) : (
                <span key={c} className={`c ${cls}`} style={{ color: 'var(--muted)' }}>
                  {Number(c.slice(8))}
                </span>
              );
            })}
          </div>
          <p className="muted">色付きの日付は会計ページあり。土日祝の日付を押すとページを作成できます（平日も確認のうえ作成可）。</p>
        </Card>
        <Card title={`${Number(month.slice(5))}月の会計ページ`}>
          {days.length === 0 ? (
            <div className="empty">ありません</div>
          ) : (
            <ul className="list">
              {days.map((day) => (
                <li key={day.id} onClick={() => go(`/day/${day.id}`)} style={{ cursor: 'pointer' }}>
                  <div className="main">
                    <div className="title">
                      {fmtDate(day.date)} {dayTitle(day)}
                    </div>
                    <div className="meta">
                      {dayLabel(day.date)}・当番 {day.duties.filter((x) => !x.cancelled).map((x) => x.name).join('、') || 'なし'} {day.review.length > 0 && <span className="chip warn">要確認{day.review.length}</span>}
                    </div>
                  </div>
                  <span className="muted">›</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}

interface Row extends ScheduleItem { key: string; use: boolean; dutiesText: string }

const SAMPLE_SHEET = (t: string) => {
  const lines = sampleScheduleText(t).split('\n');
  const row = (l: string) => {
    const m = l.match(/^(\S+) (.+?)(?: @(\S+))?(?: 当番：(.+))?$/);
    return m ? [m[1], m[2], m[3] ?? '', ...(m[4] ?? '').split(/[、・]/)].join('\t') : l;
  };
  return ['日付\t活動\t会場\t当番1\t当番2', ...lines.map(row)].join('\n');
};

export function ScheduleImport() {
  const { data: d, update, toast } = useStore();
  const [mode, setMode] = useState<'sheet' | 'text'>('sheet');
  const [text, setText] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [changes, setChanges] = useState<{ c: ScheduleChange; use: boolean }[] | null>(null);

  const toRows = (items: ScheduleItem[]) =>
    setRows(
      items.map((it) => {
        const review = [...it.review];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) review.push('日付');
        if (needs(it.activity)) review.push('活動名');
        it.duties.forEach((n) => needs(n) && review.push('当番氏名'));
        return { ...it, review: [...new Set(review)], key: uid(), use: /^\d{4}-\d{2}-\d{2}$/.test(it.date) && isWeekendOrHoliday(it.date), dutiesText: it.duties.join('、') };
      }),
    );

  const loadTable = (raw: string) => {
    const t = parseTable(raw);
    if (!t.length) return toast({ text: '表が読み取れません', err: true });
    setTable(t);
    setMap(guessMapping(t));
  };

  const readCsvFile = async (f: File) => {
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('\ufffd')) txt = new TextDecoder('shift_jis').decode(buf); // Excel の CSV（Shift_JIS）
    setText(txt);
    loadTable(txt);
  };

  const toChanges = () => {
    const use = rows!.filter((r) => r.use);
    const bad = use.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date));
    if (bad) return toast({ text: '日付が正しくない行があります', err: true });
    const items = use.map((r) => ({ date: r.date, activity: r.activity.trim() || '要確認', venue: r.venue.trim(), duties: r.dutiesText.split(/[、,・\s]+/).filter(Boolean), review: r.review }));
    // 確認する日付の範囲だけで比較（他の月のページは対象外）
    const dates = new Set(items.map((i) => i.date));
    const scoped = { ...d, days: d.days.filter((x) => dates.has(x.date)) };
    setChanges(diffSchedule(scoped, items).map((c) => ({ c, use: c.kind !== 'missingActivity' })));
  };

  const apply = () => {
    const use = changes!.filter((x) => x.use);
    if (update((x) => use.forEach(({ c }) => applyScheduleChange(x, c)), `${use.length}件を反映しました`)) go('/days');
  };

  const setRow = (k: string, p: Partial<Row>) => setRows(rows!.map((r) => (r.key === k ? { ...r, ...p } : r)));

  return (
    <>
      <TopBar title="当番表（予定表）の取り込み" back="/days" />
      <main>
        {!rows && table && map ? (
          <>
            <div className="alert info">列の意味を確認してください。見出し行から自動で判定しています（違う場合は選び直してください）。</div>
            <Card title="列の対応">
              <div className="stack">
                <Field label="見出しの行">
                  <select value={map.headerRow} onChange={(e) => setMap({ ...map, headerRow: Number(e.target.value) })}>
                    <option value={-1}>見出しなし</option>
                    {table.slice(0, 6).map((r, i) => (
                      <option key={i} value={i}>
                        {i + 1}行目: {r.filter(Boolean).join(' / ').slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl" style={{ minWidth: map.cols.length * 110 }}>
                    <thead>
                      <tr>
                        {map.cols.map((c, j) => (
                          <th key={j} style={{ textAlign: 'left' }}>
                            <select value={c} className={c === 'ignore' ? '' : 'on'} style={{ minHeight: 36, padding: '2px 4px', fontSize: 13 }} onChange={(e) => setMap({ ...map, cols: map.cols.map((x, k) => (k === j ? (e.target.value as ColRole) : x)) })}>
                              {(Object.keys(COL_LABEL) as ColRole[]).map((k) => (
                                <option key={k} value={k}>
                                  {COL_LABEL[k]}
                                </option>
                              ))}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.slice(Math.max(0, map.headerRow), Math.max(0, map.headerRow) + 6).map((r, i) => (
                        <tr key={i} style={i === 0 && map.headerRow >= 0 ? { color: 'var(--muted)' } : undefined}>
                          {map.cols.map((_, j) => (
                            <td key={j} style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                              {r[j] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!map.cols.includes('date') && <div className="alert warn">⚠️ 「日付」の列を選んでください</div>}
              </div>
            </Card>
            <div className="fab-row">
              <button className="btn" onClick={() => setTable(null)}>← 戻る</button>
              <button className="btn primary" disabled={!map.cols.includes('date')} onClick={() => toRows(tableToItems(table, map))}>
                この対応で読み取る →
              </button>
            </div>
          </>
        ) : !rows ? (
          <>
            <Seg value={mode} onChange={setMode} options={[['sheet', 'スプレッドシート'], ['text', 'テキスト']]} />
            {mode === 'sheet' ? (
              <Card title="当番表を貼り付け">
                <div className="stack">
                  <div className="muted">Googleスプレッドシート や Excel で当番表の範囲（見出し行を含む）を選んでコピーし、下に貼り付けてください。</div>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'日付\t活動\t会場\t当番1\t当番2\n11/21\t練習\t藤橋小\t田中母\t佐藤父'} />
                  <div className="row">
                    <label className="btn small">
                      CSVファイルを選ぶ
                      <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readCsvFile(e.target.files[0])} />
                    </label>
                    <button className="btn small" onClick={() => setText(SAMPLE_SHEET(today()))}>
                      サンプルを入れる
                    </button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card title="予定表のテキストを貼り付け">
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'11/21(土) 練習 @藤橋小体育館 当番：田中母、佐藤父\n11/22(日) 練習試合 @市民体育館 当番：鈴木母'} />
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => setText(sampleScheduleText())}>
                  サンプル文章を入れる
                </button>
              </Card>
            )}
            <button className="btn primary" disabled={!text.trim()} onClick={() => (mode === 'sheet' ? loadTable(text) : toRows(parseScheduleText(text)))}>
              {mode === 'sheet' ? '列を確認する →' : '読み取る'}
            </button>
          </>
        ) : !changes ? (
          <>
            <div className="alert info">① 読み取り結果を確認・修正し、取り込む行にチェックしてください。土日祝の活動だけ初期チェックしています。</div>
            {rows.length === 0 && <div className="empty">活動を読み取れませんでした</div>}
            {rows.map((r) => (
              <Card key={r.key}>
                <Check checked={r.use} onChange={(b) => setRow(r.key, { use: b })} label={<b>{/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? `${fmtDate(r.date)} ${dayLabel(r.date)}` : '日付 要確認'}</b>} />
                {/^\d{4}-\d{2}-\d{2}$/.test(r.date) && !isWeekendOrHoliday(r.date) && <div className="alert info">平日の活動です（対象外。必要ならチェック）</div>}
                {r.review.length > 0 && <div className="alert warn">⚠️ 要確認: {r.review.join('、')}</div>}
                <div className="row">
                  <Field label="日付">
                    <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : ''} className={/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? '' : 'needs'} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                  </Field>
                  <Field label="活動名">
                    <input type="text" value={r.activity} className={needs(r.activity) ? 'needs' : ''} onChange={(e) => setRow(r.key, { activity: e.target.value })} />
                  </Field>
                </div>
                <div className="row">
                  <Field label="会場">
                    <input type="text" value={r.venue} className={r.venue.includes('要確認') ? 'needs' : ''} onChange={(e) => setRow(r.key, { venue: e.target.value })} />
                  </Field>
                  <Field label="当番（、区切り）">
                    <input type="text" value={r.dutiesText} className={r.dutiesText.includes('要確認') ? 'needs' : ''} onChange={(e) => setRow(r.key, { dutiesText: e.target.value })} />
                  </Field>
                </div>
              </Card>
            ))}
            <div className="fab-row">
              <button className="btn" onClick={() => setRows(null)}>← 戻る</button>
              <button className="btn primary" disabled={!rows.some((r) => r.use)} onClick={toChanges}>
                変更点を確認 →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="alert info">② 既存の会計ページとの違いです。反映する項目にチェックしてください。集金・支払いなどの記録は消えません。</div>
            {changes.length === 0 && <div className="alert info">✅ 変更はありません（すでに反映済み）</div>}
            <Card>
              {changes.map((x, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : undefined, padding: '4px 0' }}>
                  <Check
                    checked={x.use}
                    onChange={(b) => setChanges(changes.map((y, j) => (j === i ? { ...y, use: b } : y)))}
                    label={
                      <>
                        {describeChange(x.c)} {x.c.kind === 'missingDuty' && x.c.paid && <span className="chip warn">要確認</span>}
                      </>
                    }
                  />
                </div>
              ))}
            </Card>
            <div className="fab-row">
              <button className="btn" onClick={() => setChanges(null)}>← 戻る</button>
              <button className="btn primary" disabled={!changes.some((x) => x.use)} onClick={apply}>
                {changes.filter((x) => x.use).length}件を反映
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
