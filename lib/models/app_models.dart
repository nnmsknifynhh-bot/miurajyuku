// ============================================================
// DATA MODELS for 三浦塾 学習管理システム
// ============================================================

enum UserRole { student, parent, admin, teacher }

class AppUser {
  final String id;
  final String name;
  final UserRole role;
  // 保護者の紐付け生徒IDリスト（複数の子に対応）
  // 旧: studentId (String?) → 新: studentIds (List<String>)
  final List<String> studentIds;
  // 保護者ログイン用パスワード（管理者が設定）
  final String? password;
  final int? grade;
  final String? className;   // 学校名
  final String? club;        // 部活
  final String? currentScore; // 現在の成績
  final String? targetSchool; // 志望校

  AppUser({
    required this.id,
    required this.name,
    required this.role,
    this.studentIds = const [],
    this.password,
    this.grade,
    this.className,
    this.club,
    this.currentScore,
    this.targetSchool,
  });

  /// 旧来の単一 studentId との互換ヘルパー
  String? get studentId => studentIds.isNotEmpty ? studentIds.first : null;

  /// コピーで studentIds を更新
  AppUser copyWith({
    String? id,
    String? name,
    UserRole? role,
    List<String>? studentIds,
    String? password,
    int? grade,
    String? className,
    String? club,
    String? currentScore,
    String? targetSchool,
  }) {
    return AppUser(
      id: id ?? this.id,
      name: name ?? this.name,
      role: role ?? this.role,
      studentIds: studentIds ?? this.studentIds,
      password: password ?? this.password,
      grade: grade ?? this.grade,
      className: className ?? this.className,
      club: club ?? this.club,
      currentScore: currentScore ?? this.currentScore,
      targetSchool: targetSchool ?? this.targetSchool,
    );
  }
}

// ---- Lesson / Calendar ----
class Lesson {
  final String id;
  final String studentId;
  final DateTime date;
  final String startTime;
  final String endTime;
  final String subject;
  final String? memo;
  bool isAbsent;
  String? absentReason;
  String? absentSender; // 'student' or 'parent'
  final String? teacherId;   // 担当講師ID
  final bool isWeekly;       // 毎週繰り返し

  Lesson({
    required this.id,
    required this.studentId,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.subject,
    this.memo,
    this.isAbsent = false,
    this.absentReason,
    this.absentSender,
    this.teacherId,
    this.isWeekly = false,
  });
}

// ---- Scores ----
const List<String> subjects5 = ['国語', '数学', '英語', '理科', '社会'];
const List<String> subjects9 = ['国語', '数学', '英語', '理科', '社会', '音楽', '美術', '保健体育', '技術家庭'];

// デフォルト科目（授業スケジュール用）
const List<String> defaultLessonSubjects = ['国語', '数学', '英語', '理科', '社会', '補習', 'テスト対策'];

const List<String> examTypes = [
  '1学期中間',
  '1学期期末',
  '2学期中間',
  '2学期期末',
  '学年末',
];

class ExamScore {
  final String id;
  final String studentId;
  final String examType;
  final int year;
  final Map<String, int?> scores;
  String? goodPoints;
  String? reflections;
  String? nextGoal;
  String? goalDeadline;
  String? goalDetail;

  ExamScore({
    required this.id,
    required this.studentId,
    required this.examType,
    required this.year,
    required this.scores,
    this.goodPoints,
    this.reflections,
    this.nextGoal,
    this.goalDeadline,
    this.goalDetail,
  });

  int get totalScore => scores.values.where((v) => v != null).fold(0, (a, b) => a + b!);
  int get subjectCount => scores.values.where((v) => v != null).length;
  double get average => subjectCount > 0 ? totalScore / subjectCount : 0;
}

// ---- Naishin (内申) ----
class Naishin {
  final String id;
  final String studentId;
  final String term;
  final int year;
  final Map<String, int?> grades;

  Naishin({
    required this.id,
    required this.studentId,
    required this.term,
    required this.year,
    required this.grades,
  });

  int get total => grades.values.where((v) => v != null).fold(0, (a, b) => a + b!);
}

// ---- Mock Test (模試) ----
class MockTest {
  final String id;
  final String studentId;
  final String testName;
  final DateTime date;
  final Map<String, int?> scores;
  final Map<String, double?> deviations;
  final String? targetSchool;

  MockTest({
    required this.id,
    required this.studentId,
    required this.testName,
    required this.date,
    required this.scores,
    required this.deviations,
    this.targetSchool,
  });

  int get totalScore => scores.values.where((v) => v != null).fold(0, (a, b) => a + b!);
  double get avgDeviation {
    final vals = deviations.values.where((v) => v != null).toList();
    if (vals.isEmpty) return 0;
    return vals.fold(0.0, (a, b) => a + b!) / vals.length;
  }
}

// ---- Progress ----
class ProgressCategory {
  final String id;
  final String subject;
  final List<ProgressItem> items;

  ProgressCategory({required this.id, required this.subject, required this.items});
}

class ProgressItem {
  final String id;
  final String categoryId;
  final String title;
  DateTime? deadline;
  bool isCompleted;
  DateTime? completedAt;

  ProgressItem({
    required this.id,
    required this.categoryId,
    required this.title,
    this.deadline,
    this.isCompleted = false,
    this.completedAt,
  });

  bool get isOverdue => deadline != null && !isCompleted && deadline!.isBefore(DateTime.now());
  bool get isDueSoon {
    if (deadline == null || isCompleted) return false;
    final diff = deadline!.difference(DateTime.now()).inDays;
    return diff >= 0 && diff <= 3;
  }
}

class StudentProgress {
  final String studentId;
  final String itemId;
  bool isCompleted;
  DateTime? completedAt;

  StudentProgress({
    required this.studentId,
    required this.itemId,
    this.isCompleted = false,
    this.completedAt,
  });
}

// ---- Message / Photo from student to admin ----
class StudentMessage {
  final String id;
  final String fromStudentId;
  final String fromName;
  final String? text;
  final String? imageUrl;
  final DateTime createdAt;
  bool isRead;

  StudentMessage({
    required this.id,
    required this.fromStudentId,
    required this.fromName,
    this.text,
    this.imageUrl,
    required this.createdAt,
    this.isRead = false,
  });
}

// ---- Message from parent to admin ----
class ParentMessage {
  final String id;
  final String fromParentId;
  final String fromName;
  final String studentId;   // 対象生徒ID
  final String studentName; // 対象生徒名
  final String? text;
  final String? imageUrl;
  final DateTime createdAt;
  bool isRead;

  ParentMessage({
    required this.id,
    required this.fromParentId,
    required this.fromName,
    required this.studentId,
    required this.studentName,
    this.text,
    this.imageUrl,
    required this.createdAt,
    this.isRead = false,
  });
}

// ---- Reply from admin to student/parent ----
// threadType: 'student' or 'parent'
// threadId  : studentId (student thread) or studentId (parent thread)
class AdminReply {
  final String id;
  final String threadType; // 'student' | 'parent'
  final String threadId;   // studentId
  final String text;
  final String? imageUrl;  // 管理者→保護者/生徒への画像
  final DateTime createdAt;
  bool isRead; // 生徒/保護者側既読

  AdminReply({
    required this.id,
    required this.threadType,
    required this.threadId,
    required this.text,
    this.imageUrl,
    required this.createdAt,
    this.isRead = false,
  });
}

// ---- New Inquiry (新規問い合わせ) ----
class Inquiry {
  final String id;
  String name;
  String school;
  String grade;
  // 問い合わせ日（電話/LINE）
  DateTime? inquiryDate;
  String inquiryMethod;      // '電話' | 'LINE' | 'その他'
  // 体験授業
  DateTime? trialDate;
  String trialStartTime;
  String trialEndTime;
  // 面談
  DateTime? interviewDate;
  String interviewStartTime;
  String interviewEndTime;
  // 初回授業
  DateTime? firstLessonDate;
  String firstLessonStartTime;
  String firstLessonEndTime;
  // 口座登録
  DateTime? bankRegisteredDate;
  String bankMemo;
  // テキスト配布
  DateTime? textDeliveredDate;
  String textMemo;
  // メモ全般
  String memo;
  final DateTime createdAt;

  Inquiry({
    required this.id,
    required this.name,
    this.school = '',
    this.grade = '',
    this.inquiryDate,
    this.inquiryMethod = '電話',
    this.trialDate,
    this.trialStartTime = '16:00',
    this.trialEndTime = '17:00',
    this.interviewDate,
    this.interviewStartTime = '16:00',
    this.interviewEndTime = '17:00',
    this.firstLessonDate,
    this.firstLessonStartTime = '16:00',
    this.firstLessonEndTime = '18:00',
    this.bankRegisteredDate,
    this.bankMemo = '',
    this.textDeliveredDate,
    this.textMemo = '',
    this.memo = '',
    required this.createdAt,
  });
}

// ---- Absence notification ----
class AbsenceNotification {
  final String id;
  final String studentId;
  final String studentName;
  final String lessonId;
  final String subject;
  final DateTime lessonDate;
  final String reason;
  final String sender; // 'student' | 'parent'
  final String senderName;
  final DateTime sentAt;
  bool isRead;

  AbsenceNotification({
    required this.id,
    required this.studentId,
    required this.studentName,
    required this.lessonId,
    required this.subject,
    required this.lessonDate,
    required this.reason,
    required this.sender,
    required this.senderName,
    required this.sentAt,
    this.isRead = false,
  });
}

// ---- Progress Completion Notification ----
/// 進捗タスクが完了したときに生徒・保護者へ届く通知
class ProgressCompletionNotification {
  final String id;
  final String studentId;
  final String studentName;
  final String itemTitle;
  final String subject;
  final DateTime completedAt;
  bool isReadByStudent;
  bool isReadByParent;

  ProgressCompletionNotification({
    required this.id,
    required this.studentId,
    required this.studentName,
    required this.itemTitle,
    required this.subject,
    required this.completedAt,
    this.isReadByStudent = false,
    this.isReadByParent = false,
  });
}

// ---- Announcement (管理者→生徒/保護者/講師 お知らせ) ----
class Announcement {
  final String id;
  final String title;
  final String body;
  /// 添付画像URL（任意・後方互換用）
  final String? imageUrl;
  /// 添付画像バイナリ（カメラロール/ファイル選択から取得）
  final List<int>? imageBytes;
  /// 空リスト = 全員、要素あり = 特定ユーザーのみ
  final List<String> targetUserIds;
  /// 対象ロール: 'student' / 'parent' / 'teacher' （空=全ロール）
  final List<String> targetRoles;
  final DateTime createdAt;
  final Set<String> readByUserIds;

  Announcement({
    required this.id,
    required this.title,
    required this.body,
    this.imageUrl,
    this.imageBytes,
    this.targetUserIds = const [],
    this.targetRoles = const [],
    required this.createdAt,
    Set<String>? readByUserIds,
  }) : readByUserIds = readByUserIds ?? {};

  /// 画像があるかどうか（バイナリ優先、なければURL）
  bool get hasImage => imageBytes != null || (imageUrl != null && imageUrl!.isNotEmpty);

  bool isReadBy(String userId) => readByUserIds.contains(userId);
}

// ---- Streak ----
class StudyStreak {
  final String studentId;
  int currentStreak;
  int maxStreak;
  DateTime? lastCompletionDate;

  StudyStreak({
    required this.studentId,
    this.currentStreak = 0,
    this.maxStreak = 0,
    this.lastCompletionDate,
  });
}
