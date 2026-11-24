// 権限の定義と判定。画面の表示だけでなく、API でも必ずここを通して判定する。
const PERMISSIONS = [
  { key: 'enter_classroom', column: 'can_enter_classroom', label: '教室への入室' },
  { key: 'start_class_call', column: 'can_start_class_call', label: '全体通話の開始' },
  { key: 'start_private_call', column: 'can_start_private_call', label: '個別通話の開始' },
  { key: 'share_screen', column: 'can_share_screen', label: '画面共有の開始' },
  { key: 'handle_students', column: 'can_handle_students', label: '生徒への個別対応' },
  { key: 'manage_classroom', column: 'can_manage_classroom', label: '教室管理' },
];
const KEYS = PERMISSIONS.map(p => p.key);

// 役割ごとの初期値
function defaultPermissions(role) {
  const all = Object.fromEntries(KEYS.map(k => [k, role === 'owner']));
  if (role === 'teacher') Object.assign(all, {
    enter_classroom: true, start_class_call: true, start_private_call: true,
    share_screen: true, handle_students: true, manage_classroom: false,
  });
  if (role === 'student') all.enter_classroom = true;
  return all;
}

// 生徒に付与できない権限（生徒どうしの個別通話などを防ぐ）
const STUDENT_FORBIDDEN = ['start_class_call', 'start_private_call', 'share_screen', 'handle_students', 'manage_classroom'];

function rowToPermissions(row, role) {
  if (role === 'owner') return Object.fromEntries(KEYS.map(k => [k, true])); // オーナーは常に全権限
  const p = {};
  for (const def of PERMISSIONS) p[def.key] = !!(row && row[def.column]);
  if (role === 'student') for (const k of STUDENT_FORBIDDEN) p[k] = false;
  return p;
}

function can(user, key) {
  if (!user || !user.is_active) return false;
  if (user.role === 'owner') return true;
  return !!(user.permissions && user.permissions[key]);
}

// その部屋に入れるか（第2段階のリアルタイム入室でもこの関数で判定する）
function canEnterRoom(user, room) {
  if (!user || !room) return false;
  // 面談ブース：オーナーと担当の先生、オーナーがその日に許可した保護者・生徒だけ
  if (room.id === 'mendan') {
    if (user.role === 'owner') return true;
    if (user.role === 'teacher') return can(user, 'enter_classroom') && user.rooms.includes(room.id);
    return require('./parents').mendanAllowed(user.id);
  }
  if (user.role === 'parent') {
    // ふだんはロビーだけ。保護者会の時間は、中学生と同じルールで教室・自習室・テストの教室に入れる
    if (!require('./parents').meetingOn()) return false;
    return room.type === 'study' ? room.id !== 'class3' : true;
  }
  if (room.type === 'study') {
    // 生徒：高校生は高校生自習室（class3）、それ以外の生徒は自習室（study）。先生・オーナーはどちらにも入れる
    if (user.role !== 'student') return true;
    // 大人（大人英会話）は、スピーキング・ライティング教室（class1）だけ
    if (user.grade === '大人') return room.id === 'class1';
    // 小学生は小学生自習室（class2）だけ。小学生自習室は小学生だけ
    if (/^小[1-6]$/.test(user.grade || '')) return room.id === 'class2';
    if (room.id === 'class2') return false;
    if (room.id === 'class1') return true; // スピーキング・ライティング教室は中学生・高校生
    const hs = /^高[123]$/.test(user.grade || '');
    return room.id === 'class3' ? hs : !hs;
  }
  if (user.role === 'owner') return true;
  if (!can(user, 'enter_classroom')) return false;
  if (user.role === 'teacher') return user.rooms.includes(room.id);
  return true; // 生徒は空席のある教室を自由に選べる（定員チェックは第2段階で入室時に実施）
}

module.exports = { PERMISSIONS, KEYS, STUDENT_FORBIDDEN, defaultPermissions, rowToPermissions, can, canEnterRoom };
