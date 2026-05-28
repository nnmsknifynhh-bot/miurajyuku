// ============================================================
// 講師ホーム画面 — 三浦塾 学習管理システム
// 権限: 生徒成績閲覧 / 管理者への連絡閲覧 / 進捗完了操作
// ============================================================

import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:confetti/confetti.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';
import '../auth/login_screen.dart';

class TeacherHome extends StatefulWidget {
  const TeacherHome({super.key});

  @override
  State<TeacherHome> createState() => _TeacherHomeState();
}

class _TeacherHomeState extends State<TeacherHome> {
  int _currentIndex = 0;

  final List<Widget> _tabs = const [
    _TeacherDashboardTab(),
    _TeacherStudentsTab(),
    _TeacherProgressTab(),
    _TeacherMessagesTab(),
  ];

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final teacher = provider.currentUser;
    final unreadMsg = provider.unreadMessageCount;
    final unreadAnnounce = teacher == null
        ? 0
        : provider.getUnreadAnnouncementCount(teacher.id, 'teacher');
    final unread = unreadMsg + unreadAnnounce;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: AppColors.navyDark,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              provider.currentUser?.name ?? '講師',
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const Text(
              '講師ダッシュボード',
              style: TextStyle(color: AppColors.silverDim, fontSize: 11),
            ),
          ],
        ),
        actions: [
          if (unread > 0)
            Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.danger,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '未読 $unread',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.silverDim),
            onPressed: () {
              context.read<AppProvider>().logout();
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: IndexedStack(
          index: _currentIndex,
          children: _tabs,
        ),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppColors.navyDark,
          border: Border(top: BorderSide(color: AppColors.cardBorder, width: 0.5)),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (i) => setState(() => _currentIndex = i),
          backgroundColor: Colors.transparent,
          selectedItemColor: AppColors.yellow,
          unselectedItemColor: AppColors.silverDim,
          elevation: 0,
          type: BottomNavigationBarType.fixed,
          selectedLabelStyle: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
          unselectedLabelStyle: const TextStyle(fontSize: 10),
          items: [
            const BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_outlined),
              activeIcon: Icon(Icons.dashboard),
              label: 'ダッシュボード',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.people_outline),
              activeIcon: Icon(Icons.people),
              label: '生徒管理',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.checklist_outlined),
              activeIcon: Icon(Icons.checklist),
              label: '進捗管理',
            ),
            BottomNavigationBarItem(
              icon: Stack(
                clipBehavior: Clip.none,
                children: [
                  const Icon(Icons.mail_outline),
                  if (unread > 0)
                    Positioned(
                      right: -6,
                      top: -4,
                      child: Container(
                        width: 14,
                        height: 14,
                        decoration: const BoxDecoration(
                          color: AppColors.danger,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: Text(
                            '$unread',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 8,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              activeIcon: const Icon(Icons.mail),
              label: '生徒連絡',
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// 講師ダッシュボードタブ（カレンダー + 担当授業）
// ============================================================
class _TeacherDashboardTab extends StatefulWidget {
  const _TeacherDashboardTab();
  @override
  State<_TeacherDashboardTab> createState() => _TeacherDashboardTabState();
}

class _TeacherDashboardTabState extends State<_TeacherDashboardTab> {
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay;

  @override
  void initState() {
    super.initState();
    _selectedDay = DateTime.now();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final teacher = provider.currentUser;
    if (teacher == null) return const SizedBox.shrink();

    // 担当授業のみ（teacherId が一致するもの）
    final myLessons = provider.expandedLessons
        .where((l) => l.teacherId == teacher.id)
        .toList();

    // カレンダー用：担当授業がある日付セット
    final myDates = myLessons.map((l) =>
        DateTime(l.date.year, l.date.month, l.date.day)).toSet();

    // 選択日の授業
    final selectedLessons = _selectedDay == null ? <Lesson>[] :
        myLessons.where((l) =>
            l.date.year == _selectedDay!.year &&
            l.date.month == _selectedDay!.month &&
            l.date.day == _selectedDay!.day).toList()
          ..sort((a, b) => a.startTime.compareTo(b.startTime));

    // 今日以降の直近授業（最大5件）
    final now = DateTime.now();
    final upcoming = myLessons
        .where((l) => !l.date.isBefore(DateTime(now.year, now.month, now.day)))
        .toList()
      ..sort((a, b) {
        final dc = a.date.compareTo(b.date);
        if (dc != 0) return dc;
        return a.startTime.compareTo(b.startTime);
      });
    final upcomingTop = upcoming.take(5).toList();

    final teacherAnnouncements = provider.getAnnouncementsForUser(teacher.id, 'teacher');
    final unreadTeacherAnnounce = teacherAnnouncements.where((a) => !a.isReadBy(teacher.id)).toList();

    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // ── お知らせバナー（講師用）──
        if (unreadTeacherAnnounce.isNotEmpty)
          _TeacherAnnouncementBanner(announcements: unreadTeacherAnnounce, teacherId: teacher.id),

        // ── カレンダー ──
        Container(
          margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          decoration: BoxDecoration(
            gradient: AppGradients.cardGradient,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.cardBorder),
            boxShadow: [BoxShadow(
                color: AppColors.yellow.withValues(alpha: 0.08), blurRadius: 12)],
          ),
          child: TableCalendar(
            firstDay: DateTime.utc(2025, 1, 1),
            lastDay: DateTime.utc(2027, 12, 31),
            focusedDay: _focusedDay,
            selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
            calendarFormat: CalendarFormat.month,
            eventLoader: (day) {
              final d = DateTime(day.year, day.month, day.day);
              return myDates.contains(d) ? ['lesson'] : [];
            },
            onDaySelected: (sel, foc) =>
                setState(() { _selectedDay = sel; _focusedDay = foc; }),
            onPageChanged: (foc) => setState(() => _focusedDay = foc),
            calendarStyle: CalendarStyle(
              defaultTextStyle: const TextStyle(
                  color: AppColors.textPrimary, fontSize: 13),
              weekendTextStyle: const TextStyle(
                  color: AppColors.silver, fontSize: 13),
              outsideDaysVisible: false,
              selectedDecoration: BoxDecoration(
                color: AppColors.yellow, shape: BoxShape.circle,
                boxShadow: [BoxShadow(
                    color: AppColors.yellow.withValues(alpha: 0.5),
                    blurRadius: 8)],
              ),
              selectedTextStyle: const TextStyle(
                  color: AppColors.navyDark,
                  fontWeight: FontWeight.w800, fontSize: 13),
              todayDecoration: BoxDecoration(
                color: AppColors.yellow.withValues(alpha: 0.2),
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.yellow, width: 1.5),
              ),
              todayTextStyle: const TextStyle(
                  color: AppColors.yellow,
                  fontWeight: FontWeight.w700, fontSize: 13),
              markerDecoration: const BoxDecoration(
                  color: AppColors.info, shape: BoxShape.circle),
              markerSize: 5,
            ),
            headerStyle: HeaderStyle(
              formatButtonVisible: false, titleCentered: true,
              titleTextStyle: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15, fontWeight: FontWeight.w700),
              leftChevronIcon: const Icon(
                  Icons.chevron_left, color: AppColors.silver),
              rightChevronIcon: const Icon(
                  Icons.chevron_right, color: AppColors.silver),
              headerPadding: const EdgeInsets.symmetric(vertical: 10),
              decoration: const BoxDecoration(
                  border: Border(
                      bottom: BorderSide(color: AppColors.cardBorder))),
            ),
            daysOfWeekStyle: const DaysOfWeekStyle(
              weekdayStyle: TextStyle(
                  color: AppColors.textSecondary, fontSize: 11),
              weekendStyle: TextStyle(
                  color: AppColors.silverDim, fontSize: 11),
            ),
          ),
        ),

        // ── 選択日の授業 ──
        if (_selectedDay != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Row(children: [
              const Icon(Icons.event, color: AppColors.yellow, size: 14),
              const SizedBox(width: 6),
              Text(DateFormat('M月d日（E）', 'ja').format(_selectedDay!),
                  style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13, fontWeight: FontWeight.w700)),
              const Spacer(),
              Text('${selectedLessons.length}件',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 12)),
            ]),
          ),
          if (selectedLessons.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text('この日の担当授業はありません',
                  style: TextStyle(
                      color: AppColors.textSecondary, fontSize: 13)),
            )
          else
            ...selectedLessons.map((l) => _TeacherLessonCard(lesson: l)),
        ],

        // ── 直近の授業（今日以降）──
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(children: [
            const Icon(Icons.upcoming, color: AppColors.info, size: 14),
            const SizedBox(width: 6),
            const Text('直近の担当授業',
                style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13, fontWeight: FontWeight.w700)),
          ]),
        ),
        if (upcomingTop.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Text('今後の担当授業はありません',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          )
        else
          ...upcomingTop.map((l) => _TeacherLessonCard(lesson: l, showDate: true)),
        const SizedBox(height: 32),
      ]),
    );
  }
}

// ============================================================
// お知らせバナー（講師用）
// ============================================================
class _TeacherAnnouncementBanner extends StatelessWidget {
  final List<Announcement> announcements;
  final String teacherId;
  const _TeacherAnnouncementBanner({required this.announcements, required this.teacherId});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              const Icon(Icons.campaign_rounded, color: AppColors.yellow, size: 16),
              const SizedBox(width: 6),
              Text('塾長からのお知らせ (${announcements.length})',
                  style: const TextStyle(color: AppColors.yellow, fontSize: 13, fontWeight: FontWeight.w700)),
            ]),
          ),
          ...announcements.map((a) => _buildCard(context, a)),
        ],
      ),
    );
  }

  Widget _buildCard(BuildContext context, Announcement a) {
    final provider = context.read<AppProvider>();
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 8),
      glowColor: AppColors.yellow,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.campaign_rounded, color: AppColors.yellow, size: 16),
            const SizedBox(width: 8),
            Expanded(child: Text(a.title,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700))),
            TextButton(
              onPressed: () => provider.markAnnouncementRead(a.id, teacherId),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('既読', style: TextStyle(color: AppColors.yellow, fontSize: 11)),
            ),
          ]),
          const SizedBox(height: 6),
          Text(a.body, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5)),
          const SizedBox(height: 4),
          Text(
            '${a.createdAt.month}/${a.createdAt.day} ${a.createdAt.hour.toString().padLeft(2, '0')}:${a.createdAt.minute.toString().padLeft(2, '0')}',
            style: const TextStyle(color: AppColors.silverDim, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

// 担当授業カード
class _TeacherLessonCard extends StatelessWidget {
  final Lesson lesson;
  final bool showDate;
  const _TeacherLessonCard({required this.lesson, this.showDate = false});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    final student = provider.getStudentById(lesson.studentId);

    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(children: [
        Container(
          width: 4, height: 50,
          decoration: BoxDecoration(
            color: lesson.isAbsent ? AppColors.danger : AppColors.yellow,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (showDate) ...[
              Text(
                DateFormat('M/d(E)', 'ja').format(lesson.date),
                style: const TextStyle(
                    color: AppColors.info, fontSize: 11, fontWeight: FontWeight.w600),
              ),
              const SizedBox(width: 8),
            ],
            Text(
              '${student?.name ?? '---'}　${lesson.subject}',
              style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ]),
          Text('${lesson.startTime}〜${lesson.endTime}'
              '${lesson.isWeekly ? '　🔁毎週' : ''}',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12)),
          if (lesson.isAbsent)
            const Text('欠席',
                style: TextStyle(color: AppColors.danger, fontSize: 11)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.yellow.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            '中${student?.grade ?? '-'}年',
            style: const TextStyle(
                color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w700),
          ),
        ),
      ]),
    );
  }
}

// ============================================================
// 生徒一覧・成績閲覧タブ
// ============================================================
class _TeacherStudentsTab extends StatefulWidget {
  const _TeacherStudentsTab();

  @override
  State<_TeacherStudentsTab> createState() => _TeacherStudentsTabState();
}

class _TeacherStudentsTabState extends State<_TeacherStudentsTab> {
  String? _selectedStudentId;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final students = provider.allStudents;

    return Column(
      children: [
        const SectionHeader(
          title: '生徒一覧',
          subtitle: '生徒を選んで成績を確認',
        ),
        // 生徒カード一覧
        SizedBox(
          height: 110,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: students.length,
            itemBuilder: (context, i) {
              final s = students[i];
              final selected = s.id == _selectedStudentId;
              return GestureDetector(
                onTap: () => setState(() => _selectedStudentId = s.id),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 90,
                  margin: const EdgeInsets.only(right: 10, bottom: 8),
                  decoration: BoxDecoration(
                    color: selected ? AppColors.yellow.withValues(alpha: 0.15) : AppColors.navyCard,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: selected ? AppColors.yellow : AppColors.cardBorder,
                      width: selected ? 2 : 1,
                    ),
                    boxShadow: selected
                        ? [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.2), blurRadius: 10)]
                        : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: selected
                            ? AppColors.yellow.withValues(alpha: 0.2)
                            : AppColors.navyLight,
                        child: Text(
                          s.name.characters.first,
                          style: TextStyle(
                            color: selected ? AppColors.yellow : AppColors.textPrimary,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        s.name.split(' ').last,
                        style: TextStyle(
                          color: selected ? AppColors.yellow : AppColors.textPrimary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '${s.grade ?? ''}年',
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        // 選択した生徒の成績
        Expanded(
          child: _selectedStudentId == null
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.school_outlined, color: AppColors.silverDim, size: 56),
                      SizedBox(height: 16),
                      Text(
                        '生徒を選択すると成績を確認できます',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                      ),
                    ],
                  ),
                )
              : _StudentGradeViewer(studentId: _selectedStudentId!),
        ),
      ],
    );
  }
}

// ============================================================
// 生徒成績ビューア（読み取り専用）
// ============================================================
class _StudentGradeViewer extends StatefulWidget {
  final String studentId;
  const _StudentGradeViewer({required this.studentId});

  @override
  State<_StudentGradeViewer> createState() => _StudentGradeViewerState();
}

class _StudentGradeViewerState extends State<_StudentGradeViewer>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final student = provider.getStudentById(widget.studentId);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              const Icon(Icons.person, color: AppColors.info, size: 16),
              const SizedBox(width: 6),
              Text(
                student?.name ?? '',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 8),
              if (student?.grade != null)
                AppChip(
                  label: '${student!.grade}年${student.className ?? ''}組',
                  color: AppColors.info,
                ),
            ],
          ),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.navyCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.cardBorder),
          ),
          child: TabBar(
            controller: _tabCtrl,
            indicator: BoxDecoration(
              color: AppColors.yellow,
              borderRadius: BorderRadius.circular(10),
            ),
            indicatorPadding: const EdgeInsets.all(4),
            labelColor: AppColors.navyDark,
            unselectedLabelColor: AppColors.silverDim,
            labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            dividerColor: Colors.transparent,
            tabs: const [
              Tab(text: '定期テスト'),
              Tab(text: '内申'),
              Tab(text: '模試'),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabCtrl,
            children: [
              _TeacherExamTab(studentId: widget.studentId),
              _TeacherNaishinTab(studentId: widget.studentId),
              _TeacherMockTab(studentId: widget.studentId),
            ],
          ),
        ),
      ],
    );
  }
}

// ---- 定期テスト（閲覧のみ）----
class _TeacherExamTab extends StatelessWidget {
  final String studentId;
  const _TeacherExamTab({required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final scores = provider.getScoresForStudent(studentId);

    if (scores.isEmpty) {
      return const Center(
        child: Text('テストデータがありません', style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: scores.length,
      itemBuilder: (context, i) {
        final score = scores[i];
        final diffs = provider.getSubjectDiffs(studentId, score.examType);
        return _ExamCard(score: score, diffs: diffs);
      },
    );
  }
}

class _ExamCard extends StatelessWidget {
  final ExamScore score;
  final Map<String, int> diffs;
  const _ExamCard({required this.score, required this.diffs});

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${score.year}年 ${score.examType}',
                  style: const TextStyle(
                    color: AppColors.yellow,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '合計 ${score.totalScore}点',
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    '平均 ${score.average.toStringAsFixed(1)}点',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(color: AppColors.cardBorder, height: 1),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: score.scores.entries
                .where((e) => e.value != null)
                .map((e) {
              final diff = diffs[e.key];
              return _SubjectScoreChip(
                subject: e.key,
                score: e.value!,
                diff: diff,
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _SubjectScoreChip extends StatelessWidget {
  final String subject;
  final int score;
  final int? diff;
  const _SubjectScoreChip({required this.subject, required this.score, this.diff});

  @override
  Widget build(BuildContext context) {
    Color diffColor = AppColors.textSecondary;
    String diffText = '';
    if (diff != null && diff != 0) {
      diffColor = diff! > 0 ? AppColors.success : AppColors.danger;
      diffText = diff! > 0 ? '+$diff' : '$diff';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.navyCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        children: [
          Text(subject,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
          const SizedBox(height: 2),
          Text('$score点',
              style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 14)),
          if (diffText.isNotEmpty)
            Text(diffText, style: TextStyle(color: diffColor, fontSize: 10, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

// ---- 内申（閲覧のみ）----
class _TeacherNaishinTab extends StatelessWidget {
  final String studentId;
  const _TeacherNaishinTab({required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final list = provider.getNaishinForStudent(studentId);

    if (list.isEmpty) {
      return const Center(
        child: Text('内申データがありません', style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: list.length,
      itemBuilder: (context, i) {
        final n = list[i];
        return GlowCard(
          margin: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${n.year}年 ${n.term}',
                      style: const TextStyle(
                        color: AppColors.yellow,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  Text(
                    '合計 ${n.total} / ${n.grades.length * 5}',
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              const Divider(color: AppColors.cardBorder, height: 1),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: n.grades.entries
                    .where((e) => e.value != null)
                    .map((e) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: AppColors.navyCard,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.cardBorder),
                          ),
                          child: Column(
                            children: [
                              Text(e.key,
                                  style: const TextStyle(
                                      color: AppColors.textSecondary, fontSize: 10)),
                              const SizedBox(height: 2),
                              Text(
                                '${e.value}',
                                style: TextStyle(
                                  color: e.value == 5
                                      ? AppColors.yellow
                                      : e.value! >= 4
                                          ? AppColors.success
                                          : AppColors.textPrimary,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 18,
                                ),
                              ),
                            ],
                          ),
                        ))
                    .toList(),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ---- 模試（閲覧のみ）----
class _TeacherMockTab extends StatelessWidget {
  final String studentId;
  const _TeacherMockTab({required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final tests = provider.getMockTestsForStudent(studentId);

    if (tests.isEmpty) {
      return const Center(
        child: Text('模試データがありません', style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: tests.length,
      itemBuilder: (context, i) {
        final t = tests[i];
        return GlowCard(
          margin: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t.testName,
                          style: const TextStyle(
                            color: AppColors.yellow,
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        Text(
                          '${t.date.year}/${t.date.month}/${t.date.day}',
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '${t.totalScore}点',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        '偏差値 ${t.avgDeviation.toStringAsFixed(1)}',
                        style: const TextStyle(
                          color: AppColors.info,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (t.targetSchool != null) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.school_outlined, size: 12, color: AppColors.silverDim),
                    const SizedBox(width: 4),
                    Text(
                      '志望校: ${t.targetSchool}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              const Divider(color: AppColors.cardBorder, height: 1),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: t.scores.entries
                    .where((e) => e.value != null)
                    .map((e) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: AppColors.navyCard,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.cardBorder),
                          ),
                          child: Column(
                            children: [
                              Text(e.key,
                                  style: const TextStyle(
                                      color: AppColors.textSecondary, fontSize: 10)),
                              const SizedBox(height: 2),
                              Text('${e.value}点',
                                  style: const TextStyle(
                                      color: AppColors.textPrimary,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14)),
                              if (t.deviations[e.key] != null)
                                Text(
                                  t.deviations[e.key]!.toStringAsFixed(1),
                                  style: const TextStyle(
                                      color: AppColors.info, fontSize: 10),
                                ),
                            ],
                          ),
                        ))
                    .toList(),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ============================================================
// 進捗管理タブ（講師は完了操作可能）
// ============================================================
class _TeacherProgressTab extends StatefulWidget {
  const _TeacherProgressTab();

  @override
  State<_TeacherProgressTab> createState() => _TeacherProgressTabState();
}

class _TeacherProgressTabState extends State<_TeacherProgressTab> {
  String? _selectedStudentId;
  late ConfettiController _confettiCtrl;

  @override
  void initState() {
    super.initState();
    _confettiCtrl = ConfettiController(duration: const Duration(seconds: 2));
  }

  @override
  void dispose() {
    _confettiCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final students = provider.allStudents;

    return Stack(
      children: [
        Column(
          children: [
            const SectionHeader(
              title: '進捗管理',
              subtitle: '生徒の進捗を確認・完了登録',
            ),
            // 生徒選択
            SizedBox(
              height: 56,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: students.length,
                itemBuilder: (context, i) {
                  final s = students[i];
                  final sel = s.id == _selectedStudentId;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedStudentId = s.id),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.only(right: 8, bottom: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: sel
                            ? AppColors.yellow.withValues(alpha: 0.15)
                            : AppColors.navyCard,
                        borderRadius: BorderRadius.circular(28),
                        border: Border.all(
                          color: sel ? AppColors.yellow : AppColors.cardBorder,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          s.name.split(' ').last,
                          style: TextStyle(
                            color: sel ? AppColors.yellow : AppColors.textSecondary,
                            fontSize: 13,
                            fontWeight: sel ? FontWeight.w700 : FontWeight.w400,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 4),
            // 進捗リスト
            Expanded(
              child: _selectedStudentId == null
                  ? const Center(
                      child: Text(
                        '生徒を選択して進捗を確認・登録',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    )
                  : _TeacherProgressList(
                      studentId: _selectedStudentId!,
                      onCompleted: () => _confettiCtrl.play(),
                    ),
            ),
          ],
        ),
        // 紙吹雪
        Align(
          alignment: Alignment.topCenter,
          child: ConfettiWidget(
            confettiController: _confettiCtrl,
            blastDirectionality: BlastDirectionality.explosive,
            shouldLoop: false,
            colors: const [
              AppColors.yellow,
              AppColors.silver,
              AppColors.info,
              AppColors.success,
            ],
            numberOfParticles: 25,
          ),
        ),
      ],
    );
  }
}

class _TeacherProgressList extends StatelessWidget {
  final String studentId;
  final VoidCallback onCompleted;
  const _TeacherProgressList({required this.studentId, required this.onCompleted});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final cats = provider.progressCategories;
    final rate = provider.getProgressRate(studentId);

    return SingleChildScrollView(
      child: Column(
        children: [
          // 全体進捗率
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: GlowCard(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('全体達成率',
                            style: TextStyle(
                                color: AppColors.textSecondary, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(
                          '${(rate * 100).toInt()}%',
                          style: const TextStyle(
                            color: AppColors.yellow,
                            fontSize: 36,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 8),
                        AnimatedProgressBar(value: rate, height: 8, label: '進捗'),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  SizedBox(
                    width: 70,
                    height: 70,
                    child: Stack(
                      children: [
                        CircularProgressIndicator(
                          value: rate,
                          strokeWidth: 7,
                          backgroundColor: AppColors.navyCard,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            rate >= 0.8
                                ? AppColors.success
                                : rate >= 0.5
                                    ? AppColors.yellow
                                    : AppColors.info,
                          ),
                        ),
                        Center(
                          child: Text(
                            '${(rate * 100).toInt()}',
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          // カテゴリ別
          ...cats.map((cat) => _TeacherCategorySection(
                category: cat,
                studentId: studentId,
                onCompleted: onCompleted,
              )),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _TeacherCategorySection extends StatelessWidget {
  final ProgressCategory category;
  final String studentId;
  final VoidCallback onCompleted;

  const _TeacherCategorySection({
    required this.category,
    required this.studentId,
    required this.onCompleted,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final total = category.items.length;
    final done =
        category.items.where((i) => provider.isItemCompleted(studentId, i.id)).length;
    final catRate = total > 0 ? done / total : 0.0;

    Color subjectColor;
    switch (category.subject) {
      case '数学':
        subjectColor = AppColors.info;
        break;
      case '英語':
        subjectColor = AppColors.success;
        break;
      case '国語':
        subjectColor = AppColors.warning;
        break;
      default:
        subjectColor = AppColors.silver;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: category.subject,
          subtitle: '$done / $total 完了',
          accentColor: subjectColor,
          trailing: Text(
            '${(catRate * 100).toInt()}%',
            style: TextStyle(
              color: subjectColor,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: AnimatedProgressBar(value: catRate, color: subjectColor, height: 6),
        ),
        const SizedBox(height: 8),
        ...category.items.map((item) => _TeacherProgressItemTile(
              item: item,
              studentId: studentId,
              onCompleted: onCompleted,
            )),
        const SizedBox(height: 8),
      ],
    );
  }
}

class _TeacherProgressItemTile extends StatelessWidget {
  final ProgressItem item;
  final String studentId;
  final VoidCallback onCompleted;

  const _TeacherProgressItemTile({
    required this.item,
    required this.studentId,
    required this.onCompleted,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final isCompleted = provider.isItemCompleted(studentId, item.id);
    final isOverdue = item.isOverdue;
    final isDueSoon = item.isDueSoon;

    Color borderColor = AppColors.cardBorder;
    Color bgColor = AppColors.card;
    if (isCompleted) {
      borderColor = AppColors.success.withValues(alpha: 0.5);
      bgColor = AppColors.success.withValues(alpha: 0.05);
    } else if (isOverdue) {
      borderColor = AppColors.danger.withValues(alpha: 0.5);
      bgColor = AppColors.danger.withValues(alpha: 0.05);
    } else if (isDueSoon) {
      borderColor = AppColors.warning.withValues(alpha: 0.5);
      bgColor = AppColors.warning.withValues(alpha: 0.05);
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: GestureDetector(
          onTap: () {
            final wasCompleted = provider.isItemCompleted(studentId, item.id);
            provider.toggleProgress(studentId, item.id);
            if (!wasCompleted) {
              onCompleted();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Row(
                    children: const [
                      Text('🎉 ', style: TextStyle(fontSize: 18)),
                      Text('完了を登録しました！', style: TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                  backgroundColor: AppColors.success,
                  behavior: SnackBarBehavior.floating,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  duration: const Duration(seconds: 2),
                ),
              );
            }
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isCompleted ? AppColors.success : Colors.transparent,
              border: Border.all(
                color: isCompleted ? AppColors.success : AppColors.silverDim,
                width: 2,
              ),
              boxShadow: isCompleted
                  ? [
                      BoxShadow(
                          color: AppColors.success.withValues(alpha: 0.4), blurRadius: 8)
                    ]
                  : null,
            ),
            child: isCompleted
                ? const Icon(Icons.check, color: Colors.white, size: 16)
                : const Icon(Icons.add, color: AppColors.silverDim, size: 14),
          ),
        ),
        title: Text(
          item.title,
          style: TextStyle(
            color: isCompleted ? AppColors.textSecondary : AppColors.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
            decoration: isCompleted ? TextDecoration.lineThrough : null,
            decorationColor: AppColors.textSecondary,
          ),
        ),
        subtitle: item.deadline != null
            ? _buildDeadline(item, isCompleted)
            : null,
        trailing: _buildChip(item, isCompleted, isOverdue, isDueSoon),
      ),
    );
  }

  Widget? _buildDeadline(ProgressItem item, bool isCompleted) {
    if (item.deadline == null) return null;
    final diff = item.deadline!.difference(DateTime.now()).inDays;
    final color = item.isOverdue
        ? AppColors.danger
        : item.isDueSoon
            ? AppColors.warning
            : AppColors.textSecondary;
    final text = isCompleted
        ? '✓ 完了'
        : item.isOverdue
            ? '期限超過'
            : '残り$diff日';
    return Text(
      text,
      style: TextStyle(color: isCompleted ? AppColors.success : color, fontSize: 11),
    );
  }

  Widget? _buildChip(
      ProgressItem item, bool isCompleted, bool isOverdue, bool isDueSoon) {
    if (isCompleted) return const AppChip(label: '達成 ✦', color: AppColors.success);
    if (isOverdue) return const AppChip(label: '期限超過', color: AppColors.danger);
    if (isDueSoon) return const AppChip(label: 'まもなく', color: AppColors.warning);
    return null;
  }
}

// ============================================================
// 生徒→管理者へのメッセージ閲覧タブ（3タブ：生徒連絡 / チャット閲覧 / お知らせ）
// ============================================================
class _TeacherMessagesTab extends StatefulWidget {
  const _TeacherMessagesTab();

  @override
  State<_TeacherMessagesTab> createState() => _TeacherMessagesTabState();
}

class _TeacherMessagesTabState extends State<_TeacherMessagesTab>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final teacher = provider.currentUser;
    final unreadAnnounce = teacher == null
        ? 0
        : provider.getUnreadAnnouncementCount(teacher.id, 'teacher');

    return Column(
      children: [
        // ── タブバー ──
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          decoration: BoxDecoration(
            color: AppColors.navyCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.cardBorder),
          ),
          child: TabBar(
            controller: _tabCtrl,
            indicator: BoxDecoration(
              color: AppColors.yellow,
              borderRadius: BorderRadius.circular(10),
            ),
            indicatorPadding: const EdgeInsets.all(4),
            labelColor: AppColors.navyDark,
            unselectedLabelColor: AppColors.silverDim,
            labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            dividerColor: Colors.transparent,
            tabs: [
              const Tab(text: '生徒連絡'),
              const Tab(text: 'チャット閲覧'),
              Tab(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('お知らせ',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    if (unreadAnnounce > 0) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.danger,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '$unreadAnnounce',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        // ── タブコンテンツ ──
        Expanded(
          child: TabBarView(
            controller: _tabCtrl,
            children: [
              // タブ1: 生徒からの連絡
              _TeacherMessagesListView(provider: provider),
              // タブ2: 生徒↔管理者チャット閲覧
              _TeacherChatViewTab(provider: provider),
              // タブ3: お知らせ履歴
              _TeacherAnnouncementHistoryTab(
                teacher: teacher,
                provider: provider,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ============================================================
// チャット閲覧タブ（講師：生徒↔管理者のやり取りを閲覧のみ）
// ============================================================
class _TeacherChatViewTab extends StatelessWidget {
  final AppProvider provider;
  const _TeacherChatViewTab({required this.provider});

  @override
  Widget build(BuildContext context) {
    final students = provider.allStudents;
    if (students.isEmpty) {
      return const Center(
        child: EmptyState(message: '生徒が登録されていません', icon: Icons.school_outlined),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: students.length,
      itemBuilder: (_, i) {
        final s = students[i];
        final msgs = provider.getMessagesFromStudent(s.id);
        final replies = provider.getAdminReplies('student', s.id);
        final total = msgs.length + replies.length;
        return GlowCard(
          margin: const EdgeInsets.only(bottom: 8),
          onTap: () => _showChatSheet(context, s),
          child: Row(children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: AppColors.yellow.withValues(alpha: 0.12),
              child: Text(s.name[0],
                  style: const TextStyle(color: AppColors.yellow, fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s.name,
                  style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 14)),
              Text('メッセージ $total件（生徒${msgs.length} / 管理者${replies.length}）',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
            ])),
            const Icon(Icons.visibility_outlined, color: AppColors.silverDim, size: 18),
          ]),
        );
      },
    );
  }

  void _showChatSheet(BuildContext context, AppUser student) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.card,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _TeacherChatDetailSheet(student: student),
    );
  }
}

/// 講師が生徒↔管理者のチャットを閲覧するシート（送信不可・閲覧専用）
class _TeacherChatDetailSheet extends StatelessWidget {
  final AppUser student;
  const _TeacherChatDetailSheet({required this.student});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final msgs = provider.getMessagesFromStudent(student.id);
    final replies = provider.getAdminReplies('student', student.id);

    // 時系列ソート
    final allItems = <_TchatItem>[
      ...msgs.map((m) => _TchatItem(
          isAdmin: false, name: m.fromName, text: m.text ?? '', time: m.createdAt)),
      ...replies.map((r) => _TchatItem(
          isAdmin: true, name: '管理者', text: r.text,
          imageBytes: r.imageBytes, imageUrl: r.imageUrl, time: r.createdAt)),
    ]..sort((a, b) => a.time.compareTo(b.time));

    return DraggableScrollableSheet(
      initialChildSize: 0.85, maxChildSize: 0.95, minChildSize: 0.5, expand: false,
      builder: (_, sc) => Column(children: [
        Center(child: Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: AppColors.cardBorder, borderRadius: BorderRadius.circular(2)))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Row(children: [
          CircleAvatar(radius: 20, backgroundColor: AppColors.yellow.withValues(alpha: 0.15),
              child: Text(student.name[0],
                  style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w800))),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(student.name,
                style: const TextStyle(color: AppColors.yellow, fontSize: 15, fontWeight: FontWeight.w800)),
            const Text('チャット閲覧（閲覧専用）',
                style: TextStyle(color: AppColors.silverDim, fontSize: 11)),
          ]),
          const Spacer(),
          IconButton(icon: const Icon(Icons.close, color: AppColors.silverDim, size: 20),
              onPressed: () => Navigator.pop(context)),
        ])),
        // 閲覧専用バナー
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          color: AppColors.info.withValues(alpha: 0.1),
          child: Row(children: [
            const Icon(Icons.visibility, color: AppColors.info, size: 14),
            const SizedBox(width: 6),
            const Text('閲覧専用 — このチャットには返信できません',
                style: TextStyle(color: AppColors.info, fontSize: 11)),
          ]),
        ),
        const Divider(color: AppColors.cardBorder, height: 1),
        Expanded(
          child: allItems.isEmpty
              ? const Center(child: EmptyState(message: 'まだメッセージがありません', icon: Icons.chat_bubble_outline))
              : ListView.builder(
                  controller: sc,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  itemCount: allItems.length,
                  itemBuilder: (_, i) => _TchatBubble(item: allItems[i]),
                ),
        ),
      ]),
    );
  }
}

/// チャット閲覧用データクラス
class _TchatItem {
  final bool isAdmin;
  final String name;
  final String text;
  final List<int>? imageBytes;
  final String? imageUrl;
  final DateTime time;
  _TchatItem({required this.isAdmin, required this.name, required this.text,
      this.imageBytes, this.imageUrl, required this.time});
}

/// チャット閲覧バブル（読み取り専用）
class _TchatBubble extends StatelessWidget {
  final _TchatItem item;
  const _TchatBubble({required this.item});

  String _fmt(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 1) return 'たった今';
    if (d.inMinutes < 60) return '${d.inMinutes}分前';
    if (d.inHours < 24) return '${d.inHours}時間前';
    return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2,'0')}:${dt.minute.toString().padLeft(2,'0')}';
  }

  @override
  Widget build(BuildContext context) {
    final hasImage = item.imageBytes != null || item.imageUrl != null;
    final showText = item.text != '📷 画像を送信しました' || !hasImage;

    if (item.isAdmin) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text(_fmt(item.time), style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
            const SizedBox(width: 6),
            const Text('管理者', style: TextStyle(color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w600)),
            const SizedBox(width: 4),
            const Icon(Icons.admin_panel_settings, color: AppColors.yellow, size: 12),
          ]),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            const SizedBox(width: 60),
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFB8860B), Color(0xFF8B6914)],
                    begin: Alignment.topLeft, end: Alignment.bottomRight,
                  ),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(14), topRight: Radius.circular(4),
                    bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                  ),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  if (item.imageBytes != null) ...[
                    ClipRRect(borderRadius: BorderRadius.circular(8),
                      child: Image.memory(Uint8List.fromList(item.imageBytes!), width: 200, fit: BoxFit.cover)),
                    if (showText) const SizedBox(height: 6),
                  ] else if (item.imageUrl != null) ...[
                    ClipRRect(borderRadius: BorderRadius.circular(8),
                      child: Image.network(item.imageUrl!, width: 200, fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(width: 200, height: 60,
                          color: AppColors.navyCard,
                          child: const Center(child: Icon(Icons.broken_image, color: AppColors.silverDim))))),
                    if (showText) const SizedBox(height: 6),
                  ],
                  if (showText)
                    Text(item.text, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.5)),
                ]),
              ),
            ),
          ]),
        ]),
      );
    } else {
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.school, color: AppColors.yellow, size: 12),
            const SizedBox(width: 4),
            Text(item.name, style: const TextStyle(color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w600)),
            const SizedBox(width: 6),
            Text(_fmt(item.time), style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ]),
          const SizedBox(height: 4),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.navyCard,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(4), topRight: Radius.circular(14),
                    bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                  ),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                child: Text(item.text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
              ),
            ),
            const SizedBox(width: 60),
          ]),
        ]),
      );
    }
  }
}

// 生徒からの連絡リスト（既存ロジックを分離）
class _TeacherMessagesListView extends StatelessWidget {
  final AppProvider provider;
  const _TeacherMessagesListView({required this.provider});

  @override
  Widget build(BuildContext context) {
    final messages = provider.messages;

    if (messages.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inbox_outlined, color: AppColors.silverDim, size: 56),
            SizedBox(height: 16),
            Text('メッセージはありません',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: messages.length,
      itemBuilder: (context, i) {
        final msg = messages[i];
        return _TeacherMessageCard(msg: msg, provider: provider);
      },
    );
  }
}

// ── お知らせ履歴タブ（講師用）──
class _TeacherAnnouncementHistoryTab extends StatelessWidget {
  final dynamic teacher; // AppUser
  final AppProvider provider;
  const _TeacherAnnouncementHistoryTab({
    required this.teacher,
    required this.provider,
  });

  @override
  Widget build(BuildContext context) {
    if (teacher == null) {
      return const Center(
        child: Text('ユーザー情報がありません',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    final announcements =
        provider.getAnnouncementsForUser(teacher.id, 'teacher');

    if (announcements.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.campaign_outlined, color: AppColors.silverDim, size: 56),
            SizedBox(height: 16),
            Text('お知らせはまだありません',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: announcements.length,
      itemBuilder: (context, i) {
        final a = announcements[i];
        return _TeacherAnnouncementCard(
          announcement: a,
          teacherId: teacher.id,
          provider: provider,
        );
      },
    );
  }
}

// ── 講師用お知らせカード ──
class _TeacherAnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  final String teacherId;
  final AppProvider provider;
  const _TeacherAnnouncementCard({
    required this.announcement,
    required this.teacherId,
    required this.provider,
  });

  void _showImageDialogBytes(BuildContext context, Uint8List bytes) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black87,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            InteractiveViewer(child: Image.memory(bytes, fit: BoxFit.contain)),
            Positioned(
              top: 8,
              right: 8,
              child: GestureDetector(
                onTap: () => Navigator.of(ctx).pop(),
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.black54,
                    shape: BoxShape.circle,
                  ),
                  padding: const EdgeInsets.all(6),
                  child: const Icon(Icons.close, color: Colors.white, size: 20),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showImageDialogUrl(BuildContext context, String url) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black87,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            InteractiveViewer(
              child: Image.network(
                url,
                fit: BoxFit.contain,
                loadingBuilder: (_, child, prog) => prog == null
                    ? child
                    : const Center(child: CircularProgressIndicator()),
                errorBuilder: (_, __, ___) => const Center(
                  child: Icon(Icons.broken_image, color: Colors.white54, size: 64),
                ),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: GestureDetector(
                onTap: () => Navigator.of(ctx).pop(),
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.black54,
                    shape: BoxShape.circle,
                  ),
                  padding: const EdgeInsets.all(6),
                  child: const Icon(Icons.close, color: Colors.white, size: 20),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isRead = announcement.isReadBy(teacherId);

    return GlowCard(
      margin: const EdgeInsets.only(bottom: 10),
      glowColor: isRead ? AppColors.silverDim : AppColors.yellow,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── ヘッダー行 ──
          Row(
            children: [
              Icon(
                isRead ? Icons.check_circle : Icons.campaign_rounded,
                color: isRead ? AppColors.success : AppColors.yellow,
                size: 16,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  announcement.title,
                  style: TextStyle(
                    color: isRead ? AppColors.textSecondary : AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (!isRead)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.yellow,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'NEW',
                    style: TextStyle(
                      color: AppColors.navyDark,
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                )
              else
                const Icon(Icons.check, color: AppColors.success, size: 14),
            ],
          ),
          const SizedBox(height: 8),
          // ── 本文 ──
          Text(
            announcement.body,
            style: TextStyle(
              color: isRead ? AppColors.silverDim : AppColors.textSecondary,
              fontSize: 13,
              height: 1.5,
            ),
          ),
          // ── 画像（あれば）──
          if (announcement.imageBytes != null) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: () => _showImageDialogBytes(
                  context, Uint8List.fromList(announcement.imageBytes!)),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.memory(
                  Uint8List.fromList(announcement.imageBytes!),
                  height: 160,
                  width: double.infinity,
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'タップして拡大',
              style: TextStyle(color: AppColors.silverDim, fontSize: 10),
            ),
          ] else if (announcement.imageUrl != null &&
              announcement.imageUrl!.isNotEmpty) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: () => _showImageDialogUrl(context, announcement.imageUrl!),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.network(
                  announcement.imageUrl!,
                  height: 160,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  loadingBuilder: (_, child, prog) => prog == null
                      ? child
                      : Container(
                          height: 160,
                          color: AppColors.navyCard,
                          child: const Center(
                            child: CircularProgressIndicator(
                              color: AppColors.yellow,
                              strokeWidth: 2,
                            ),
                          ),
                        ),
                  errorBuilder: (_, __, ___) => Container(
                    height: 80,
                    color: AppColors.navyCard,
                    child: const Center(
                      child: Icon(Icons.broken_image,
                          color: AppColors.silverDim, size: 32),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'タップして拡大',
              style: TextStyle(color: AppColors.silverDim, fontSize: 10),
            ),
          ],
          const SizedBox(height: 8),
          // ── フッター行 ──
          Row(
            children: [
              Text(
                '${announcement.createdAt.month}/${announcement.createdAt.day} '
                '${announcement.createdAt.hour.toString().padLeft(2, '0')}:'
                '${announcement.createdAt.minute.toString().padLeft(2, '0')}',
                style: const TextStyle(color: AppColors.silverDim, fontSize: 10),
              ),
              const Spacer(),
              if (!isRead)
                TextButton.icon(
                  onPressed: () =>
                      provider.markAnnouncementRead(announcement.id, teacherId),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  icon: const Icon(Icons.check_circle_outline,
                      size: 14, color: AppColors.yellow),
                  label: const Text('既読にする',
                      style: TextStyle(color: AppColors.yellow, fontSize: 11)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TeacherMessageCard extends StatelessWidget {
  final StudentMessage msg;
  final AppProvider provider;
  const _TeacherMessageCard({required this.msg, required this.provider});

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.navyLight,
                child: Text(
                  msg.fromName.characters.first,
                  style: const TextStyle(
                    color: AppColors.yellow,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      msg.fromName,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      _formatDate(msg.createdAt),
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              if (!msg.isRead)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.danger,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text(
                    '未読',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          if (msg.text != null && msg.text!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.navyDark,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.cardBorder),
              ),
              child: Text(
                msg.text!,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
          ],
          if (msg.imageUrl != null && msg.imageUrl!.isNotEmpty) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Container(
                height: 160,
                width: double.infinity,
                color: AppColors.navyCard,
                child: const Center(
                  child: Icon(Icons.image_outlined,
                      color: AppColors.silverDim, size: 48),
                ),
              ),
            ),
          ],
          const SizedBox(height: 8),
          // 既読ボタン
          if (!msg.isRead)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => provider.markMessageRead(msg.id),
                icon: const Icon(Icons.check_circle_outline,
                    size: 14, color: AppColors.info),
                label: const Text(
                  '既読にする',
                  style: TextStyle(color: AppColors.info, fontSize: 11),
                ),
              ),
            ),
        ],
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 60) return '${diff.inMinutes}分前';
    if (diff.inHours < 24) return '${diff.inHours}時間前';
    if (diff.inDays < 7) return '${diff.inDays}日前';
    return '${dt.month}/${dt.day}';
  }
}
