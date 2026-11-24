// 入室前の漢字テスト（漢検の読み・4択）
// - 生徒がオンライン教室に入るとき、学年に合った級から1問出す（小3：9〜8級、小4：8〜7級、小5・小6：6〜5級、中1：5〜4級、中2：4〜3級、中3：3〜準2級）
//   漢検の級と学年：9級＝小2の漢字、8級＝小3、7級＝小4、6級＝小5、5級＝小6
// - 正解でも不正解でも、正しい読みを見てから入室できる（すぐの入り直しでは出さない）
// - 問題は最初にサンプルを入れておき、先生が管理画面で追加・修正・削除できる
//   ※ サンプルの級の分け方は目安です。先生が確認してください
const crypto = require('crypto');
const { db, now, getSetting, setSetting, audit } = require('./db');

const LEVELS = ['9級', '8級', '7級', '6級', '5級', '4級', '3級', '準2級', '2級'];

db.exec(`
CREATE TABLE IF NOT EXISTS quiz_questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL,
  word       TEXT NOT NULL,
  answer     TEXT NOT NULL,
  wrong1     TEXT NOT NULL,
  wrong2     TEXT NOT NULL,
  wrong3     TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sample     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER,
  level       TEXT,
  correct     INTEGER NOT NULL,
  answered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_results_user ON quiz_results(user_id, answered_at);
`);

// ───────── サンプル問題（最初の1回だけ入れる） ─────────
const SAMPLE = {
  // 9級（小学2年生の漢字）
  '9級': [
    ['教室', 'きょうしつ', 'きょうじつ', 'こうしつ', 'きょしつ'], ['時間', 'じかん', 'じけん', 'ときかん', 'じがん'],
    ['毎朝', 'まいあさ', 'まいちょう', 'ごとあさ', 'まいあざ'], ['図工', 'ずこう', 'ずく', 'とこう', 'ずごう'],
    ['新聞', 'しんぶん', 'しんもん', 'しんぷん', 'あたらぶん'], ['公園', 'こうえん', 'こうえ', 'おおえん', 'こうおん'],
    ['交番', 'こうばん', 'こうはん', 'まじばん', 'こうぼん'], ['計算', 'けいさん', 'けいざん', 'けさん', 'はかさん'],
    ['地図', 'ちず', 'ちと', 'じず', 'ちずう'], ['汽車', 'きしゃ', 'きくるま', 'ぎしゃ', 'きじゃ'],
    ['夜空', 'よぞら', 'やくう', 'よるそら', 'よそら'], ['遠足', 'えんそく', 'とおあし', 'えんぞく', 'おんそく'],
    ['兄弟', 'きょうだい', 'けいてい', 'あにおとうと', 'きょうたい'], ['雪国', 'ゆきぐに', 'せっこく', 'ゆきこく', 'ゆきくに'],
    ['歌声', 'うたごえ', 'かせい', 'うたこえ', 'うたせい'], ['自分', 'じぶん', 'じふん', 'しぶん', 'じぷん'],
    ['帰る', 'かえる', 'きる', 'もどる', 'かいる'], ['楽しい', 'たのしい', 'らくしい', 'うれしい', 'がくしい'],
  ],
  // 8級（小学3年生の漢字）
  '8級': [
    ['練習', 'れんしゅう', 'れんしゅ', 'ねんしゅう', 'れんじゅう'], ['宿題', 'しゅくだい', 'しゅくたい', 'やどだい', 'しゅっだい'],
    ['漢字', 'かんじ', 'かんし', 'がんじ', 'かんじい'], ['発表', 'はっぴょう', 'はつひょう', 'はっぽう', 'はっぴょ'],
    ['世界', 'せかい', 'せいかい', 'よかい', 'せがい'], ['写真', 'しゃしん', 'しゃじん', 'うつしん', 'しゃっしん'],
    ['急行', 'きゅうこう', 'きゅうぎょう', 'いそこう', 'きゅこう'], ['研究', 'けんきゅう', 'けんく', 'けんじゅう', 'げんきゅう'],
    ['植物', 'しょくぶつ', 'しょくもつ', 'うえもの', 'しょくぶっ'], ['安心', 'あんしん', 'あんじん', 'やすしん', 'あんこころ'],
    ['旅行', 'りょこう', 'りょうこう', 'たびこう', 'りょぎょう'], ['開始', 'かいし', 'かいじ', 'ひらきし', 'かいはじ'],
    ['部屋', 'へや', 'ぶや', 'ぶおく', 'へおく'], ['返事', 'へんじ', 'へんごと', 'かえじ', 'はんじ'],
    ['重い', 'おもい', 'かるい', 'じゅうい', 'おもたい'], ['速い', 'はやい', 'そくい', 'おそい', 'すばやい'],
    ['美しい', 'うつくしい', 'びしい', 'うるわしい', 'みしい'], ['祭り', 'まつり', 'さいり', 'まいり', 'おまつり'],
  ],
  // 7級（小学4年生の漢字）
  '7級': [
    ['協力', 'きょうりょく', 'きょうりき', 'こうりょく', 'きょりょく'], ['季節', 'きせつ', 'きせち', 'きふし', 'ぎせつ'],
    ['給食', 'きゅうしょく', 'きゅうじき', 'きゅうしき', 'きゅしょく'], ['説明', 'せつめい', 'せつみょう', 'ぜつめい', 'せいめい'],
    ['必要', 'ひつよう', 'ひっよう', 'ひつい', 'ひつおう'], ['便利', 'べんり', 'びんり', 'べんき', 'へんり'],
    ['目標', 'もくひょう', 'めひょう', 'もくしょう', 'もくびょう'], ['野菜', 'やさい', 'のさい', 'やな', 'やざい'],
    ['卒業', 'そつぎょう', 'そつごう', 'しゅつぎょう', 'そつきょう'], ['健康', 'けんこう', 'けんごう', 'けんかん', 'げんこう'],
    ['欠席', 'けっせき', 'けつせき', 'かけせき', 'けっせい'], ['結果', 'けっか', 'けつか', 'けっが', 'むすか'],
    ['選手', 'せんしゅ', 'せんて', 'ぜんしゅ', 'えらしゅ'], ['変化', 'へんか', 'へんけ', 'かわか', 'へんが'],
    ['努力', 'どりょく', 'どりき', 'ぬりょく', 'どうりょく'], ['浅い', 'あさい', 'ふかい', 'せんい', 'あせい'],
    ['静か', 'しずか', 'せいか', 'じょうか', 'しずやか'], ['願い', 'ねがい', 'がんい', 'いのい', 'ねぎい'],
  ],
  // 6級（小学5年生の漢字）
  '6級': [
    ['往復', 'おうふく', 'おうぶく', 'じゅうふく', 'おうほく'], ['永久', 'えいきゅう', 'えいく', 'えいきょう', 'ながきゅう'],
    ['河川', 'かせん', 'かがわ', 'かわせん', 'がせん'], ['快適', 'かいてき', 'けいてき', 'かいせき', 'かいでき'],
    ['規則', 'きそく', 'きぞく', 'ぎそく', 'きそっく'], ['逆転', 'ぎゃくてん', 'ぎゃくでん', 'さかてん', 'ぎゃてん'],
    ['経験', 'けいけん', 'きょうけん', 'けいげん', 'けけん'], ['検査', 'けんさ', 'けんさい', 'けんしゃ', 'げんさ'],
    ['効果', 'こうか', 'こうが', 'こうかい', 'きくか'], ['財産', 'ざいさん', 'さいさん', 'ざいざん', 'たからさん'],
    ['賛成', 'さんせい', 'さんじょう', 'ざんせい', 'さんせ'], ['準備', 'じゅんび', 'じゅんぶ', 'しゅんび', 'じゅんぴ'],
    ['職員', 'しょくいん', 'しょくにん', 'しきいん', 'しょっいん'], ['政治', 'せいじ', 'せいち', 'しょうじ', 'まつりじ'],
    ['増加', 'ぞうか', 'ぞうが', 'そうか', 'ますか'], ['豊富', 'ほうふ', 'ほうとみ', 'ぼうふ', 'ゆたふ'],
    ['防災', 'ぼうさい', 'ぼうざい', 'ふせさい', 'ほうさい'], ['貿易', 'ぼうえき', 'ぼうい', 'ほうえき', 'ぼうやく'],
  ],
  '5級': [
    ['宇宙', 'うちゅう', 'うじゅう', 'うちゅ', 'ゆうちゅう'], ['誕生', 'たんじょう', 'たんせい', 'だんじょう', 'たんしょう'],
    ['縦断', 'じゅうだん', 'たてだん', 'しゅうだん', 'じゅうたん'], ['拡大', 'かくだい', 'こうだい', 'かくたい', 'ひろだい'],
    ['貴重', 'きちょう', 'きじゅう', 'きじょう', 'ぎちょう'], ['推測', 'すいそく', 'すいしょく', 'ついそく', 'すいそう'],
    ['宣言', 'せんげん', 'せんごん', 'ぜんげん', 'せんけん'], ['背景', 'はいけい', 'せけい', 'はいきょう', 'ばいけい'],
    ['頂上', 'ちょうじょう', 'ちょうしょう', 'いただきじょう', 'ちょじょう'], ['臨時', 'りんじ', 'りんとき', 'りじ', 'りんし'],
    ['憲法', 'けんぽう', 'けんほう', 'けんぼう', 'げんぽう'], ['穀物', 'こくもつ', 'こくぶつ', 'こくもの', 'ごくもつ'],
    ['秘密', 'ひみつ', 'ひめつ', 'ひいみつ', 'びみつ'], ['至急', 'しきゅう', 'しっきゅう', 'いたきゅう', 'じきゅう'],
    ['蒸気', 'じょうき', 'しょうき', 'むしき', 'じょうけ'], ['片道', 'かたみち', 'へんどう', 'かたどう', 'へんみち'],
  ],
  '4級': [
    ['握手', 'あくしゅ', 'あくて', 'おくしゅ', 'あしゅ'], ['驚異', 'きょうい', 'けいい', 'きょうがい', 'おどろきい'],
    ['恐怖', 'きょうふ', 'きょうほ', 'こうふ', 'きょふ'], ['繁盛', 'はんじょう', 'はんせい', 'ばんじょう', 'はんしょう'],
    ['微妙', 'びみょう', 'みみょう', 'びしょう', 'びみ'], ['濃厚', 'のうこう', 'じょうこう', 'のうごう', 'こいこう'],
    ['噴水', 'ふんすい', 'ほんすい', 'ぶんすい', 'ふきみず'], ['遅刻', 'ちこく', 'おそこく', 'じこく', 'ちごく'],
    ['盗難', 'とうなん', 'どうなん', 'とうかん', 'ぬすなん'], ['鮮明', 'せんめい', 'せんみょう', 'ぜんめい', 'さんめい'],
    ['普及', 'ふきゅう', 'ふっきゅう', 'ふぎゅう', 'ふおよ'], ['敏感', 'びんかん', 'みんかん', 'びんがん', 'ぴんかん'],
    ['避難', 'ひなん', 'さなん', 'びなん', 'ひかん'], ['舞台', 'ぶたい', 'まいだい', 'むたい', 'ぶだい'],
    ['腕前', 'うでまえ', 'わんまえ', 'うでぜん', 'てまえ'], ['輝く', 'かがやく', 'きらめく', 'かがく', 'ひかく'],
    ['狭い', 'せまい', 'ひろい', 'きょうい', 'せばい'],
  ],
  '3級': [
    ['悲哀', 'ひあい', 'ひかい', 'ひえ', 'かなあい'], ['穏やか', 'おだやか', 'なごやか', 'おんやか', 'ゆるやか'],
    ['緩和', 'かんわ', 'えんわ', 'かんな', 'ゆるわ'], ['犠牲', 'ぎせい', 'ぎしょう', 'きせい', 'ぎじょう'],
    ['寿命', 'じゅみょう', 'じゅめい', 'ことぶきいのち', 'しゅみょう'], ['締結', 'ていけつ', 'しけつ', 'てんけつ', 'ていげつ'],
    ['掲載', 'けいさい', 'かかさい', 'けいざい', 'けんさい'], ['慈悲', 'じひ', 'じび', 'しひ', 'いつくひ'],
    ['隆盛', 'りゅうせい', 'りゅうじょう', 'こうせい', 'りゅせい'], ['雇用', 'こよう', 'こよ', 'ようこ', 'こうよう'],
    ['鍛える', 'きたえる', 'かためる', 'たんえる', 'ねりえる'], ['漂う', 'ただよう', 'さまよう', 'うかがう', 'ひょうう'],
    ['欺く', 'あざむく', 'そむく', 'いつわく', 'あなどく'], ['抑制', 'よくせい', 'おくせい', 'よくさい', 'ぎょくせい'],
    ['湿度', 'しつど', 'しっど', 'じつど', 'しめど'], ['墜落', 'ついらく', 'すいらく', 'たいらく', 'ついらっく'],
    ['憩い', 'いこい', 'やすい', 'いとい', 'けいい'], ['誘惑', 'ゆうわく', 'ゆうこく', 'ようわく', 'さそわく'],
  ],
  '準2級': [
    ['謙虚', 'けんきょ', 'けんこ', 'れんきょ', 'けんぎょ'], ['洪水', 'こうずい', 'きょうすい', 'こうすい', 'ほうずい'],
    ['懸命', 'けんめい', 'けんみょう', 'かけめい', 'げんめい'], ['循環', 'じゅんかん', 'しゅんかん', 'じゅんげん', 'じゅかん'],
    ['繊維', 'せんい', 'せんゆい', 'けんい', 'せい'], ['漆黒', 'しっこく', 'うるしこく', 'しつこく', 'しっくろ'],
    ['唆す', 'そそのかす', 'うながす', 'さそのかす', 'そそぐす'], ['寛容', 'かんよう', 'けんよう', 'かんにょう', 'ひろよう'],
    ['奨励', 'しょうれい', 'そうれい', 'しょうらい', 'じょうれい'], ['拒否', 'きょひ', 'きょふ', 'こひ', 'きょび'],
    ['柔軟', 'じゅうなん', 'にゅうなん', 'じゅうない', 'じゅなん'], ['頑固', 'がんこ', 'がんご', 'かんこ', 'げんこ'],
    ['塾生', 'じゅくせい', 'じゅくしょう', 'しゅくせい', 'じゅせい'], ['慶事', 'けいじ', 'きょうじ', 'けいごと', 'けいし'],
    ['漠然', 'ばくぜん', 'まくぜん', 'ばくねん', 'ばくせん'], ['撤退', 'てったい', 'てつたい', 'ていたい', 'さったい'],
    ['詐欺', 'さぎ', 'さき', 'さくぎ', 'ざぎ'],
  ],
};
{
  const ins = db.prepare('INSERT INTO quiz_questions (level, word, answer, wrong1, wrong2, wrong3, sample, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  if (db.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get().n === 0) {
    for (const [level, list] of Object.entries(SAMPLE)) for (const q of list) ins.run(level, ...q, now());
    setSetting('kanken_sample_6', '1');
  } else if (getSetting('kanken_sample_6', '') !== '1') { // あとから追加した6級のサンプル（1回だけ）
    for (const q of SAMPLE['6級']) ins.run('6級', ...q, now());
    setSetting('kanken_sample_6', '1');
  }
  if (getSetting('kanken_sample_987', '') !== '1') { // あとから追加した9級・8級・7級のサンプル（1回だけ。最初の1回のときは上で入っている）
    const has = db.prepare("SELECT COUNT(*) AS n FROM quiz_questions WHERE level IN ('9級', '8級', '7級')").get().n;
    if (!has) for (const lv of ['9級', '8級', '7級']) for (const q of SAMPLE[lv]) ins.run(lv, ...q, now());
    setSetting('kanken_sample_987', '1');
  }
}

// ───────── 設定 ─────────
const ES_LEVELS = ['6級', '5級']; // 小5・小6は6級・5級
const LOW_LEVELS = { '小1': ['9級'], '小2': ['9級'], '小3': ['9級', '8級'], '小4': ['8級', '7級'] }; // 前の学年の復習＋今の学年（小1は9級だけ）
const DEFAULT_LEVELS = { ...LOW_LEVELS, '小5': ES_LEVELS, '小6': ES_LEVELS, '中1': ['5級', '4級'], '中2': ['4級', '3級'], '中3': ['3級', '準2級'], '大人': ['準2級', '2級'] };
function getConfig() {
  let saved = {};
  try { saved = JSON.parse(getSetting('kanken', '{}')); } catch (e) { saved = {}; }
  if (saved.gradeLevels && !saved.esV1) { // 小学生（6級・5級）を足す（1回だけ）
    for (const g of ['小1', '小2', '小3', '小4', '小5', '小6']) if (!saved.gradeLevels[g]) saved.gradeLevels[g] = [...ES_LEVELS];
    saved.esV1 = true; setSetting('kanken', JSON.stringify(saved));
  }
  if (saved.gradeLevels && !saved.esV2) { // 小1〜小4を学年に合った級（9〜7級）に変える（1回だけ）
    for (const [g, lv] of Object.entries(LOW_LEVELS)) saved.gradeLevels[g] = [...lv];
    saved.esV2 = true; setSetting('kanken', JSON.stringify(saved));
  }
  if (saved.gradeLevels && !saved.adultV1) { // 大人（大人英会話）を足す（1回だけ）
    if (!saved.gradeLevels['大人']) saved.gradeLevels['大人'] = [...DEFAULT_LEVELS['大人']];
    saved.adultV1 = true; setSetting('kanken', JSON.stringify(saved));
  }
  return { enabled: true, gradeLevels: DEFAULT_LEVELS, ...saved };
}
function setConfig(p, actorId) {
  const c = getConfig();
  if (p.enabled !== undefined) c.enabled = !!p.enabled;
  if (p.gradeLevels !== undefined) {
    const gl = {};
    for (const [g, lv] of Object.entries(p.gradeLevels || {})) {
      if (typeof g !== 'string' || g.length > 4) return '学年が正しくありません';
      const list = Array.isArray(lv) ? [...new Set(lv.filter(l => LEVELS.includes(l)))] : [];
      if (list.length) gl[g] = list;
    }
    c.gradeLevels = gl;
  }
  setSetting('kanken', JSON.stringify(c));
  audit(actorId, 'kanken.config', null, null);
  return null;
}
const levelsFor = (grade, c = getConfig()) => (grade && c.gradeLevels[grade]) || [];

// ───────── 出題と答え合わせ ─────────
const pending = new Map();  // userId -> { qid, choices, answer, level, word, at }
const passedAt = new Map(); // userId -> 答えた時刻（入室の許可）
const PASS_VALID_MS = 15 * 60_000;

function hasQuestions(levels) {
  if (!levels.length) return false;
  return db.prepare(`SELECT COUNT(*) AS n FROM quiz_questions WHERE active = 1 AND level IN (${levels.map(() => '?').join(',')})`).get(...levels).n > 0;
}
/** この生徒は、入室の前にテストが必要か */
function required(user, { quickRejoin = false } = {}) {
  if (!user || user.role !== 'student' || user.trial_until) return false; // 体験中の子はテストなし
  const c = getConfig();
  if (!c.enabled || quickRejoin) return false;
  if (!hasQuestions(levelsFor(user.grade, c))) return false; // 対象の学年でない・問題がない
  const t = passedAt.get(user.id);
  return !(t && Date.now() - t < PASS_VALID_MS);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 大人（大人英会話）：漢字のあとに英単語も1問（保護者の「今日の5問」の英単語の問題を使う）
const wordStep = new Map(); // userId -> true（漢字が終わって、次は英単語）
function wordQuestion(user) {
  const all = db.prepare("SELECT id, question, answer, wrong FROM parent_questions WHERE active = 1 AND subject = '英単語'").all();
  if (!all.length) return null;
  const recent = new Set(db.prepare("SELECT question_id FROM quiz_results WHERE user_id = ? AND level = '英単語' ORDER BY id DESC LIMIT 30").all(user.id).map(r => r.question_id));
  const fresh = all.filter(q => !recent.has(q.id));
  const pool = fresh.length ? fresh : all;
  const q = pool[crypto.randomInt(pool.length)];
  const wrong = JSON.parse(q.wrong).slice(0, 3);
  const choices = shuffle([q.answer, ...wrong]);
  const m = /「(.+?)」/.exec(q.question);
  const word = m ? m[1] : q.question;
  pending.set(user.id, { qid: q.id, choices, answer: q.answer, level: '英単語', word, at: Date.now() });
  return { level: '英単語', word, choices, kind: 'word', step: 2, total: 2 };
}
function newQuestion(user) {
  if (user.grade === '大人' && wordStep.get(user.id)) { const w = wordQuestion(user); if (w) return w; wordStep.delete(user.id); }
  const levels = levelsFor(user.grade);
  if (!levels.length) return null;
  // 最近答えた問題はなるべく出さない
  const recent = new Set(db.prepare('SELECT question_id FROM quiz_results WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(user.id).map(r => r.question_id));
  const all = db.prepare(`SELECT * FROM quiz_questions WHERE active = 1 AND level IN (${levels.map(() => '?').join(',')})`).all(...levels);
  if (!all.length) return null;
  const fresh = all.filter(q => !recent.has(q.id));
  const pool = fresh.length ? fresh : all;
  const q = pool[crypto.randomInt(pool.length)];
  const choices = shuffle([q.answer, q.wrong1, q.wrong2, q.wrong3]);
  pending.set(user.id, { qid: q.id, choices, answer: q.answer, level: q.level, word: q.word, at: Date.now() });
  return { level: q.level, word: q.word, choices, kind: 'kanji', ...(user.grade === '大人' ? { step: 1, total: 2 } : {}) };
}
function answer(user, choiceIndex) {
  const p = pending.get(user.id);
  if (!p) return { error: '問題がありません。もう一度ひらいてください' };
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) return { error: '答えを選んでください' };
  pending.delete(user.id);
  const correct = p.choices[choiceIndex] === p.answer;
  db.prepare('INSERT INTO quiz_results (user_id, question_id, level, correct, answered_at) VALUES (?, ?, ?, ?, ?)').run(user.id, p.qid, p.level, correct ? 1 : 0, now());
  // 大人：漢字のあとは英単語（英単語の問題がなければ、ここでおわり）
  let more = false;
  if (user.grade === '大人' && p.level !== '英単語' && db.prepare("SELECT 1 FROM parent_questions WHERE active = 1 AND subject = '英単語' LIMIT 1").get()) { wordStep.set(user.id, true); more = true; }
  else { wordStep.delete(user.id); passedAt.set(user.id, Date.now()); }
  return { more, correct, answer: p.answer, answerIndex: p.choices.indexOf(p.answer), word: p.word, level: p.level };
}

// ───────── 管理画面 ─────────
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
function validateQuestion(b) {
  const q = { level: b.level, word: clean(b.word, 12), answer: clean(b.answer, 20), wrong: (b.wrong || []).map(w => clean(w, 20)) };
  if (!LEVELS.includes(q.level)) return { error: '級を選んでください' };
  if (!q.word || !q.answer || q.wrong.length !== 3 || q.wrong.some(w => !w)) return { error: '漢字・正しい読み・まちがいの読み3つを入れてください' };
  if (new Set([q.answer, ...q.wrong]).size !== 4) return { error: '4つの選択肢は、すべてちがう読みにしてください' };
  return { q };
}
function listQuestions() {
  return db.prepare('SELECT id, level, word, answer, wrong1, wrong2, wrong3, active, sample FROM quiz_questions ORDER BY CASE level WHEN \'5級\' THEN 1 WHEN \'4級\' THEN 2 WHEN \'3級\' THEN 3 WHEN \'準2級\' THEN 4 ELSE 5 END, id').all()
    .map(r => ({ id: r.id, level: r.level, word: r.word, answer: r.answer, wrong: [r.wrong1, r.wrong2, r.wrong3], active: !!r.active, sample: !!r.sample }));
}
function addQuestion(b, actorId) {
  const v = validateQuestion(b); if (v.error) return v.error;
  db.prepare('INSERT INTO quiz_questions (level, word, answer, wrong1, wrong2, wrong3, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(v.q.level, v.q.word, v.q.answer, ...v.q.wrong, now());
  audit(actorId, 'kanken.question_added', v.q.word, null);
  return null;
}
// まとめて追加（表計算ソフトから貼り付け）。同じ級・同じ漢字の問題はとばす
function addBulk(rows, actorId) {
  if (!Array.isArray(rows) || !rows.length) return { error: '問題がありません' };
  if (rows.length > 1000) return { error: '一度に登録できるのは1000問までです' };
  const exists = db.prepare('SELECT 1 FROM quiz_questions WHERE level = ? AND word = ?');
  const ins = db.prepare('INSERT INTO quiz_questions (level, word, answer, wrong1, wrong2, wrong3, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let added = 0, skipped = 0;
  const errors = [];
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const v = validateQuestion(r || {});
      if (v.error) { errors.push({ line: (r && r.line) || i + 1, error: v.error }); return; }
      if (exists.get(v.q.level, v.q.word)) { skipped++; return; }
      ins.run(v.q.level, v.q.word, v.q.answer, ...v.q.wrong, now());
      added++;
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(actorId, 'kanken.bulk_added', String(added), { skipped, errors: errors.length });
  return { added, skipped, errors };
}

function updateQuestion(id, b, actorId) {
  const cur = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(id);
  if (!cur) return '問題が見つかりません';
  if (b.active !== undefined && Object.keys(b).length === 1) {
    db.prepare('UPDATE quiz_questions SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
    return null;
  }
  const v = validateQuestion(b); if (v.error) return v.error;
  db.prepare('UPDATE quiz_questions SET level = ?, word = ?, answer = ?, wrong1 = ?, wrong2 = ?, wrong3 = ?, sample = 0 WHERE id = ?').run(v.q.level, v.q.word, v.q.answer, ...v.q.wrong, id);
  audit(actorId, 'kanken.question_updated', v.q.word, null);
  return null;
}
function deleteQuestion(id, actorId) {
  const r = db.prepare('DELETE FROM quiz_questions WHERE id = ?').run(id);
  if (!r.changes) return '問題が見つかりません';
  audit(actorId, 'kanken.question_deleted', String(id), null);
  return null;
}
// 生徒ごとの成績（最近30日）
function stats() {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  return db.prepare(`SELECT u.id, u.display_name AS name, u.grade, COUNT(r.id) AS answered, COALESCE(SUM(r.correct), 0) AS correct
    FROM users u LEFT JOIN quiz_results r ON r.user_id = u.id AND r.answered_at >= ?
    WHERE u.role = 'student' AND u.is_active = 1 AND u.trial_until IS NULL GROUP BY u.id ORDER BY u.grade, u.display_name`).all(since);
}

module.exports = {
  LEVELS, getConfig, setConfig, levelsFor, required, newQuestion, answer, listQuestions, addQuestion, addBulk, updateQuestion, deleteQuestion, stats,
  _reset: () => { pending.clear(); passedAt.clear(); },
};
