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
 * 採点ルール（三浦塾 共通ルール）:
 *   ○・×・保留 の3段階。確信が持てない問題は必ず保留にし、最終判断は講師が行う。
 *   模範解答を確認できない問題・判読できない答案は、AIの判定に関係なく保留にする（サーバー側で強制）。
 *   1回目の採点のあと、全小問を再照合する「最終チェック」をもう一度AIに行わせる。
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

  // 採点後に、全小問をもう一度照合する「最終チェック」を行う（正確性優先。AIの利用回数は2倍）
  VERIFY_PASS: true,

  // 1回に提出できる写真（ページ）数。ルール「4ページずつ採点」に合わせて4
  MAX_PHOTOS: 4,
};

const JUDGE = { OK: '○', NG: '×', HOLD: '保留' };
const CAUSES = ['計算ミス', '符号ミス', '立式ミス', '理解不足', '読み間違い・写し間違い', '未解答', 'その他'];

const LINE_HEADER = '新ワーク採点完了しました！\n採点していて思ったことをまとめましたので共有します。😊';

const ROOT_FOLDER_NAME = '三浦塾_採点';
const ANSWER_FOLDER_NAME = '解答';
const PHOTO_FOLDER_NAME = '提出写真';
const SHEET_FILE_NAME = '提出一覧';
const SHEET_NAME = '提出';

const COLUMNS = [
  'id', '提出日時', '生徒ID', '生徒名', '問題集', 'ページ', '写真ファイルID',
  '状態', '点数', '満点', '採点結果JSON', '全体コメント', '先生コメント', '返却日時', 'エラー',
  '学年', '教科', '保留数', 'LINE報告',
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
    const needAdmin = ['listAll', 'update', 'return', 'regrade', 'delete', 'checkAdmin',
      'lineReport', 'analyzeStudent'];
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
      case 'lineReport': return json_({ ok: true, text: lineReport_(req.id) });
      case 'analyzeStudent': return json_({ ok: true, text: analyzeStudent_(req.studentId) });
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
  if (req.images.length > CONFIG.MAX_PHOTOS) {
    throw new Error(`写真は${CONFIG.MAX_PHOTOS}枚（${CONFIG.MAX_PHOTOS}ページ）までです。分けて提出してください`);
  }

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
  row[COL['学年']] = req.grade || '';
  row[COL['教科']] = req.subject || '';
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
    const result = gradeWithGemini_({
      workbook: String(v[COL['問題集']]),
      pages: String(v[COL['ページ']]),
      subject: String(v[COL['教科']]),
    }, photos);
    const items = sortItems_(result.items.map((it) => applyGuards_(cleanItem_(it))));
    const c = countItems_(items);
    writeCells_(found.rowIndex, {
      '状態': STATUS.GRADED,
      '点数': c.ok,
      '満点': c.ok + c.ng,
      '保留数': c.hold,
      '採点結果JSON': JSON.stringify(items),
      '全体コメント': result.overallComment || '',
      // 状態が「採点済み」のときは、講師向けのメモ（模範解答の確認状況など）として使う
      'エラー': [result.answerKeyStatus ? '模範解答の確認状況: ' + result.answerKeyStatus : '', result.note]
        .filter(String).join('\n'),
    });
  } catch (err) {
    writeCells_(found.rowIndex, {
      '状態': STATUS.ERROR,
      'エラー': String(err && err.message ? err.message : err),
    });
  }
}

// ============================================================
// Gemini で採点（三浦塾 採点ルール）
// ============================================================
const GRADING_RULES = [
  'あなたは三浦塾の採点補助AIです。採点の速度よりも正確性を最優先します。最終判断は三浦塾の講師が行います。',
  '',
  '【判定】正解は「○」、不正解は「×」。AIが確信を持って判断できない場合は必ず「保留」。推測による採点は禁止。',
  '',
  '【必須の採点手順】すべての問題・小問について、必ず次の順番で確認する。',
  '1. 問題番号・小問番号を確認する。チャレンジ・プラスαなどの小問も省略しない。',
  '2. 生徒答案の該当箇所を拡大して読み取る。手書き文字を推測で読まない。',
  '3. 【模範解答】の中から、同じページ・同じ問題番号を探す。問題番号を取り違えない。',
  '4. 生徒答案と模範解答を、数字・符号・単位・記号まで照合する。x・yなど複数の解答欄は、それぞれ別の項目として個別に照合する。',
  '5. 数学は答えだけでなく途中式も確認する。途中式が必要な問題では解き方も評価する。',
  '6. 模範解答と異なる場合でも、正しい別解かどうかを確認する。正しい別解は○。',
  '7. すべて確認できた場合のみ ○・× を確定する。',
  '',
  '【模範解答の扱い】',
  '- 判定の根拠は、渡された【模範解答】だけにする。AIが自力で解いた答えを、確認済みの模範解答として扱ってはならない。',
  '- 該当する模範解答を確認できなかった問題は、modelAnswerFound=false、modelAnswer は空にし、判定は「保留」。',
  '- modelAnswer には、模範解答に書かれている内容をそのまま書き写す。',
  '',
  '【必ず保留にする場合】',
  '- 生徒の文字・数字が読み取れない',
  '- 模範解答の該当箇所が不明瞭',
  '- 問題と解答の対応が確認できない',
  '- 正しい別解かどうか判断できない',
  '- 途中式の正誤が不明',
  '- 部分点の採点基準が不明',
  '- 図やグラフが正確に読み取れない',
  '保留の場合は teacherCheck に「保留の理由」と「講師が確認する箇所」を必ず書く。',
  '',
  '【未解答と判読困難は区別する】',
  '- 何も書かれていない → studentAnswer="（未解答）"、判定「×」、cause="未解答"',
  '- 書いてあるが読めない → studentAnswer="（判読困難）"、判定「保留」',
  '',
  '【記録する内容】',
  '- page: ページ番号（数字のみ。答案や模範解答から読み取る）',
  '- number: 問題番号・小問番号（問題集の表記どおり。例 "1(2)", "チャレンジ(1)"、複数の解答欄は "3(1) x" のように区別）',
  '- studentAnswer: 生徒の解答（読み取ったとおり）',
  '- judgment: "○" / "×" / "保留"',
  '- mistake: ×のとき、間違えた内容を具体的に',
  '- cause: ×のとき、間違いの原因を次から1つ → ' + CAUSES.join(' / ') + '（○と保留は空）',
  '- review: ×のとき、必要な復習',
  '- teacherCheck: 保留の理由と講師が確認する箇所。×でも講師に伝えたいことがあれば書く',
  '- unit: 単元名（例: 一次方程式、比例、現在完了）',
  '- photo: その問題の答えが写っている答案写真の番号（1から数える）',
  '- box: その写真の中で生徒の答えが書かれている範囲 [ymin, xmin, ymax, xmax]。写真の左上0・右下1000の整数（○×を書き込む位置になる）',
  '',
  '【並び順】問題集の掲載順（ページ順・問題番号順）。',
  '',
  '【最終チェック】結果を出す前に次を確認する。',
  '- 生徒答案の数字を正しく読み取ったか / 模範解答の数字を正しく読み取ったか / 問題番号が一致しているか',
  '- 正しい答案を誤って×にしていないか / 間違った答案を○にしていないか / 小問の見落としがないか',
  '- 不確かな問題を保留にしているか',
  '確認できていない問題を、確認できたものとして報告してはならない。',
].join('\n');

const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    page: { type: 'STRING' },
    number: { type: 'STRING' },
    studentAnswer: { type: 'STRING' },
    modelAnswerFound: { type: 'BOOLEAN' },
    modelAnswer: { type: 'STRING' },
    judgment: { type: 'STRING', enum: [JUDGE.OK, JUDGE.NG, JUDGE.HOLD] },
    mistake: { type: 'STRING' },
    cause: { type: 'STRING' },
    review: { type: 'STRING' },
    teacherCheck: { type: 'STRING' },
    unit: { type: 'STRING' },
    photo: { type: 'INTEGER' },
    box: { type: 'ARRAY', items: { type: 'INTEGER' } },
  },
  required: ['page', 'number', 'studentAnswer', 'modelAnswerFound', 'modelAnswer', 'judgment',
    'mistake', 'cause', 'review', 'teacherCheck', 'unit', 'photo', 'box'],
};

const RESULT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answerKeyStatus: { type: 'STRING' }, // どのページの模範解答を確認できたか／できなかったか
    items: { type: 'ARRAY', items: ITEM_SCHEMA },
    overallComment: { type: 'STRING' },
  },
  required: ['answerKeyStatus', 'items', 'overallComment'],
};

function gradeWithGemini_(info, photoBlobs) {
  const answerBlobs = findAnswerBlobs_(info.workbook, info.pages);
  if (!answerBlobs.length) {
    throw new Error(`「${info.workbook}」フォルダに模範解答のファイルがありません`);
  }

  const header =
    `問題集: ${info.workbook}\n教科: ${info.subject || '（未指定）'}\n` +
    `生徒が入力したページ: ${info.pages || '（未入力。写真から判断）'}\n` +
    `答案写真: ${photoBlobs.length}枚（1枚＝1ページ）\n`;

  const media = [{ text: '【模範解答】（Googleドライブの解答ファイル）' }];
  answerBlobs.forEach((b) => media.push({ text: `模範解答ファイル: ${b.getName()}` }, inline_(b)));
  media.push({ text: '【生徒の答案】' });
  photoBlobs.forEach((b, i) => media.push({ text: `答案写真 ${i + 1}枚目` }, inline_(b)));

  // 1回目：採点
  const first = parseResult_(callGemini_(
    [{ text: header + '\n答案写真に写っているすべての問題・小問を、採点ルールの手順どおりに採点してください。' }]
      .concat(media),
    RESULT_SCHEMA, { system: GRADING_RULES }));

  if (!CONFIG.VERIFY_PASS) return Object.assign(first, { note: '' });

  // 2回目：最終チェック（1回目の結果を無条件に引き継がない）
  try {
    const second = parseResult_(callGemini_(
      [{ text: header +
        '\n以下は1回目の採点結果です。これを無条件に信用せず、最終チェックとして、' +
        'すべての小問について答案写真と模範解答を拡大して一問ずつ再照合してください。' +
        '読み取りの誤り・問題番号の取り違え・小問の見落とし・正しい答案の×・誤答の○があれば修正し、' +
        '確信が持てないものは保留にして、修正後の完全なリストを同じ形式で返してください。\n\n' +
        '【1回目の採点結果】\n' + JSON.stringify(first) }].concat(media),
      RESULT_SCHEMA, { system: GRADING_RULES }));
    return Object.assign(second, { note: '' });
  } catch (err) {
    return Object.assign(first, {
      note: '最終チェック（2回目の照合）に失敗したため、1回目の結果です: ' + String(err.message || err).slice(0, 200),
    });
  }
}

function parseResult_(text) {
  const r = JSON.parse(text);
  if (!r || !Array.isArray(r.items)) throw new Error('採点結果の形式が正しくありません');
  return r;
}

function cleanItem_(it) {
  return {
    page: String(it.page || '').replace(/[^0-9０-９\-]/g, ''),
    number: String(it.number || ''),
    studentAnswer: String(it.studentAnswer || ''),
    modelAnswerFound: it.modelAnswerFound === true,
    modelAnswer: String(it.modelAnswer || ''),
    judgment: [JUDGE.OK, JUDGE.NG, JUDGE.HOLD].indexOf(it.judgment) >= 0 ? it.judgment : JUDGE.HOLD,
    aiJudgment: String(it.judgment || ''),
    mistake: String(it.mistake || ''),
    cause: CAUSES.indexOf(it.cause) >= 0 ? it.cause : (it.cause ? 'その他' : ''),
    review: String(it.review || ''),
    teacherCheck: String(it.teacherCheck || ''),
    unit: String(it.unit || ''),
    photo: Number(it.photo) || 1,
    box: normalizeBox_(it.box),
  };
}

/**
 * ルールをサーバー側でも強制する（AIの判定を鵜呑みにしない）
 */
function applyGuards_(it) {
  const hold = (reason) => {
    if (it.judgment !== JUDGE.HOLD) {
      it.teacherCheck = `${reason}（AIの判定: ${it.judgment}）` + (it.teacherCheck ? ' / ' + it.teacherCheck : '');
    } else if (!it.teacherCheck) {
      it.teacherCheck = reason;
    }
    it.judgment = JUDGE.HOLD;
    it.cause = '';
  };
  const blank = /^[（(]?\s*(未解答|無回答|空欄)\s*[）)]?$/.test(it.studentAnswer.trim()) || !it.studentAnswer.trim();

  if (blank) {
    // 未解答は×（判読困難とは区別）
    it.studentAnswer = '（未解答）';
    it.judgment = JUDGE.NG;
    it.cause = '未解答';
    if (!it.mistake) it.mistake = '解答が書かれていません';
    return it;
  }
  if (/判読|読み取れ|不明瞭/.test(it.studentAnswer)) {
    it.studentAnswer = '（判読困難）';
    hold('生徒の文字・数字が読み取れません。答案写真の該当箇所を確認してください');
    return it;
  }
  if (!it.modelAnswerFound || !it.modelAnswer.trim()) {
    hold('模範解答の該当箇所を確認できませんでした。模範解答と照合してください');
    return it;
  }
  if (it.judgment === JUDGE.NG && normalizeAnswer_(it.studentAnswer) === normalizeAnswer_(it.modelAnswer)) {
    hold('生徒の解答が模範解答と一致しているのに×と判定されました。確認してください');
    return it;
  }
  if (it.judgment === JUDGE.HOLD && !it.teacherCheck) {
    it.teacherCheck = 'AIが判断に迷った問題です。答案と模範解答を確認してください';
  }
  if (it.judgment !== JUDGE.NG) it.cause = '';
  return it;
}

/** 表記揺れ（空白・全角半角・記号）を除いて比較用にする */
function normalizeAnswer_(s) {
  return String(s || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[−ー―‐]/g, '-')
    .replace(/[\s　、。,.]/g, '')
    .toLowerCase();
}

function sortItems_(items) {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (parseInt(a.it.page, 10) || 0) - (parseInt(b.it.page, 10) || 0) || a.i - b.i)
    .map((x) => x.it);
}

function countItems_(items) {
  const c = { ok: 0, ng: 0, hold: 0 };
  items.forEach((it) => {
    if (it.judgment === JUDGE.OK) c.ok++;
    else if (it.judgment === JUDGE.NG) c.ng++;
    else c.hold++;
  });
  return c;
}

function callGemini_(parts, schema, opts) {
  opts = opts || {};
  if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY.indexOf('ここに') === 0) {
    throw new Error('GeminiのAPIキーが設定されていません（Code.gs の CONFIG）');
  }
  const body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { temperature: opts.temperature === undefined ? 0 : opts.temperature },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
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

/** [ymin, xmin, ymax, xmax]（0〜1000）に整える。おかしな値なら null */
function normalizeBox_(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const b = box.map((v) => Math.max(0, Math.min(1000, Math.round(Number(v)))));
  if (b.some(isNaN) || b[2] <= b[0] || b[3] <= b[1]) return null;
  return b;
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
// 保護者向け LINE 学習報告（三浦塾 LINE報告ルール）
// ============================================================
const LINE_RULES = [
  'あなたは三浦塾の先生です。生徒の答案を実際に採点した先生として、保護者向けのLINE学習報告を書きます。',
  '',
  '【文章の雰囲気】',
  '- 塾の先生が実際に答案を見て保護者に伝えているような、親しみやすく丁寧な文章。AIが書いたような機械的・形式的な文章は避ける。',
  '- 親しみやすさを残しながら、指導者としての専門性と信頼感が伝わるように。',
  '- 堅苦しすぎず、くだけすぎない。保護者が理解しやすい言葉を選び、難しい専門用語はできるだけ使わない。',
  '- 絵文字は適度に。できたことは具体的に褒める。苦手なことは曖昧にせず、わかりやすく伝える。',
  '- 必要以上に厳しい表現や大げさな褒め言葉は使わない。同じ内容を繰り返して長くしない。',
  '',
  '【構成】（この見出しをそのまま使う）',
  '🌸 できたこと',
  '  採点結果から、正しく理解できている内容を具体的に（どのような問題ができていたか）。',
  '📚 苦手なこと',
  '  間違いが多かった内容を2〜3項目に整理。各項目で「どのような問題で間違えたか」「何が理解できていないのか」「どのような練習が必要か」をわかりやすく。',
  '✏️ 今回の課題',
  '  次回までに取り組む内容を3〜4項目。各行の先頭に ✅ を付け、具体的な行動がわかるように。',
  '最後に、今回の答案から感じた学習上の課題と、三浦塾で今後どのように指導するかを簡潔に（見出しなしの短い段落）。',
  '',
  '【三浦塾の教育方針】内容に応じて自然に反映する（毎回すべて入れる必要はない）。',
  '- 「わかった」と「自分でできる」は違う。答えを見て理解するだけでなく、自分の力で解けるようにする。',
  '- 間違えた問題は繰り返し解き直す。',
  '- 英語は自分で正しい英文を書けることを重視する。',
  '- 数学は答えだけでなく、途中式や考え方も大切にする。',
  '',
  '【内容の正確性】必ず下の採点結果だけを根拠にする。',
  '- 採点していない問題の正誤を推測しない。できていない内容を「できている」と書かない。',
  '- 間違いが確認できない内容を苦手分野と決めつけない。過去の成績や成長は書かない（今回のデータにないため）。',
  '- 保留の問題は正答・誤答として扱わない。',
  '',
  '【禁止】AIらしい定型表現の多用 / 根拠のない褒め言葉 / 苦手な点を曖昧にすること / 専門用語の多用 / ',
  '必要以上に長い説明 / 採点結果にない内容の創作 / 「ご家庭へのお願い」という項目の追加。',
  '',
  '冒頭のあいさつ・生徒名・教科は、こちらで付けるので書かないでください。「🌸 できたこと」から書き始めてください。',
].join('\n');

function lineReport_(id) {
  const found = findRow_(id);
  if (!found) throw new Error('提出が見つかりません');
  const v = found.values;
  const items = parseItems_(v);
  if (!items.length) throw new Error('採点結果がないため、報告を作成できません');

  const ok = items.filter((it) => it.judgment === JUDGE.OK);
  const ng = items.filter((it) => it.judgment === JUDGE.NG);
  const hold = items.filter((it) => it.judgment === JUDGE.HOLD);
  const fmt = (it) => `p.${it.page} ${it.number}（${it.unit || '単元不明'}）`;

  const data = [
    `問題集: ${v[COL['問題集']]}　ページ: ${v[COL['ページ']]}`,
    `正答: ${ok.length}問 / 誤答: ${ng.length}問 / 保留（未確定のため報告に含めない）: ${hold.length}問`,
    '',
    '■ 正解した問題',
    ok.map(fmt).join('\n') || '（なし）',
    '',
    '■ 間違えた問題',
    ng.map((it) => `${fmt(it)}\n  生徒の解答: ${it.studentAnswer} / 模範解答: ${it.modelAnswer}` +
      `\n  間違えた内容: ${it.mistake} / 原因: ${it.cause} / 必要な復習: ${it.review}`).join('\n') || '（なし）',
    '',
    v[COL['先生コメント']] ? '■ 講師のメモ\n' + v[COL['先生コメント']] : '',
  ].join('\n');

  const body = callGemini_([{ text: '【今回の採点結果】\n' + data }], null,
    { system: LINE_RULES, temperature: 0.6 }).trim();

  const grade = String(v[COL['学年']] || '');
  const name = String(v[COL['生徒名']] || '');
  const subject = String(v[COL['教科']] || '');
  const text = `${LINE_HEADER}\n\n【${[grade, name].filter(String).join('・')}】\n📘 ${subject || '（教科）'}\n\n${body}`;
  setCell_(found.rowIndex, 'LINE報告', text);
  return text;
}

// ============================================================
// 生徒別の苦手分析（その生徒の記録だけを使う）
// ============================================================
function analyzeStudent_(studentId) {
  if (!studentId) throw new Error('生徒IDがありません');
  const rows = allRows_().filter((v) => String(v[COL['生徒ID']]) === String(studentId) &&
    (v[COL['状態']] === STATUS.GRADED || v[COL['状態']] === STATUS.RETURNED));
  if (!rows.length) return '過去の採点データが確認できないため、苦手分析はまだできません。';

  const lines = [];
  let okCount = 0, ngCount = 0;
  rows.forEach((v) => {
    const date = v[COL['提出日時']] instanceof Date
      ? Utilities.formatDate(v[COL['提出日時']], 'Asia/Tokyo', 'M/d') : '';
    parseItems_(v).forEach((it) => {
      if (it.judgment === JUDGE.OK) okCount++;
      if (it.judgment !== JUDGE.NG) return;
      ngCount++;
      lines.push(`${date} ${v[COL['教科']] || ''} ${v[COL['問題集']]} p.${it.page} ${it.number}` +
        ` 単元:${it.unit || '不明'} 原因:${it.cause || '不明'} 内容:${it.mistake}`);
    });
  });
  const name = rows[0][COL['生徒名']];
  const grade = rows[0][COL['学年']];
  if (!ngCount) return `${grade}・${name}さん：記録されている${rows.length}回の採点で、×の問題はありません（○${okCount}問）。`;

  const prompt = [
    `生徒: ${grade}・${name}（提出${rows.length}回、○${okCount}問、×${ngCount}問。保留は含まない）`,
    '',
    '■ この生徒の×の記録（この生徒のものだけ）',
    lines.join('\n'),
  ].join('\n');

  const rules = [
    'あなたは三浦塾の講師の補助です。1人の生徒の採点記録から、講師向けの苦手分析を作ります。',
    '- 必ず渡された記録だけを根拠にする。記録にないことは推測で補わない。',
    '- 次の3つの見出しで、簡潔に書く。',
    '【繰り返し間違えている単元・問題】単元ごとに回数と、どのような間違い方か',
    '【間違いの原因の傾向】計算ミス・符号ミス・立式ミス・理解不足などの内訳と特徴',
    '【次回の演習の提案】苦手克服のために次に解くべき内容を3〜5項目、具体的に',
    '- 記録が少なく傾向が判断できない場合は、そのように書く。',
  ].join('\n');
  return callGemini_([{ text: prompt }], null, { system: rules, temperature: 0.3 }).trim();
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
  let items = null;
  if (req.items) {
    items = req.items.map((it) => Object.assign(cleanItem_(it), {
      aiJudgment: String(it.aiJudgment || ''),
      teacherEdited: it.teacherEdited === true,
    }));
    const c = countItems_(items);
    changes['採点結果JSON'] = JSON.stringify(items);
    changes['点数'] = c.ok;
    changes['満点'] = c.ok + c.ng;
    changes['保留数'] = c.hold;
  } else {
    items = parseItems_(found.values);
  }
  if (req.teacherComment !== undefined) changes['先生コメント'] = req.teacherComment;
  if (doReturn) {
    const holds = countItems_(items).hold;
    if (holds > 0) throw new Error(`保留が${holds}件残っています。○か×を講師が判定してから返却してください`);
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
    grade: String(v[COL['学年']] || ''),
    subject: String(v[COL['教科']] || ''),
  };
}

function parseItems_(v) {
  try { return JSON.parse(v[COL['採点結果JSON']] || '[]'); } catch (e) { return []; }
}

function resultFields_(v) {
  return {
    score: v[COL['点数']] === '' ? null : Number(v[COL['点数']]),
    total: v[COL['満点']] === '' ? null : Number(v[COL['満点']]),
    holdCount: Number(v[COL['保留数']]) || 0,
    items: parseItems_(v),
    overallComment: String(v[COL['全体コメント']]),
    teacherComment: String(v[COL['先生コメント']]),
  };
}

/** 生徒には返却済みのものだけ採点結果を見せる */
function toStudentView_(v) {
  const base = baseView_(v);
  if (base.status === STATUS.RETURNED) {
    const r = resultFields_(v);
    // 生徒には講師向けの確認事項・AIの元判定は見せない
    r.items = r.items.map((it) => Object.assign({}, it, { teacherCheck: '', aiJudgment: '' }));
    return Object.assign(base, r);
  }
  // 採点エラーも生徒には「先生が確認中」と見せる
  if (base.status === STATUS.ERROR || base.status === STATUS.GRADED) base.status = '先生が確認中';
  return base;
}

function toAdminView_(v) {
  return Object.assign(baseView_(v), resultFields_(v), {
    error: String(v[COL['エラー']]),
    lineReport: String(v[COL['LINE報告']] || ''),
  });
}

// ============================================================
// スプレッドシート操作
// ============================================================
let headerChecked_ = false;
function sheet_() {
  const sh = SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(SHEET_NAME);
  if (!headerChecked_) {
    // 列が増えたとき（アップデート時）に見出しを追加する
    const head = sh.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
    if (head.some((h, i) => h !== COLUMNS[i])) {
      sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    }
    headerChecked_ = true;
  }
  return sh;
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
