import 'package:flutter/foundation.dart';
import '../models/app_models.dart';

class AppProvider extends ChangeNotifier {
  AppUser? _currentUser;
  AppUser? get currentUser => _currentUser;

  final List<AppUser> _allStudents = [];
  final List<AppUser> _allTeachers = [];
  final List<AppUser> _allParents = [];
  final List<Lesson> _lessons = [];
  final List<ExamScore> _examScores = [];
  final List<Naishin> _naishinList = [];
  final List<MockTest> _mockTests = [];
  final List<ProgressCategory> _progressCategories = [];
  final List<StudentProgress> _studentProgress = [];
  final List<StudyStreak> _streaks = [];
  final List<StudentMessage> _messages = [];
  final List<ParentMessage> _parentMessages = [];
  final List<AdminReply> _adminReplies = [];
  final List<AbsenceNotification> _absenceNotifications = [];
  final List<Inquiry> _inquiries = [];
  final List<ProgressCompletionNotification> _progressNotifications = [];
  final List<Announcement> _announcements = [];
  final List<String> _mockTestNames = [
    'V模擬', '都立過去問', 'V模擬の過去問', '直前対策',
  ];
  // 授業科目リスト（追加・削除可能）
  final List<String> _lessonSubjects = [...defaultLessonSubjects];

  List<AppUser> get allStudents => _allStudents;
  List<AppUser> get allTeachers => _allTeachers;
  List<AppUser> get allParents => _allParents;
  List<Lesson> get lessons => _lessons;
  List<ExamScore> get examScores => _examScores;
  List<Naishin> get naishinList => _naishinList;
  List<MockTest> get mockTests => _mockTests;
  List<ProgressCategory> get progressCategories => _progressCategories;
  List<StudentProgress> get studentProgress => _studentProgress;
  List<String> get mockTestNames => _mockTestNames;
  List<String> get lessonSubjects => _lessonSubjects;
  List<StudentMessage> get messages => _messages;
  List<ParentMessage> get parentMessages => _parentMessages;
  List<AdminReply> get adminReplies => _adminReplies;
  List<AbsenceNotification> get absenceNotifications => _absenceNotifications;
  List<ProgressCompletionNotification> get progressNotifications => _progressNotifications;
  List<Announcement> get announcements => _announcements;

  int get unreadMessageCount =>
      _messages.where((m) => !m.isRead).length +
      _parentMessages.where((m) => !m.isRead).length;
  int get unreadAbsenceCount => _absenceNotifications.where((a) => !a.isRead).length;

  AppProvider() {
    _initSampleData();
  }

  void _initSampleData() {
    _allStudents.addAll([
      AppUser(id: 's1', name: '田中 太郎', role: UserRole.student, grade: 2, className: 'A'),
      AppUser(id: 's2', name: '鈴木 花子', role: UserRole.student, grade: 1, className: 'B'),
      AppUser(id: 's3', name: '佐藤 次郎', role: UserRole.student, grade: 3, className: 'A'),
      AppUser(id: 's4', name: '高橋 美咲', role: UserRole.student, grade: 2, className: 'B'),
    ]);

    _allTeachers.addAll([
      AppUser(id: 't1', name: '山田 先生', role: UserRole.teacher),
      AppUser(id: 't2', name: '佐々木 先生', role: UserRole.teacher),
    ]);

    // サンプル保護者アカウント（生徒と紐付け済み）
    _allParents.addAll([
      AppUser(
        id: 'parent1',
        name: '田中 保護者',
        role: UserRole.parent,
        studentIds: ['s1'],   // 田中太郎のみ
        password: '1234',
      ),
      AppUser(
        id: 'parent2',
        name: '鈴木 保護者',
        role: UserRole.parent,
        studentIds: ['s2'],   // 鈴木花子のみ
        password: '1234',
      ),
    ]);

    final now = DateTime.now();
    _lessons.addAll([
      Lesson(id: 'l1', studentId: 's1', date: now, startTime: '16:00', endTime: '18:00', subject: '数学', memo: '二次方程式', teacherId: 't1'),
      Lesson(id: 'l2', studentId: 's1', date: now.add(const Duration(days: 2)), startTime: '16:00', endTime: '18:00', subject: '英語', teacherId: 't2'),
      Lesson(id: 'l3', studentId: 's1', date: now.add(const Duration(days: 5)), startTime: '15:00', endTime: '17:00', subject: '国語', teacherId: 't1'),
      Lesson(id: 'l4', studentId: 's1', date: now.add(const Duration(days: 7)), startTime: '16:00', endTime: '18:00', subject: '数学', teacherId: 't1'),
      Lesson(id: 'l5', studentId: 's1', date: now.add(const Duration(days: 9)), startTime: '16:00', endTime: '18:00', subject: '理科', teacherId: 't2'),
      Lesson(id: 'l6', studentId: 's1', date: now.subtract(const Duration(days: 3)), startTime: '16:00', endTime: '18:00', subject: '数学', teacherId: 't1'),
      Lesson(id: 'l7', studentId: 's2', date: now.add(const Duration(days: 1)), startTime: '17:00', endTime: '19:00', subject: '数学', teacherId: 't1'),
      Lesson(id: 'l8', studentId: 's2', date: now.add(const Duration(days: 4)), startTime: '17:00', endTime: '19:00', subject: '英語', teacherId: 't2'),
      Lesson(id: 'l9', studentId: 's3', date: now.add(const Duration(days: 1)), startTime: '18:00', endTime: '20:00', subject: '数学', teacherId: 't1'),
      Lesson(id: 'l10', studentId: 's4', date: now.add(const Duration(days: 2)), startTime: '15:00', endTime: '17:00', subject: '英語', teacherId: 't2'),
    ]);

    _examScores.addAll([
      ExamScore(
        id: 'e1', studentId: 's1', examType: '1学期中間', year: 2025,
        scores: {'国語': 78, '数学': 85, '英語': 72, '理科': 80, '社会': 74},
        goodPoints: '数学の計算が得意になった', reflections: '英語の単語が弱い',
        nextGoal: '英語80点以上', goalDeadline: '6月15日', goalDetail: 'ワーク80ページ終了',
      ),
      ExamScore(
        id: 'e2', studentId: 's1', examType: '1学期期末', year: 2025,
        scores: {'国語': 82, '数学': 88, '英語': 79, '理科': 85, '社会': 78, '音楽': 90, '美術': 85, '保健体育': 88, '技術家庭': 82},
      ),
      ExamScore(
        id: 'e3', studentId: 's1', examType: '2学期中間', year: 2025,
        scores: {'国語': 84, '数学': 91, '英語': 83, '理科': 87, '社会': 80},
      ),
      ExamScore(
        id: 'e4', studentId: 's2', examType: '1学期中間', year: 2025,
        scores: {'国語': 88, '数学': 76, '英語': 92, '理科': 70, '社会': 82},
      ),
      ExamScore(
        id: 'e5', studentId: 's2', examType: '1学期期末', year: 2025,
        scores: {'国語': 90, '数学': 78, '英語': 95, '理科': 74, '社会': 85, '音楽': 88, '美術': 92, '保健体育': 95, '技術家庭': 86},
      ),
    ]);

    _naishinList.addAll([
      Naishin(id: 'n1', studentId: 's1', term: '1学期', year: 2025,
          grades: {'国語': 4, '数学': 4, '英語': 3, '理科': 4, '社会': 3, '音楽': 4, '美術': 3, '保健体育': 4, '技術家庭': 3}),
      Naishin(id: 'n2', studentId: 's1', term: '2学期', year: 2025,
          grades: {'国語': 4, '数学': 5, '英語': 4, '理科': 4, '社会': 4, '音楽': 4, '美術': 3, '保健体育': 4, '技術家庭': 4}),
    ]);

    _mockTests.addAll([
      MockTest(id: 'm1', studentId: 's1', testName: 'V模擬', date: DateTime(2025, 5, 10),
        scores: {'国語': 72, '数学': 80, '英語': 68, '理科': 75, '社会': 70},
        deviations: {'国語': 52.0, '数学': 56.0, '英語': 50.0, '理科': 53.0, '社会': 51.0},
        targetSchool: '都立○○高校'),
      MockTest(id: 'm2', studentId: 's1', testName: 'V模擬', date: DateTime(2025, 6, 14),
        scores: {'国語': 76, '数学': 85, '英語': 73, '理科': 78, '社会': 74},
        deviations: {'国語': 54.0, '数学': 58.0, '英語': 52.0, '理科': 55.0, '社会': 53.0},
        targetSchool: '都立○○高校'),
    ]);

    _progressCategories.addAll([
      ProgressCategory(id: 'pc1', subject: '数学', items: [
        ProgressItem(id: 'pi1', categoryId: 'pc1', title: '毎日の計算トレーニング1回目', deadline: now.add(const Duration(days: 3))),
        ProgressItem(id: 'pi2', categoryId: 'pc1', title: '毎日の計算トレーニング直し', deadline: now.add(const Duration(days: 5))),
        ProgressItem(id: 'pi3', categoryId: 'pc1', title: '新ワーク1回目', deadline: now.add(const Duration(days: 10))),
        ProgressItem(id: 'pi4', categoryId: 'pc1', title: '新ワーク直し', deadline: now.add(const Duration(days: 14))),
        ProgressItem(id: 'pi5', categoryId: 'pc1', title: '単元サポートテスト', deadline: now.add(const Duration(days: 20))),
        ProgressItem(id: 'pi6', categoryId: 'pc1', title: '教科別テスト', deadline: now.add(const Duration(days: 25))),
      ]),
      ProgressCategory(id: 'pc2', subject: '英語', items: [
        ProgressItem(id: 'pi7', categoryId: 'pc2', title: 'スピーキング', deadline: now.add(const Duration(days: 4))),
        ProgressItem(id: 'pi8', categoryId: 'pc2', title: 'ライティング', deadline: now.add(const Duration(days: 6))),
        ProgressItem(id: 'pi9', categoryId: 'pc2', title: '新ワーク1回目', deadline: now.add(const Duration(days: 12))),
        ProgressItem(id: 'pi10', categoryId: 'pc2', title: '新ワーク直し', deadline: now.add(const Duration(days: 16))),
        ProgressItem(id: 'pi11', categoryId: 'pc2', title: '単元サポートテスト', deadline: now.add(const Duration(days: 21))),
        ProgressItem(id: 'pi12', categoryId: 'pc2', title: 'ワークテスト', deadline: now.add(const Duration(days: 28))),
      ]),
    ]);

    _studentProgress.addAll([
      StudentProgress(studentId: 's1', itemId: 'pi1', isCompleted: true, completedAt: now.subtract(const Duration(days: 1))),
      StudentProgress(studentId: 's1', itemId: 'pi2', isCompleted: true, completedAt: now.subtract(const Duration(hours: 5))),
      StudentProgress(studentId: 's1', itemId: 'pi7', isCompleted: true, completedAt: now.subtract(const Duration(days: 2))),
    ]);

    _streaks.add(StudyStreak(studentId: 's1', currentStreak: 7, maxStreak: 12, lastCompletionDate: now));
    _streaks.add(StudyStreak(studentId: 's2', currentStreak: 3, maxStreak: 8, lastCompletionDate: now));

    _messages.addAll([
      StudentMessage(
        id: 'msg1', fromStudentId: 's1', fromName: '田中 太郎',
        text: '今日の数学のワークが終わりました！確認お願いします。',
        createdAt: now.subtract(const Duration(hours: 2)), isRead: false,
      ),
    ]);

    _parentMessages.addAll([
      ParentMessage(
        id: 'pmsg1', fromParentId: 'parent1', fromName: '田中 保護者',
        studentId: 's1', studentName: '田中 太郎',
        text: '来週の授業について確認したいことがあります。よろしくお願いします。',
        createdAt: now.subtract(const Duration(hours: 3)), isRead: false,
      ),
    ]);

    _absenceNotifications.add(AbsenceNotification(
      id: 'abs1', studentId: 's2', studentName: '鈴木 花子',
      lessonId: 'l8', subject: '英語',
      lessonDate: now.add(const Duration(days: 4)),
      reason: '体調不良のため', sender: 'parent', senderName: '鈴木 保護者',
      sentAt: now.subtract(const Duration(hours: 1)), isRead: false,
    ));
  }

  // ---- Auth ----
  bool login(String userId, String password, UserRole role) {
    if (role == UserRole.admin && userId == 'admin' && password == 'miura2025') {
      _currentUser = AppUser(id: 'admin', name: '三浦塾長', role: UserRole.admin);
      notifyListeners(); return true;
    }
    if (role == UserRole.teacher) {
      final t = _allTeachers.where((t) => t.id == userId).firstOrNull;
      if (t != null && password == '1234') {
        _currentUser = t; notifyListeners(); return true;
      }
    }
    if (role == UserRole.student) {
      final s = _allStudents.where((s) => s.id == userId).firstOrNull;
      if (s != null && password == '1234') {
        _currentUser = s; notifyListeners(); return true;
      }
    }
    if (role == UserRole.parent) {
      final p = _allParents.where((p) => p.id == userId).firstOrNull;
      if (p != null && (p.password ?? '1234') == password) {
        _currentUser = p; notifyListeners(); return true;
      }
    }
    return false;
  }

  void logout() { _currentUser = null; notifyListeners(); }

  // ---- Lessons ----
  // isWeekly=true の授業は「開始日以降、同曜日の全日付」に動的展開する
  // カレンダー表示範囲: 2025/1/1 〜 2027/12/31
  static final DateTime _calStart = DateTime(2025, 1, 1);
  static final DateTime _calEnd   = DateTime(2027, 12, 31);

  /// isWeekly授業を同曜日で無制限に展開した仮想Lessonリストを返す
  List<Lesson> _expandWeekly(Lesson l) {
    if (!l.isWeekly) return [l];
    final results = <Lesson>[];
    // 開始日当日から calEnd まで、同曜日の日付を列挙
    DateTime cur = l.date;
    while (!cur.isAfter(_calEnd)) {
      if (!cur.isBefore(_calStart)) {
        results.add(Lesson(
          id: cur == l.date ? l.id : '${l.id}_${cur.millisecondsSinceEpoch}',
          studentId: l.studentId,
          date: cur,
          startTime: l.startTime,
          endTime: l.endTime,
          subject: l.subject,
          teacherId: l.teacherId,
          isWeekly: true,
          memo: l.memo,
        ));
      }
      cur = cur.add(const Duration(days: 7));
    }
    return results;
  }

  /// 全Lessonを展開済みで取得（private）
  List<Lesson> get _expandedLessons =>
      _lessons.expand(_expandWeekly).toList();

  /// 全Lessonを展開済みで取得（public - 講師ダッシュボードなどから参照可能）
  List<Lesson> get expandedLessons => _expandedLessons;

  List<Lesson> getLessonsForStudent(String studentId) =>
      _expandedLessons.where((l) => l.studentId == studentId).toList();

  List<Lesson> getLessonsOnDate(String studentId, DateTime date) =>
      _expandedLessons.where((l) => l.studentId == studentId &&
          l.date.year == date.year && l.date.month == date.month && l.date.day == date.day).toList();

  List<Lesson> getAllLessonsOnDate(DateTime date) =>
      _expandedLessons.where((l) =>
          l.date.year == date.year && l.date.month == date.month && l.date.day == date.day).toList();

  Set<DateTime> getLessonDatesForStudent(String studentId) =>
      _expandedLessons.where((l) => l.studentId == studentId)
          .map((l) => DateTime(l.date.year, l.date.month, l.date.day)).toSet();

  Set<DateTime> getAllLessonDates() =>
      _expandedLessons.map((l) => DateTime(l.date.year, l.date.month, l.date.day)).toSet();

  void addLesson(Lesson lesson) {
    _lessons.add(lesson);
    notifyListeners();
  }

  /// 授業を組む：毎週繰り返しは1件登録で動的展開（制限なし）
  void scheduleLesson({
    required String studentId,
    required DateTime date,
    required String startTime,
    required String endTime,
    required String subject,
    String? teacherId,
    bool isWeekly = false,
    String? memo,
  }) {
    final base = DateTime(date.year, date.month, date.day);
    final id = 'l_${DateTime.now().millisecondsSinceEpoch}';
    // isWeekly=true でも1件だけ登録。展開は _expandWeekly が動的に行う
    _lessons.add(Lesson(
      id: id,
      studentId: studentId,
      date: base,
      startTime: startTime,
      endTime: endTime,
      subject: subject,
      teacherId: teacherId,
      isWeekly: isWeekly,
      memo: memo,
    ));
    notifyListeners();
  }

  void removeLesson(String lessonId) {
    _lessons.removeWhere((l) => l.id == lessonId);
    notifyListeners();
  }

  // ---- Lesson Subjects ----
  void addLessonSubject(String name) {
    if (!_lessonSubjects.contains(name)) {
      _lessonSubjects.add(name);
      notifyListeners();
    }
  }

  void removeLessonSubject(String name) {
    _lessonSubjects.remove(name);
    notifyListeners();
  }

  // ---- Absence ----
  void sendAbsenceNotification(AbsenceNotification notif) {
    _absenceNotifications.add(notif);
    final lessonIdx = _lessons.indexWhere((l) => l.id == notif.lessonId);
    if (lessonIdx >= 0) {
      _lessons[lessonIdx].isAbsent = true;
      _lessons[lessonIdx].absentReason = notif.reason;
      _lessons[lessonIdx].absentSender = notif.sender;
    }
    notifyListeners();
  }

  void markAbsenceRead(String id) {
    final idx = _absenceNotifications.indexWhere((a) => a.id == id);
    if (idx >= 0) { _absenceNotifications[idx].isRead = true; notifyListeners(); }
  }

  // ---- Scores ----
  List<ExamScore> getScoresForStudent(String studentId) =>
      _examScores.where((e) => e.studentId == studentId).toList();

  /// 同教科で前回比較 (examType順)
  Map<String, int> getSubjectDiffs(String studentId, String currentExamType) {
    final all = getScoresForStudent(studentId);
    final order = examTypes;
    final currentIdx = order.indexOf(currentExamType);
    if (currentIdx <= 0) return {};

    final current = all.where((e) => e.examType == currentExamType).firstOrNull;
    if (current == null) return {};

    final diffs = <String, int>{};
    for (int i = currentIdx - 1; i >= 0; i--) {
      final prev = all.where((e) => e.examType == order[i]).firstOrNull;
      if (prev == null) continue;
      for (final subject in current.scores.keys) {
        if (diffs.containsKey(subject)) continue;
        final curVal = current.scores[subject];
        final prevVal = prev.scores[subject];
        if (curVal != null && prevVal != null) {
          diffs[subject] = curVal - prevVal;
        }
      }
      if (diffs.length == current.scores.keys.length) break;
    }
    return diffs;
  }

  void saveExamScore(ExamScore score) {
    final idx = _examScores.indexWhere((e) => e.id == score.id);
    if (idx >= 0) { _examScores[idx] = score; } else { _examScores.add(score); }
    notifyListeners();
  }

  // ---- Naishin ----
  List<Naishin> getNaishinForStudent(String studentId) =>
      _naishinList.where((n) => n.studentId == studentId).toList();

  void saveNaishin(Naishin naishin) {
    final idx = _naishinList.indexWhere((n) => n.id == naishin.id);
    if (idx >= 0) { _naishinList[idx] = naishin; } else { _naishinList.add(naishin); }
    notifyListeners();
  }

  // ---- Mock Tests ----
  List<MockTest> getMockTestsForStudent(String studentId) =>
      _mockTests.where((m) => m.studentId == studentId).toList();

  void addMockTestName(String name) {
    if (!_mockTestNames.contains(name)) { _mockTestNames.add(name); notifyListeners(); }
  }

  void removeMockTestName(String name) {
    _mockTestNames.remove(name);
    notifyListeners();
  }

  void saveMockTest(MockTest test) { _mockTests.add(test); notifyListeners(); }

  void updateMockTest(MockTest test) {
    final idx = _mockTests.indexWhere((m) => m.id == test.id);
    if (idx >= 0) { _mockTests[idx] = test; } else { _mockTests.add(test); }
    notifyListeners();
  }

  void removeMockTest(String id) {
    _mockTests.removeWhere((m) => m.id == id);
    notifyListeners();
  }

  // ---- Progress ----
  bool isItemCompleted(String studentId, String itemId) =>
      _studentProgress.any((p) => p.studentId == studentId && p.itemId == itemId && p.isCompleted);

  void toggleProgress(String studentId, String itemId) {
    final idx = _studentProgress.indexWhere((p) => p.studentId == studentId && p.itemId == itemId);
    bool nowCompleted;
    if (idx >= 0) {
      _studentProgress[idx].isCompleted = !_studentProgress[idx].isCompleted;
      _studentProgress[idx].completedAt = _studentProgress[idx].isCompleted ? DateTime.now() : null;
      nowCompleted = _studentProgress[idx].isCompleted;
    } else {
      _studentProgress.add(StudentProgress(studentId: studentId, itemId: itemId, isCompleted: true, completedAt: DateTime.now()));
      nowCompleted = true;
    }

    // 完了になった場合のみ通知を生成
    if (nowCompleted) {
      _generateProgressNotification(studentId, itemId);
    }
    notifyListeners();
  }

  /// 進捗完了通知を生成する（内部用）
  void _generateProgressNotification(String studentId, String itemId) {
    final student = getStudentById(studentId);
    // カテゴリ・タイトルを検索
    String itemTitle = 'タスク';
    String subject = '';
    for (final cat in _progressCategories) {
      for (final item in cat.items) {
        if (item.id == itemId) {
          itemTitle = item.title;
          subject = cat.subject;
          break;
        }
      }
      if (subject.isNotEmpty) break;
    }
    _progressNotifications.add(ProgressCompletionNotification(
      id: 'pn_${DateTime.now().millisecondsSinceEpoch}',
      studentId: studentId,
      studentName: student?.name ?? '',
      itemTitle: itemTitle,
      subject: subject,
      completedAt: DateTime.now(),
    ));
  }

  double getProgressRate(String studentId) {
    final total = _progressCategories.fold(0, (a, c) => a + c.items.length);
    if (total == 0) return 0;
    final completed = _studentProgress.where((p) => p.studentId == studentId && p.isCompleted).length;
    return completed / total;
  }

  StudyStreak? getStreak(String studentId) =>
      _streaks.where((s) => s.studentId == studentId).firstOrNull;

  void addProgressItem(String categoryId, ProgressItem item) {
    final cat = _progressCategories.firstWhere((c) => c.id == categoryId);
    cat.items.add(item);
    notifyListeners();
  }

  void addProgressCategory(ProgressCategory category) {
    _progressCategories.add(category);
    notifyListeners();
  }

  // ---- Student Messages ----
  List<StudentMessage> getMessagesFromStudent(String studentId) =>
      _messages.where((m) => m.fromStudentId == studentId).toList();

  void sendMessage(StudentMessage msg) { _messages.add(msg); notifyListeners(); }

  void markMessageRead(String id) {
    final idx = _messages.indexWhere((m) => m.id == id);
    if (idx >= 0) { _messages[idx].isRead = true; notifyListeners(); }
  }

  // ---- Admin Replies ----
  /// 管理者から特定スレッドへの返信一覧
  List<AdminReply> getAdminReplies(String threadType, String threadId) =>
      _adminReplies.where((r) => r.threadType == threadType && r.threadId == threadId).toList();

  /// 管理者が返信を送信
  void sendAdminReply(AdminReply reply) {
    _adminReplies.add(reply);
    notifyListeners();
  }

  /// 生徒/保護者側が既読にする
  void markAdminReplyRead(String threadType, String threadId) {
    for (final r in _adminReplies) {
      if (r.threadType == threadType && r.threadId == threadId && !r.isRead) {
        r.isRead = true;
      }
    }
    notifyListeners();
  }

  /// 管理者側の未読返信数（生徒/保護者からの未返信カウント用ではなく全体通知）
  int getUnreadAdminReplyCount(String threadType, String threadId) =>
      _adminReplies.where((r) => r.threadType == threadType && r.threadId == threadId && !r.isRead).length;

  // ---- Parent Messages ----
  List<ParentMessage> getParentMessagesForStudent(String studentId) =>
      _parentMessages.where((m) => m.studentId == studentId).toList();

  void sendParentMessage(ParentMessage msg) { _parentMessages.add(msg); notifyListeners(); }

  void markParentMessageRead(String id) {
    final idx = _parentMessages.indexWhere((m) => m.id == id);
    if (idx >= 0) { _parentMessages[idx].isRead = true; notifyListeners(); }
  }

  int get unreadParentMessageCount => _parentMessages.where((m) => !m.isRead).length;

  // ---- Students / Teachers ----
  void addStudent(AppUser student) { _allStudents.add(student); notifyListeners(); }
  void addTeacher(AppUser teacher) { _allTeachers.add(teacher); notifyListeners(); }
  void removeTeacher(String id) { _allTeachers.removeWhere((t) => t.id == id); notifyListeners(); }

  // ---- Parents ----
  void addParent(AppUser parent) {
    _allParents.add(parent);
    notifyListeners();
  }

  void updateParent(AppUser updated) {
    final idx = _allParents.indexWhere((p) => p.id == updated.id);
    if (idx >= 0) {
      _allParents[idx] = updated;
      // ログイン中の保護者が自分自身を更新した場合、currentUserも更新
      if (_currentUser?.id == updated.id) _currentUser = updated;
      notifyListeners();
    }
  }

  void removeParent(String id) {
    _allParents.removeWhere((p) => p.id == id);
    notifyListeners();
  }

  AppUser? getParentById(String id) =>
      _allParents.where((p) => p.id == id).firstOrNull;

  /// 特定生徒に紐付いた保護者リストを返す
  List<AppUser> getParentsForStudent(String studentId) =>
      _allParents.where((p) => p.studentIds.contains(studentId)).toList();

  /// 保護者IDが既に存在するか確認
  bool parentIdExists(String id) => _allParents.any((p) => p.id == id);

  AppUser? getStudentById(String id) =>
      _allStudents.where((s) => s.id == id).firstOrNull;

  AppUser? getTeacherById(String id) =>
      _allTeachers.where((t) => t.id == id).firstOrNull;

  List<AbsenceNotification> getAbsencesForStudent(String studentId) =>
      _absenceNotifications.where((a) => a.studentId == studentId).toList();

  // ---- Inquiry (新規問い合わせ) ----
  List<Inquiry> get inquiries => List.unmodifiable(_inquiries);

  void addInquiry(Inquiry inquiry) {
    _inquiries.insert(0, inquiry);
    notifyListeners();
  }

  void updateInquiry(Inquiry updated) {
    final idx = _inquiries.indexWhere((i) => i.id == updated.id);
    if (idx >= 0) { _inquiries[idx] = updated; notifyListeners(); }
  }

  void deleteInquiry(String id) {
    _inquiries.removeWhere((i) => i.id == id);
    notifyListeners();
  }

  void removeStudent(String id) {
    _allStudents.removeWhere((s) => s.id == id);
    notifyListeners();
  }

  void updateStudent(AppUser updated) {
    final idx = _allStudents.indexWhere((s) => s.id == updated.id);
    if (idx >= 0) {
      _allStudents[idx] = updated;
      notifyListeners();
    }
  }

  // ---- Progress Completion Notifications ----

  /// 生徒向け未読通知リストを返す
  List<ProgressCompletionNotification> getProgressNotificationsForStudent(String studentId) =>
      _progressNotifications.where((n) => n.studentId == studentId && !n.isReadByStudent).toList();

  /// 保護者向け未読通知リストを返す（対象生徒のものすべて）
  List<ProgressCompletionNotification> getProgressNotificationsForParent(String studentId) =>
      _progressNotifications.where((n) => n.studentId == studentId && !n.isReadByParent).toList();

  /// 生徒として既読にする
  void markProgressNotificationReadByStudent(String notifId) {
    final idx = _progressNotifications.indexWhere((n) => n.id == notifId);
    if (idx >= 0) {
      _progressNotifications[idx].isReadByStudent = true;
      notifyListeners();
    }
  }

  /// 保護者として既読にする
  void markProgressNotificationReadByParent(String notifId) {
    final idx = _progressNotifications.indexWhere((n) => n.id == notifId);
    if (idx >= 0) {
      _progressNotifications[idx].isReadByParent = true;
      notifyListeners();
    }
  }

  // ---- Announcements (管理者→全員) ----

  /// お知らせを追加する（管理者用）
  void addAnnouncement(Announcement announcement) {
    _announcements.insert(0, announcement);
    notifyListeners();
  }

  /// ユーザーに届くお知らせを返す
  List<Announcement> getAnnouncementsForUser(String userId, String role) {
    return _announcements.where((a) {
      // ロールフィルタ（空=全員）
      if (a.targetRoles.isNotEmpty && !a.targetRoles.contains(role)) return false;
      // ユーザーIDフィルタ（空=全員）
      if (a.targetUserIds.isNotEmpty && !a.targetUserIds.contains(userId)) return false;
      return true;
    }).toList();
  }

  /// お知らせを既読にする
  void markAnnouncementRead(String announcementId, String userId) {
    final idx = _announcements.indexWhere((a) => a.id == announcementId);
    if (idx >= 0) {
      _announcements[idx].readByUserIds.add(userId);
      notifyListeners();
    }
  }

  /// 特定ユーザーの未読お知らせ数
  int getUnreadAnnouncementCount(String userId, String role) =>
      getAnnouncementsForUser(userId, role).where((a) => !a.isReadBy(userId)).length;
}
