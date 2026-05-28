import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import 'package:confetti/confetti.dart';
import '../../theme/app_theme.dart';
import '../../models/app_models.dart';
import '../../providers/app_provider.dart';
import '../../widgets/common_widgets.dart';
import 'progress_tab.dart';
import 'grades_tab.dart';
import 'message_tab.dart';
import '../auth/login_screen.dart';

class StudentHome extends StatefulWidget {
  const StudentHome({super.key});

  @override
  State<StudentHome> createState() => _StudentHomeState();
}

class _StudentHomeState extends State<StudentHome> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final user = provider.currentUser;
    final userId = user?.id ?? '';
    final unreadNotifCount = provider.getProgressNotificationsForStudent(userId).length;
    final unreadAnnounceCount = provider.getUnreadAnnouncementCount(userId, 'student');
    final totalBadge = unreadNotifCount + unreadAnnounceCount;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.yellow.withValues(alpha: 0.15),
                border: Border.all(color: AppColors.yellow, width: 1.5),
              ),
              child: const Center(child: Text('M', style: TextStyle(color: AppColors.yellow, fontSize: 14, fontWeight: FontWeight.w900))),
            ),
            const SizedBox(width: 8),
            const Text('三浦塾'),
          ],
        ),
        actions: [
          if (user != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(child: Text(user.name, style: const TextStyle(color: AppColors.silver, fontSize: 12))),
            ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.silverDim, size: 20),
            onPressed: () {
              context.read<AppProvider>().logout();
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
          ),
        ],
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: const [
          _StudentMainScreen(),
          GradesTab(),
          ProgressTab(),
          MessageTab(),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(totalBadge),
    );
  }

  Widget _buildBottomNav(int homeBadge) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.navyDark,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 20, offset: const Offset(0, -5))],
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _navItemWithBadge(0, Icons.home_rounded, 'ホーム', homeBadge),
              _navItem(1, Icons.bar_chart_rounded, '成績'),
              _navItem(2, Icons.checklist_rounded, '進捗'),
              _navItem(3, Icons.send_rounded, '連絡'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.yellow.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: selected ? AppColors.yellow : AppColors.silverDim, size: 24),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(
              color: selected ? AppColors.yellow : AppColors.silverDim,
              fontSize: 10,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
            )),
          ],
        ),
      ),
    );
  }

  Widget _navItemWithBadge(int index, IconData icon, String label, int badge) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.yellow.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(clipBehavior: Clip.none, children: [
              Icon(icon, color: selected ? AppColors.yellow : AppColors.silverDim, size: 24),
              if (badge > 0)
                Positioned(
                  top: -4, right: -6,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: const BoxDecoration(color: AppColors.danger, shape: BoxShape.circle),
                    child: Text('$badge', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w800)),
                  ),
                ),
            ]),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(
              color: selected ? AppColors.yellow : AppColors.silverDim,
              fontSize: 10,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
            )),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// MAIN SCREEN: Calendar top → Progress → Grades summary
// ============================================================
class _StudentMainScreen extends StatefulWidget {
  const _StudentMainScreen();

  @override
  State<_StudentMainScreen> createState() => _StudentMainScreenState();
}

class _StudentMainScreenState extends State<_StudentMainScreen> {
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
    final userId = provider.currentUser?.id ?? '';
    final lessonDates = provider.getLessonDatesForStudent(userId);
    final streak = provider.getStreak(userId);
    final selectedLessons = _selectedDay != null
        ? provider.getLessonsOnDate(userId, _selectedDay!)
        : <Lesson>[];

    final progressNotifs = provider.getProgressNotificationsForStudent(userId);
    final announcements = provider.getAnnouncementsForUser(userId, 'student');
    final unreadAnnouncements = announcements.where((a) => !a.isReadBy(userId)).toList();

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Greeting ──
          _buildGreeting(provider, userId, streak),

          // ── 進捗完了通知バナー ──
          if (progressNotifs.isNotEmpty)
            _StudentProgressNotifBanner(notifications: progressNotifs, userId: userId),

          // ── お知らせバナー ──
          if (unreadAnnouncements.isNotEmpty)
            _AnnouncementBanner(announcements: unreadAnnouncements, userId: userId, role: 'student'),

          // ── 1. Calendar (TOP) ──
          const SectionHeader(title: '授業カレンダー', subtitle: '授業日をタップ'),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              gradient: AppGradients.cardGradient,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: TableCalendar(
              firstDay: DateTime.utc(2025, 1, 1),
              lastDay: DateTime.utc(2026, 12, 31),
              focusedDay: _focusedDay,
              selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
              calendarFormat: CalendarFormat.month,
              eventLoader: (day) {
                final d = DateTime(day.year, day.month, day.day);
                return lessonDates.contains(d) ? ['lesson'] : [];
              },
              onDaySelected: (selected, focused) =>
                  setState(() { _selectedDay = selected; _focusedDay = focused; }),
              onPageChanged: (focused) => setState(() => _focusedDay = focused),
              calendarStyle: CalendarStyle(
                defaultTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                weekendTextStyle: const TextStyle(color: AppColors.silver, fontSize: 13),
                outsideDaysVisible: false,
                selectedDecoration: BoxDecoration(
                  color: AppColors.yellow, shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.5), blurRadius: 8)],
                ),
                selectedTextStyle: const TextStyle(color: AppColors.navyDark, fontWeight: FontWeight.w800, fontSize: 13),
                todayDecoration: BoxDecoration(
                  color: AppColors.yellow.withValues(alpha: 0.2), shape: BoxShape.circle,
                  border: Border.all(color: AppColors.yellow, width: 1.5),
                ),
                todayTextStyle: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 13),
                markerDecoration: const BoxDecoration(color: AppColors.yellow, shape: BoxShape.circle),
                markerSize: 5,
                markerMargin: const EdgeInsets.symmetric(horizontal: 1),
              ),
              headerStyle: HeaderStyle(
                formatButtonVisible: false,
                titleCentered: true,
                titleTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700),
                leftChevronIcon: const Icon(Icons.chevron_left, color: AppColors.silver),
                rightChevronIcon: const Icon(Icons.chevron_right, color: AppColors.silver),
                headerPadding: const EdgeInsets.symmetric(vertical: 10),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.cardBorder)),
                ),
              ),
              daysOfWeekStyle: const DaysOfWeekStyle(
                weekdayStyle: TextStyle(color: AppColors.textSecondary, fontSize: 11),
                weekendStyle: TextStyle(color: AppColors.silverDim, fontSize: 11),
              ),
            ),
          ),

          // ── Selected day lessons ──
          if (_selectedDay != null) ...[
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const Icon(Icons.event, color: AppColors.yellow, size: 14),
                  const SizedBox(width: 6),
                  Text(
                    DateFormat('M月d日（E）', 'ja').format(_selectedDay!),
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            if (selectedLessons.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('授業の予定はありません',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              )
            else
              ...selectedLessons.map((l) => _LessonCard(lesson: l)),
          ],

          const SizedBox(height: 20),

          // ── 2. Progress ──
          _buildProgressCard(provider, userId),

          const SizedBox(height: 16),

          // ── 3. Grades ──
          _buildGradesCard(provider, userId),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildGreeting(AppProvider provider, String userId, StudyStreak? streak) {
    final user = provider.currentUser;
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.navyMedium, AppColors.navyLight],
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$greeting、${user?.name ?? ''}さん',
                    style: const TextStyle(color: AppColors.silver, fontSize: 13)),
                const SizedBox(height: 2),
                const Text('今日も頑張ろう！',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w800)),
              ],
            ),
          ),
          if (streak != null && streak.currentStreak > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.yellow.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
              ),
              child: Column(
                children: [
                  const Text('🔥', style: TextStyle(fontSize: 18)),
                  Text('${streak.currentStreak}日', style: const TextStyle(
                    color: AppColors.yellow, fontSize: 14, fontWeight: FontWeight.w800)),
                  const Text('連続', style: TextStyle(color: AppColors.textSecondary, fontSize: 9)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProgressCard(AppProvider provider, String userId) {
    final rate = provider.getProgressRate(userId);
    final cats = provider.progressCategories;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GlowCard(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.checklist_rounded, color: AppColors.info, size: 18),
                const SizedBox(width: 8),
                const Text('授業進捗度', style: TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
                const Spacer(),
                Text('${(rate * 100).toInt()}%',
                    style: const TextStyle(color: AppColors.yellow, fontSize: 20, fontWeight: FontWeight.w800)),
              ],
            ),
            const SizedBox(height: 10),
            AnimatedProgressBar(value: rate, color: AppColors.yellow, height: 8),
            const SizedBox(height: 12),
            ...cats.take(2).map((cat) {
              final total = cat.items.length;
              final done = cat.items.where((i) => provider.isItemCompleted(userId, i.id)).length;
              final catRate = total > 0 ? done / total : 0.0;
              final color = cat.subject == '数学' ? AppColors.info : AppColors.success;
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: AnimatedProgressBar(value: catRate, color: color, height: 5,
                    label: '${cat.subject}（$done/$total）'),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildGradesCard(AppProvider provider, String userId) {
    final scores = provider.getScoresForStudent(userId);
    ExamScore? latest;
    if (scores.isNotEmpty) {
      latest = scores.reduce((a, b) {
        final order = examTypes;
        return order.indexOf(a.examType) > order.indexOf(b.examType) ? a : b;
      });
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GlowCard(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.bar_chart_rounded, color: AppColors.success, size: 18),
                SizedBox(width: 8),
                Text('成績管理', style: TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 12),
            if (latest == null)
              const Text('成績データなし', style: TextStyle(color: AppColors.textSecondary))
            else ...[
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(latest.examType, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                        Text('${latest.totalScore}点',
                            style: const TextStyle(color: AppColors.yellow, fontSize: 26, fontWeight: FontWeight.w800)),
                        Text('平均 ${latest.average.toStringAsFixed(1)}点',
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      ],
                    ),
                  ),
                  _buildSubjectMini(latest, provider, userId),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSubjectMini(ExamScore score, AppProvider provider, String userId) {
    final diffs = provider.getSubjectDiffs(userId, score.examType);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: score.scores.entries.take(5).map((e) {
        final val = e.value;
        final isHigh = val != null && val >= 90;
        final diff = diffs[e.key];
        return Padding(
          padding: const EdgeInsets.only(bottom: 3),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(e.key, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
              const SizedBox(width: 4),
              Text(val?.toString() ?? '-', style: TextStyle(
                color: isHigh ? AppColors.yellow : AppColors.textPrimary,
                fontSize: 13, fontWeight: FontWeight.w700,
              )),
              if (diff != null) ...[
                const SizedBox(width: 2),
                Text('${diff >= 0 ? '+' : ''}$diff',
                    style: TextStyle(
                      color: diff > 0 ? AppColors.success : diff < 0 ? AppColors.danger : AppColors.silverDim,
                      fontSize: 9, fontWeight: FontWeight.w700,
                    )),
              ],
            ],
          ),
        );
      }).toList(),
    );
  }
}

// ============================================================
// 進捗完了通知バナー（生徒用）
// ============================================================
class _StudentProgressNotifBanner extends StatefulWidget {
  final List<ProgressCompletionNotification> notifications;
  final String userId;
  const _StudentProgressNotifBanner({required this.notifications, required this.userId});

  @override
  State<_StudentProgressNotifBanner> createState() => _StudentProgressNotifBannerState();
}

class _StudentProgressNotifBannerState extends State<_StudentProgressNotifBanner> {
  late final ConfettiController _confettiCtrl;

  @override
  void initState() {
    super.initState();
    _confettiCtrl = ConfettiController(duration: const Duration(seconds: 3));
  }

  @override
  void dispose() {
    _confettiCtrl.dispose();
    super.dispose();
  }

  void _markRead(BuildContext context, ProgressCompletionNotification notif) {
    context.read<AppProvider>().markProgressNotificationReadByStudent(notif.id);
    _confettiCtrl.play();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.topCenter,
      children: [
        // 紙吹雪
        ConfettiWidget(
          confettiController: _confettiCtrl,
          blastDirectionality: BlastDirectionality.explosive,
          numberOfParticles: 40,
          maxBlastForce: 30,
          minBlastForce: 10,
          emissionFrequency: 0.08,
          colors: const [
            AppColors.yellow, AppColors.success, AppColors.info,
            Colors.pink, Colors.orange, Colors.purple,
          ],
        ),

        // 通知リスト
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  const Icon(Icons.notifications_active, color: AppColors.yellow, size: 16),
                  const SizedBox(width: 6),
                  Text('新しい通知 (${widget.notifications.length})',
                      style: const TextStyle(color: AppColors.yellow, fontSize: 13, fontWeight: FontWeight.w700)),
                ]),
              ),
              ...widget.notifications.map((n) => _buildNotifCard(context, n)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildNotifCard(BuildContext context, ProgressCompletionNotification notif) {
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 8),
      glowColor: AppColors.success,
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: const Center(child: Text('✅', style: TextStyle(fontSize: 20))),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${notif.subject}のタスク完了！',
                    style: const TextStyle(color: AppColors.success, fontSize: 12, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(notif.itemTitle,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () => _markRead(context, notif),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.success,
              foregroundColor: Colors.white,
              minimumSize: const Size(60, 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('既読', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

// ============================================================
// お知らせバナー（生徒・保護者・講師共用）
// ============================================================
class _AnnouncementBanner extends StatelessWidget {
  final List<Announcement> announcements;
  final String userId;
  final String role;
  const _AnnouncementBanner({
    required this.announcements,
    required this.userId,
    required this.role,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              const Icon(Icons.campaign_rounded, color: AppColors.info, size: 16),
              const SizedBox(width: 6),
              Text('お知らせ (${announcements.length})',
                  style: const TextStyle(color: AppColors.info, fontSize: 13, fontWeight: FontWeight.w700)),
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
      glowColor: AppColors.info,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.campaign_rounded, color: AppColors.info, size: 16),
            const SizedBox(width: 8),
            Expanded(child: Text(a.title,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700))),
            TextButton(
              onPressed: () => provider.markAnnouncementRead(a.id, userId),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('既読', style: TextStyle(color: AppColors.info, fontSize: 11)),
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

// ---- Lesson Card with absence form ----
class _LessonCard extends StatefulWidget {
  final Lesson lesson;
  const _LessonCard({required this.lesson});

  @override
  State<_LessonCard> createState() => _LessonCardState();
}

class _LessonCardState extends State<_LessonCard> {
  bool _showAbsentForm = false;
  final _reasonController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final lesson = widget.lesson;

    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: lesson.isAbsent ? AppColors.danger : AppColors.yellow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.yellow.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
                ),
                child: Text(lesson.subject,
                    style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 13)),
              ),
              const SizedBox(width: 8),
              Text('${lesson.startTime} 〜 ${lesson.endTime}',
                  style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 13)),
              const Spacer(),
              if (lesson.isAbsent)
                const AppChip(label: '欠席', color: AppColors.danger),
            ],
          ),
          if (lesson.memo != null && lesson.memo!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('📝 ${lesson.memo}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ],
          if (lesson.isAbsent && lesson.absentReason != null) ...[
            const SizedBox(height: 6),
            Text('理由: ${lesson.absentReason}',
                style: const TextStyle(color: AppColors.danger, fontSize: 12)),
          ],
          if (!lesson.isAbsent) ...[
            const SizedBox(height: 10),
            if (_showAbsentForm) ...[
              TextField(
                controller: _reasonController,
                decoration: const InputDecoration(labelText: '欠席理由', hintText: '例：体調不良のため', isDense: true),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        final provider = context.read<AppProvider>();
                        final user = provider.currentUser!;
                        provider.sendAbsenceNotification(AbsenceNotification(
                          id: 'abs_${DateTime.now().millisecondsSinceEpoch}',
                          studentId: user.id,
                          studentName: user.name,
                          lessonId: lesson.id,
                          subject: lesson.subject,
                          lessonDate: lesson.date,
                          reason: _reasonController.text.isNotEmpty ? _reasonController.text : '欠席',
                          sender: 'student',
                          senderName: user.name,
                          sentAt: DateTime.now(),
                        ));
                        setState(() => _showAbsentForm = false);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: const Text('欠席連絡を送信しました'),
                              backgroundColor: AppColors.info,
                              behavior: SnackBarBehavior.floating,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.danger, foregroundColor: Colors.white,
                        minimumSize: const Size(0, 40),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: const Text('欠席を送信'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() => _showAbsentForm = false),
                    child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim)),
                  ),
                ],
              ),
            ] else
              OutlinedButton.icon(
                onPressed: () => setState(() => _showAbsentForm = true),
                icon: const Icon(Icons.warning_amber_rounded, size: 15),
                label: const Text('欠席連絡'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.warning,
                  side: const BorderSide(color: AppColors.warning),
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
