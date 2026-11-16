/**
 * 三浦塾 宿題 自動採点サーバー（Google Apps Script）
 *
 * 流れ:
 *   生徒が問題集の写真を送る → Googleドライブの解答と照らし合わせて Gemini が採点
 *   → 先生の「採点」タブに届く → 先生が確認して「返却」→ 生徒の「宿題」タブに返る
 *
 * 保存場所（setup() を実行すると自動で作られます）:
 *   マイドライブ/三浦塾_採点/解答/<問題集名>/   … 解答のPDF・写真・ドキュメントを入れる
 *   マイドライブ/三浦塾_採点/提出写真/          … 生徒の答案写真が保存される
 *   マイドライブ/三浦塾_採点/提出一覧（スプレッドシート） … 提出・採点・返却の記録
 *
 * 設定手順は gas/README.md を参照してください。
 */

// ============================================================
// ★ 設定（ここだけ書き換えてください）
// ============================================================
const CONFIG = {
  // Google AI Studio（https://aistudio.google.com/apikey）で無料取得したキー
  GEMINI_API_KEY: 'ここにGeminiのAPIキーを貼り付け',

  // 生徒用の合言葉（アプリの grading_config.json の appToken と同じにする）
  APP_TOKEN: 'miura-juku-2026',

  // 先生用の合言葉（アプリの採点タブで最初に一度だけ入力する。生徒には教えない）
  ADMIN_TOKEN: 'ここに先生だけが知る合言葉',

  // 使う Gemini モデル（上から順に試します。無料枠で使えるもの）
  GEMINI_MODELS: ['gemini-2.5-flash', 'gemini-flash-latest'],
};

const ROOT_FOLDER_NAME = '三浦塾_採点';
const ANSWER_FOLDER_NAME = '解答';
const PHOTO_FOLDER_NAME = '提出写真';
const SHEET_FILE_NAME = '提出一覧';
const SHEET_NAME = '提出';

const COLUMNS = [
  'id', '提出日時', '生徒ID', '生徒名', '問題集', 'ページ', '写真ファイルID',
  '状態', '点数', '満点', '採点結果JSON', '全体コメント', '先生コメント', '返却日時', 'エラー',
];
const COL = {};
COLUMNS.forEach((c, i) => (COL[c] = i));

const STATUS = {
  GRADING: '採点中',
  GRADED: '採点済み',
  ERROR: '採点エラー',
  RETURNED: '返却済み',
};

// ============================================================
// 初回だけ実行：フォルダとスプレッドシートを作成
// ============================================================
function setup() {
  const props = PropertiesService.getScriptProperties();
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const answers = getOrCreateFolder_(root, ANSWER_FOLDER_NAME);
  const photos = getOrCreateFolder_(root, PHOTO_FOLDER_NAME);

  let ssId = props.getProperty('SHEET_ID');
  let ss = null;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_FILE_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const sh = ss.getSheets()[0];
    sh.setName(SHEET_NAME);
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // サンプルの問題集フォルダ（中身が空なら説明ファイルを置く）
  const sample = getOrCreateFolder_(answers, 'サンプル問題集');
  if (!sample.getFiles().hasNext()) {
    sample.createFile('ここに解答を入れてください.txt',
      'このフォルダに解答ページのPDF・写真・Googleドキュメントを入れてください。\n' +
      'ファイル名にページ番号を入れておくと（例: p12-13.pdf）、生徒が入力したページの解答だけを使って採点します。\n' +
      'フォルダ名が、アプリで生徒が選ぶ「問題集名」になります。');
  }

  props.setProperties({
    ROOT_ID: root.getId(),
    ANSWER_FOLDER_ID: answers.getId(),
    PHOTO_FOLDER_ID: photos.getId(),
    SHEET_ID: ss.getId(),
  });

  Logger.log('準備完了！ マイドライブに「%s」フォルダを作成しました。', ROOT_FOLDER_NAME);
  Logger.log('スプレッドシート: %s', ss.getUrl());
}

/** 設定確認用：Gemini に短い質問をして、APIキーが有効か確かめる */
function testGemini() {
  const res = callGemini_([{ text: '「準備OK」とだけ返してください。' }], null);
  Logger.log(res);
}

// ============================================================
// Web API 入口
// ============================================================
function doGet() {
  return json_({ ok: true, message: '三浦塾 採点サーバーは動作中です' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const isAdmin = req.adminToken && req.adminToken === CONFIG.ADMIN_TOKEN;
    if (!isAdmin && req.token !== CONFIG.APP_TOKEN) {
      return json_({ ok: false, error: '合言葉が違います' });
    }
    const needAdmin = ['listAll', 'update', 'return', 'regrade', 'delete', 'checkAdmin'];
    if (needAdmin.indexOf(req.action) >= 0 && !isAdmin) {
      return json_({ ok: false, error: '先生用の合言葉が違います' });
    }

    switch (req.action) {
      case 'ping': return json_({ ok: true });
      case 'checkAdmin': return json_({ ok: true });
      case 'listWorkbooks': return json_({ ok: true, workbooks: listWorkbooks_() });
      case 'submit': return json_({ ok: true, submission: submit_(req) });
      case 'listMine': return json_({ ok: true, submissions: listMine_(req.studentId) });
      case 'getImages': return json_({ ok: true, images: getImages_(req.id, isAdmin ? null : req.studentId) });
      case 'listAll': return json_({ ok: true, submissions: listAll_() });
      case 'update': return json_({ ok: true, submission: update_(req, false) });
      case 'return': return json_({ ok: true, submission: update_(req, true) });
      case 'regrade': return json_({ ok: true, submission: regrade_(req.id) });
      case 'delete': deleteSubmission_(req.id); return json_({ ok: true });
      default: return json_({ ok: false, error: '不明な操作です: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ============================================================
// 問題集一覧
// ============================================================
function listWorkbooks_() {
  const folder = DriveApp.getFolderById(prop_('ANSWER_FOLDER_ID'));
  const it = folder.getFolders();
  const names = [];
  while (it.hasNext()) names.push(it.next().getName());
  names.sort();
  return names;
}

// ============================================================
// 提出 → 採点
// ============================================================
function submit_(req) {
  if (!req.studentId) throw new Error('生徒IDがありません');
  if (!req.workbook) throw new Error('問題集を選んでください');
  if (!req.images || !req.images.length) throw new Error('写真がありません');
  if (req.images.length > 8) throw new Error('写真は8枚までです');

  const id = Utilities.getUuid().slice(0, 8) + Date.now().toString(36);
  const now = new Date();
  const photoFolder = DriveApp.getFolderById(prop_('PHOTO_FOLDER_ID'));
  const studentFolder = getOrCreateFolder_(photoFolder, req.studentId + '_' + (req.studentName || ''));

  const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd_HHmm');
  const fileIds = req.images.map((img, i) => {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(img.base64),
      img.mimeType || 'image/jpeg',
      `${stamp}_${req.workbook}_p${req.pages || ''}_${i + 1}.jpg`);
    return studentFolder.createFile(blob).getId();
  });

  const row = new Array(COLUMNS.length).fill('');
  row[COL['id']] = id;
  row[COL['提出日時']] = now;
  row[COL['生徒ID']] = req.studentId;
  row[COL['生徒名']] = req.studentName || '';
  row[COL['問題集']] = req.workbook;
  row[COL['ページ']] = String(req.pages || '');
  row[COL['写真ファイルID']] = fileIds.join(',');
  row[COL['状態']] = STATUS.GRADING;
  sheet_().appendRow(row);

  gradeAndSave_(id);
  return toStudentView_(findRow_(id).values);
}

function regrade_(id) {
  const found = findRow_(id);
  if (!found) throw new Error('提出が見つかりません');
  setCell_(found.rowIndex, '状態', STATUS.GRADING);
  gradeAndSave_(id);
  return toAdminView_(findRow_(id).values);
}

function gradeAndSave_(id) {
  const found = findRow_(id);
  const v = found.values;
  try {
    const photos = String(v[COL['写真ファイルID']]).split(',').filter(String)
      .map((fid) => DriveApp.getFileById(fid).getBlob());
    const result = gradeWithGemini_(v[COL['問題集']], String(v[COL['ページ']]), photos);
    const items = (result.items || []).map((it) => ({
      number: String(it.number || ''),
      studentAnswer: String(it.studentAnswer || ''),
      correctAnswer: String(it.correctAnswer || ''),
      correct: !!it.correct,
      comment: String(it.comment || ''),
    }));
    const score = items.filter((it) => it.correct).length;
    writeCells_(found.rowIndex, {
      '状態': STATUS.GRADED,
      '点数': score,
      '満点': items.length,
      '採点結果JSON': JSON.stringify(items),
      '全体コメント': result.overallComment || '',
      'エラー': '',
    });
  } catch (err) {
    writeCells_(found.rowIndex, {
      '状態': STATUS.ERROR,
      'エラー': String(err && err.message ? err.message : err),
    });
  }
}

// ============================================================
// Gemini で採点
// ============================================================
function gradeWithGemini_(workbook, pages, photoBlobs) {
  const answerBlobs = findAnswerBlobs_(workbook, pages);
  if (!answerBlobs.length) {
    throw new Error(`「${workbook}」フォルダに解答ファイルがありません`);
  }

  const prompt =
    'あなたは日本の学習塾の採点係です。\n' +
    '最初に【解答】の資料、続いて【生徒の答案】の写真を渡します。\n' +
    `問題集: ${workbook}\n対象ページ: ${pages || '指定なし（写真から判断）'}\n\n` +
    '生徒の答案写真に書かれている問題を1問ずつ読み取り、解答資料の正解と照らし合わせて採点してください。\n' +
    '規則:\n' +
    '- 答案写真に写っている問題だけを採点する（写っていない問題は含めない）\n' +
    '- number は問題集の表記どおり（例: "p12 (1)", "3-(2)"）\n' +
    '- 数式・単位・表記の揺れは、意味が同じなら正解とする\n' +
    '- 記入がない問題は studentAnswer を "（無回答）" にして不正解とする\n' +
    '- 手書きが読めない場合は studentAnswer を "（判読不可）" にし、comment にその旨を書く\n' +
    '- comment は不正解の場合に、どこを間違えたか生徒向けに短く書く（正解なら空でよい）\n' +
    '- overallComment は生徒への短い励ましと、次に気をつける点（2文程度）';

  const parts = [{ text: prompt }, { text: '【解答】' }];
  answerBlobs.forEach((b) => parts.push(inline_(b)));
  parts.push({ text: '【生徒の答案】' });
  photoBlobs.forEach((b) => parts.push(inline_(b)));

  const schema = {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            number: { type: 'STRING' },
            studentAnswer: { type: 'STRING' },
            correctAnswer: { type: 'STRING' },
            correct: { type: 'BOOLEAN' },
            comment: { type: 'STRING' },
          },
          required: ['number', 'studentAnswer', 'correctAnswer', 'correct'],
        },
      },
      overallComment: { type: 'STRING' },
    },
    required: ['items', 'overallComment'],
  };

  const text = callGemini_(parts, schema);
  return JSON.parse(text);
}

function callGemini_(parts, schema) {
  if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY.indexOf('ここに') === 0) {
    throw new Error('GeminiのAPIキーが設定されていません（Code.gs の CONFIG）');
  }
  const body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: 0 },
  };
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = schema;
  }

  let lastError = '';
  for (const model of CONFIG.GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': CONFIG.GEMINI_API_KEY },
        payload: JSON.stringify(body),
        muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      if (code === 200) {
        const data = JSON.parse(res.getContentText());
        const cand = data.candidates && data.candidates[0];
        const txt = cand && cand.content && cand.content.parts &&
          cand.content.parts.map((p) => p.text || '').join('');
        if (!txt) throw new Error('Geminiから採点結果が返りませんでした');
        return txt;
      }
      lastError = `Gemini エラー (${model}, ${code}): ${res.getContentText().slice(0, 300)}`;
      if (code === 429 || code >= 500) {
        Utilities.sleep(5000 * (attempt + 1)); // 混雑・無料枠の上限 → 少し待って再試行
        continue;
      }
      break; // 404（モデル廃止など）→ 次のモデルへ
    }
  }
  throw new Error(lastError);
}

function inline_(blob) {
  return {
    inlineData: {
      mimeType: blob.getContentType(),
      data: Utilities.base64Encode(blob.getBytes()),
    },
  };
}

/**
 * 問題集フォルダから解答ファイルを集める。
 * ファイル名に数字（ページ番号）があり、生徒の指定ページと重なるものがあればそれだけを使う。
 * なければフォルダ内のすべてを使う。
 */
function findAnswerBlobs_(workbook, pages) {
  const answerRoot = DriveApp.getFolderById(prop_('ANSWER_FOLDER_ID'));
  const it = answerRoot.getFoldersByName(workbook);
  if (!it.hasNext()) throw new Error(`解答フォルダ「${workbook}」が見つかりません`);
  const folder = it.next();

  const files = [];
  collectFiles_(folder, files);

  const wanted = parsePages_(pages);
  let selected = files;
  if (wanted.length) {
    const matched = files.filter((f) => {
      const nums = parsePages_(f.getName().replace(/\.[^.]+$/, ''));
      return nums.some((n) => wanted.indexOf(n) >= 0);
    });
    if (matched.length) selected = matched;
  }

  const blobs = [];
  let total = 0;
  selected.forEach((f) => {
    const blob = toAnswerBlob_(f);
    if (!blob) return;
    total += blob.getBytes().length;
    blobs.push(blob);
  });
  if (total > 15 * 1024 * 1024) {
    throw new Error('解答ファイルが大きすぎます（合計15MBまで）。ページごとにファイルを分け、ファイル名にページ番号を入れてください');
  }
  return blobs;
}

function collectFiles_(folder, out) {
  const fit = folder.getFiles();
  while (fit.hasNext()) {
    const f = fit.next();
    if (f.getName().indexOf('ここに解答を入れて') !== 0) out.push(f); // 説明ファイルは除外
  }
  const dit = folder.getFolders();
  while (dit.hasNext()) collectFiles_(dit.next(), out);
}

function toAnswerBlob_(file) {
  const mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_DOCS || mime === MimeType.GOOGLE_SHEETS || mime === MimeType.GOOGLE_SLIDES) {
    return file.getAs(MimeType.PDF);
  }
  if (mime === MimeType.PDF || mime.indexOf('image/') === 0 || mime === MimeType.PLAIN_TEXT) {
    return file.getBlob();
  }
  return null; // 対応していない形式は無視
}

/** "12-14, 16" → [12,13,14,16] */
function parsePages_(text) {
  const out = [];
  String(text || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[〜～ー−]/g, '-')
    .split(/[^0-9-]+/)
    .forEach((tok) => {
      const m = tok.match(/^(\d+)-(\d+)$/);
      if (m) {
        const a = +m[1], b = +m[2];
        if (b >= a && b - a < 100) for (let i = a; i <= b; i++) out.push(i);
      } else {
        const n = tok.match(/\d+/);
        if (n) out.push(+n[0]);
      }
    });
  return out;
}

// ============================================================
// 一覧・更新・返却
// ============================================================
function listMine_(studentId) {
  if (!studentId) throw new Error('生徒IDがありません');
  return allRows_()
    .filter((v) => String(v[COL['生徒ID']]) === String(studentId))
    .map(toStudentView_)
    .reverse();
}

function listAll_() {
  return allRows_().map(toAdminView_).reverse();
}

function update_(req, doReturn) {
  const found = findRow_(req.id);
  if (!found) throw new Error('提出が見つかりません');
  const changes = {};
  if (req.items) {
    changes['採点結果JSON'] = JSON.stringify(req.items);
    changes['点数'] = req.items.filter((it) => it.correct).length;
    changes['満点'] = req.items.length;
  }
  if (req.teacherComment !== undefined) changes['先生コメント'] = req.teacherComment;
  if (doReturn) {
    changes['状態'] = STATUS.RETURNED;
    changes['返却日時'] = new Date();
  }
  writeCells_(found.rowIndex, changes);
  return toAdminView_(findRow_(req.id).values);
}

function deleteSubmission_(id) {
  const found = findRow_(id);
  if (!found) return;
  String(found.values[COL['写真ファイルID']]).split(',').filter(String).forEach((fid) => {
    try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {}
  });
  sheet_().deleteRow(found.rowIndex);
}

function getImages_(id, studentIdOrNull) {
  const found = findRow_(id);
  if (!found) throw new Error('提出が見つかりません');
  if (studentIdOrNull && String(found.values[COL['生徒ID']]) !== String(studentIdOrNull)) {
    throw new Error('この提出は見られません');
  }
  return String(found.values[COL['写真ファイルID']]).split(',').filter(String).map((fid) => {
    const blob = DriveApp.getFileById(fid).getBlob();
    return { mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
  });
}

function baseView_(v) {
  return {
    id: String(v[COL['id']]),
    submittedAt: toIso_(v[COL['提出日時']]),
    studentId: String(v[COL['生徒ID']]),
    studentName: String(v[COL['生徒名']]),
    workbook: String(v[COL['問題集']]),
    pages: String(v[COL['ページ']]),
    photoCount: String(v[COL['写真ファイルID']]).split(',').filter(String).length,
    status: String(v[COL['状態']]),
    returnedAt: toIso_(v[COL['返却日時']]),
  };
}

function resultFields_(v) {
  let items = [];
  try { items = JSON.parse(v[COL['採点結果JSON']] || '[]'); } catch (e) {}
  return {
    score: v[COL['点数']] === '' ? null : Number(v[COL['点数']]),
    total: v[COL['満点']] === '' ? null : Number(v[COL['満点']]),
    items: items,
    overallComment: String(v[COL['全体コメント']]),
    teacherComment: String(v[COL['先生コメント']]),
  };
}

/** 生徒には返却済みのものだけ採点結果を見せる */
function toStudentView_(v) {
  const base = baseView_(v);
  if (base.status === STATUS.RETURNED) return Object.assign(base, resultFields_(v));
  // 採点エラーも生徒には「先生が確認中」と見せる
  if (base.status === STATUS.ERROR || base.status === STATUS.GRADED) base.status = '先生が確認中';
  return base;
}

function toAdminView_(v) {
  return Object.assign(baseView_(v), resultFields_(v), { error: String(v[COL['エラー']]) });
}

// ============================================================
// スプレッドシート操作
// ============================================================
function sheet_() {
  return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(SHEET_NAME);
}

function allRows_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
}

function findRow_(id) {
  const rows = allRows_();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][COL['id']]) === String(id)) return { rowIndex: i + 2, values: rows[i] };
  }
  return null;
}

function setCell_(rowIndex, colName, value) {
  sheet_().getRange(rowIndex, COL[colName] + 1).setValue(value);
}

function writeCells_(rowIndex, changes) {
  Object.keys(changes).forEach((k) => setCell_(rowIndex, k, changes[k]));
}

// ============================================================
// ユーティリティ
// ============================================================
function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('初期設定がまだです。Apps Script で setup を実行してください');
  return v;
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function toIso_(d) {
  return d instanceof Date ? d.toISOString() : (d ? String(d) : '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
