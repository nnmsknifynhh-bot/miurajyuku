import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:provider/provider.dart';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import 'package:confetti/confetti.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';
import '../auth/login_screen.dart';

class ParentHome extends StatefulWidget {
  const ParentHome({super.key});

  @override
  State<ParentHome> createState() => _ParentHomeState();
}

class _ParentHomeState extends State<ParentHome> {
  int _currentIndex = 0;
  // 現在選択中の子ID（null = 最初の子を自動選択）
  String? _selectedStudentId;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final parentUser = provider.currentUser;
    final studentIds = parentUser?.studentIds ?? [];

    // 有効な studentId を決定
    final String studentId;
    if (_selectedStudentId != null && studentIds.contains(_selectedStudentId)) {
      studentId = _selectedStudentId!;
    } else if (studentIds.isNotEmpty) {
      studentId = studentIds.first;
    } else {
      studentId = 's1'; // フォールバック
    }

    // 選択中の生徒情報
    final selectedStudent = provider.getStudentById(studentId);

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.info.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.info.withValues(alpha: 0.4)),
              ),
              child: const Text('保護者', style: TextStyle(color: AppColors.info, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(width: 8),
            const Text('三浦塾'),
          ],
        ),
        actions: [
          // 複数の子がいる場合は切り替えボタンを表示
          if (studentIds.length > 1)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: _ChildSwitchButton(
                studentIds: studentIds,
                selectedId: studentId,
                onChanged: (id) => setState(() => _selectedStudentId = id),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.silverDim),
            onPressed: () {
              provider.logout();
              Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
            },
          ),
        ],
      ),
      body: studentIds.isEmpty
          ? _buildNoStudentView()
          : IndexedStack(
              index: _currentIndex,
              children: [
                _ParentMainTab(studentId: studentId),
                _ParentGradesTab(studentId: studentId),
                _ParentContactTab(studentId: studentId),
              ],
            ),
      bottomNavigationBar: studentIds.isEmpty
          ? null
          : _buildNav(provider, studentId, selectedStudent),
    );
  }

  // 子ども紐付けなしのフォールバック画面
  Widget _buildNoStudentView() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.person_off_outlined, color: AppColors.silverDim, size: 64),
          SizedBox(height: 16),
          Text('子どもが紐付けられていません',
              style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
          SizedBox(height: 8),
          Text('管理者にお問い合わせください',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildNav(AppProvider provider, String studentId, AppUser? selectedStudent) {
    final unreadParent = provider.getParentMessagesForStudent(studentId).where((m) => !m.isRead).length;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.navyDark,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _navItem(0, Icons.home_rounded, 'ホーム'),
              _navItem(1, Icons.bar_chart_rounded, '成績'),
              _navItemWithBadge(2, Icons.message_rounded, '連絡', unreadParent),
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
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.info.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: selected ? AppColors.info : AppColors.silverDim, size: 24),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(
              color: selected ? AppColors.info : AppColors.silverDim,
              fontSize: 10, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
            )),
          ],
        ),
      ),
    );
  }

  Widget _navItemWithBadge(int index, IconData icon, String label, int badgeCount) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.info.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Icon(icon, color: selected ? AppColors.info : AppColors.silverDim, size: 24),
                if (badgeCount > 0)
                  Positioned(
                    top: -4,
                    right: -6,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: const BoxDecoration(color: AppColors.danger, shape: BoxShape.circle),
                      child: Text('$badgeCount', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w800)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(
              color: selected ? AppColors.info : AppColors.silverDim,
              fontSize: 10, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
            )),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// 子ども切り替えボタン（AppBar action 用）
// ============================================================
class _ChildSwitchButton extends StatelessWidget {
  final List<String> studentIds;
  final String selectedId;
  final ValueChanged<String> onChanged;
  const _ChildSwitchButton({
    required this.studentIds,
    required this.selectedId,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    final selectedStudent = provider.getStudentById(selectedId);

    return GestureDetector(
      onTap: () => _showSwitchDialog(context, provider),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.info.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.info.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.swap_horiz, color: AppColors.info, size: 14),
            const SizedBox(width: 4),
            Text(
              selectedStudent?.name.split(' ').last ?? '---',
              style: const TextStyle(
                  color: AppColors.info, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }

  void _showSwitchDialog(BuildContext context, AppProvider provider) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(children: [
          Icon(Icons.people_alt_outlined, color: AppColors.info, size: 18),
          SizedBox(width: 8),
          Text('お子様を切り替え',
              style: TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 15)),
        ]),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: studentIds.map((id) {
            final student = provider.getStudentById(id);
            final isSelected = id == selectedId;
            return GestureDetector(
              onTap: () {
                onChanged(id);
                Navigator.of(context).pop();
              },
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppColors.info.withValues(alpha: 0.12)
                      : AppColors.navyDark,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isSelected ? AppColors.info : AppColors.cardBorder,
                    width: isSelected ? 1.5 : 1,
                  ),
                ),
                child: Row(children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: isSelected
                        ? AppColors.info.withValues(alpha: 0.2)
                        : AppColors.navyLight,
                    child: Text(
                      student?.name.characters.first ?? '?',
                      style: TextStyle(
                        color: isSelected ? AppColors.info : AppColors.textSecondary,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                        student?.name ?? 'Unknown',
                        style: TextStyle(
                          color: isSelected
                              ? AppColors.textPrimary
                              : AppColors.textSecondary,
                          fontSize: 14,
                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                      Text(
                        '中${student?.grade ?? '-'}年  ${student?.className ?? ''}',
                        style: const TextStyle(
                            color: AppColors.textSecondary, fontSize: 11),
                      ),
                    ]),
                  ),
                  if (isSelected)
                    const Icon(Icons.check_circle, color: AppColors.info, size: 18),
                ]),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}

// ============================================================
// Main Tab: Calendar top → Progress → Score summary
// ============================================================
class _ParentMainTab extends StatefulWidget {
  final String studentId;
  const _ParentMainTab({required this.studentId});

  @override
  State<_ParentMainTab> createState() => _ParentMainTabState();
}

class _ParentMainTabState extends State<_ParentMainTab> {
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
    final parentUser = context.read<AppProvider>().currentUser;
    final parentId = parentUser?.id ?? '';
    final student = provider.getStudentById(widget.studentId);
    final lessonDates = provider.getLessonDatesForStudent(widget.studentId);
    final selectedLessons = _selectedDay != null
        ? provider.getLessonsOnDate(widget.studentId, _selectedDay!)
        : <Lesson>[];
    final rate = provider.getProgressRate(widget.studentId);
    final streak = provider.getStreak(widget.studentId);
    final progressNotifs = provider.getProgressNotificationsForParent(widget.studentId);
    final announcements = provider.getAnnouncementsForUser(parentId, 'parent');
    final unreadAnnouncements = announcements.where((a) => !a.isReadBy(parentId)).toList();

    return SingleChildScrollView(
      child: Column(
        children: [
          // ── Student header ──
          Container(
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
                CircleAvatar(
                  radius: 26,
                  backgroundColor: AppColors.info.withValues(alpha: 0.15),
                  child: Text(
                    student?.name.isNotEmpty == true ? student!.name[0] : '?',
                    style: const TextStyle(color: AppColors.info, fontSize: 22, fontWeight: FontWeight.w900),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(student?.name ?? '---',
                          style: const TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w800)),
                      if (student?.grade != null)
                        Text('中学${student!.grade}年生',
                            style: const TextStyle(color: AppColors.silver, fontSize: 13)),
                    ],
                  ),
                ),
                if (streak != null && streak.currentStreak > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.yellow.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
                    ),
                    child: Column(
                      children: [
                        const Text('🔥', style: TextStyle(fontSize: 16)),
                        Text('${streak.currentStreak}日', style: const TextStyle(
                          color: AppColors.yellow, fontSize: 13, fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
              ],
            ),
          ),

          // ── 進捗完了通知バナー（保護者用）──
          if (progressNotifs.isNotEmpty)
            _ParentProgressNotifBanner(
              notifications: progressNotifs,
              studentId: widget.studentId,
            ),

          // ── お知らせバナー ──
          if (unreadAnnouncements.isNotEmpty)
            _ParentAnnouncementBanner(
              announcements: unreadAnnouncements,
              userId: parentId,
            ),

          // ── 1. Calendar (TOP) ──
          const SectionHeader(title: '授業カレンダー', subtitle: '授業日をタップして欠席連絡'),
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
                  color: AppColors.info, shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: AppColors.info.withValues(alpha: 0.4), blurRadius: 8)],
                ),
                selectedTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13),
                todayDecoration: BoxDecoration(
                  color: AppColors.info.withValues(alpha: 0.2), shape: BoxShape.circle,
                  border: Border.all(color: AppColors.info, width: 1.5),
                ),
                todayTextStyle: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w700, fontSize: 13),
                markerDecoration: const BoxDecoration(color: AppColors.yellow, shape: BoxShape.circle),
                markerSize: 5,
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

          // ── Selected day detail ──
          if (_selectedDay != null) ...[
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const Icon(Icons.event, color: AppColors.info, size: 14),
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
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text('授業の予定はありません',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              )
            else
              ...selectedLessons.map((l) => _ParentLessonCard(lesson: l, studentId: widget.studentId)),
          ],

          const SizedBox(height: 20),

          // ── 2. Progress ──
          _buildProgressCard(provider, rate),

          const SizedBox(height: 16),

          // ── 3. Score ──
          _buildScoreCard(provider),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildProgressCard(AppProvider provider, double rate) {
    final cats = provider.progressCategories;
    Color rateColor = rate >= 0.8 ? AppColors.success : rate >= 0.5 ? AppColors.yellow : AppColors.warning;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GlowCard(
        glowColor: rateColor,
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.checklist_rounded, color: AppColors.yellow, size: 18),
                const SizedBox(width: 8),
                const Text('学習進捗', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 15)),
                const Spacer(),
                Text('${(rate * 100).toInt()}%', style: TextStyle(
                  color: rateColor, fontSize: 22, fontWeight: FontWeight.w900)),
              ],
            ),
            const SizedBox(height: 10),
            AnimatedProgressBar(value: rate, color: rateColor, height: 10),
            const SizedBox(height: 12),
            ...cats.map((cat) {
              final total = cat.items.length;
              final done = cat.items.where((i) => provider.isItemCompleted(widget.studentId, i.id)).length;
              final catRate = total > 0 ? done / total : 0.0;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AnimatedProgressBar(
                  value: catRate,
                  color: cat.subject == '数学' ? AppColors.info : AppColors.success,
                  height: 6,
                  label: '${cat.subject}　$done/$total 完了',
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildScoreCard(AppProvider provider) {
    final scores = provider.getScoresForStudent(widget.studentId);
    if (scores.isEmpty) return const SizedBox.shrink();
    final sorted = [...scores]..sort((a, b) =>
        examTypes.indexOf(a.examType).compareTo(examTypes.indexOf(b.examType)));
    final latest = sorted.last;
    final prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
    final diffs = provider.getSubjectDiffs(widget.studentId, latest.examType);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GlowCard(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.bar_chart, color: AppColors.success, size: 18),
                const SizedBox(width: 8),
                const Text('最新成績', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 15)),
                const Spacer(),
                AppChip(label: latest.examType, color: AppColors.info),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${latest.totalScore}点', style: const TextStyle(
                  color: AppColors.yellow, fontSize: 38, fontWeight: FontWeight.w900)),
                if (prev != null) ...[
                  const Spacer(),
                  _buildDiff(latest.totalScore - prev.totalScore),
                ],
              ],
            ),
            const SizedBox(height: 12),
            ...latest.scores.entries.take(5).map((e) {
              final val = e.value;
              final diff = diffs[e.key];
              final isHigh = val != null && val >= 90;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    SizedBox(width: 72, child: Text(e.key,
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
                    Expanded(
                      child: LinearProgressIndicator(
                        value: val != null ? val / 100 : 0,
                        backgroundColor: AppColors.navyCard,
                        color: isHigh ? AppColors.yellow : AppColors.silver,
                        minHeight: 6,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 32,
                      child: Text(val?.toString() ?? '-', style: TextStyle(
                        color: isHigh ? AppColors.yellow : AppColors.textPrimary,
                        fontWeight: FontWeight.w700, fontSize: 13,
                      ), textAlign: TextAlign.right),
                    ),
                    const SizedBox(width: 4),
                    SizedBox(
                      width: 34,
                      child: diff != null
                          ? Text('${diff >= 0 ? '+' : ''}$diff',
                              style: TextStyle(
                                color: diff > 0 ? AppColors.success : diff < 0 ? AppColors.danger : AppColors.silverDim,
                                fontSize: 10, fontWeight: FontWeight.w700,
                              ))
                          : const SizedBox.shrink(),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildDiff(int diff) {
    final isUp = diff >= 0;
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: (isUp ? AppColors.success : AppColors.danger).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Icon(isUp ? Icons.arrow_upward : Icons.arrow_downward,
              color: isUp ? AppColors.success : AppColors.danger, size: 14),
          Text('${isUp ? '+' : ''}$diff', style: TextStyle(
            color: isUp ? AppColors.success : AppColors.danger,
            fontWeight: FontWeight.w800, fontSize: 14)),
          const Text('前回比', style: TextStyle(color: AppColors.textSecondary, fontSize: 9)),
        ],
      ),
    );
  }
}

// ============================================================
// 進捗完了通知バナー（保護者用）
// ============================================================
class _ParentProgressNotifBanner extends StatefulWidget {
  final List<ProgressCompletionNotification> notifications;
  final String studentId;
  const _ParentProgressNotifBanner({required this.notifications, required this.studentId});

  @override
  State<_ParentProgressNotifBanner> createState() => _ParentProgressNotifBannerState();
}

class _ParentProgressNotifBannerState extends State<_ParentProgressNotifBanner> {
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
    context.read<AppProvider>().markProgressNotificationReadByParent(notif.id);
    _confettiCtrl.play();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.topCenter,
      children: [
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
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  const Icon(Icons.star_rounded, color: AppColors.yellow, size: 16),
                  const SizedBox(width: 6),
                  Text('お子様のタスク完了通知 (${widget.notifications.length})',
                      style: const TextStyle(color: AppColors.yellow, fontSize: 13, fontWeight: FontWeight.w700)),
                ]),
              ),
              ...widget.notifications.map((n) => _buildCard(context, n)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCard(BuildContext context, ProgressCompletionNotification notif) {
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
            child: const Center(child: Text('🎉', style: TextStyle(fontSize: 20))),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${notif.subject}のタスクを完了しました！',
                    style: const TextStyle(color: AppColors.success, fontSize: 11, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(notif.itemTitle,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
                Text('${notif.studentName}さん',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
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
// お知らせバナー（保護者用）
// ============================================================
class _ParentAnnouncementBanner extends StatelessWidget {
  final List<Announcement> announcements;
  final String userId;
  const _ParentAnnouncementBanner({required this.announcements, required this.userId});

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
              Text('塾からのお知らせ (${announcements.length})',
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

// ---- Parent Lesson Card (with absence) ----
class _ParentLessonCard extends StatefulWidget {
  final Lesson lesson;
  final String studentId;
  const _ParentLessonCard({required this.lesson, required this.studentId});

  @override
  State<_ParentLessonCard> createState() => _ParentLessonCardState();
}

class _ParentLessonCardState extends State<_ParentLessonCard> {
  bool _showAbsentForm = false;
  final _reasonController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final lesson = widget.lesson;
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: lesson.isAbsent ? AppColors.danger : AppColors.info,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.info.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.info.withValues(alpha: 0.4)),
                ),
                child: Text(lesson.subject,
                    style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w700, fontSize: 13)),
              ),
              const SizedBox(width: 8),
              Text('${lesson.startTime} 〜 ${lesson.endTime}',
                  style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 13)),
              const Spacer(),
              if (lesson.isAbsent) const AppChip(label: '欠席', color: AppColors.danger),
            ],
          ),
          if (lesson.isAbsent && lesson.absentReason != null) ...[
            const SizedBox(height: 6),
            Text('欠席理由: ${lesson.absentReason}',
                style: const TextStyle(color: AppColors.danger, fontSize: 12)),
          ],
          if (!lesson.isAbsent) ...[
            const SizedBox(height: 10),
            if (_showAbsentForm) ...[
              TextField(
                controller: _reasonController,
                decoration: const InputDecoration(labelText: '欠席理由', hintText: '例：発熱のため', isDense: true),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        final provider = context.read<AppProvider>();
                        final parentUser = provider.currentUser!;
                        final student = provider.getStudentById(widget.studentId);
                        provider.sendAbsenceNotification(AbsenceNotification(
                          id: 'abs_${DateTime.now().millisecondsSinceEpoch}',
                          studentId: widget.studentId,
                          studentName: student?.name ?? '',
                          lessonId: lesson.id,
                          subject: lesson.subject,
                          lessonDate: lesson.date,
                          reason: _reasonController.text.isNotEmpty ? _reasonController.text : '欠席',
                          sender: 'parent',
                          senderName: parentUser.name,
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

// ============================================================
// Grades Tab (parent view)
// ============================================================
class _ParentGradesTab extends StatelessWidget {
  final String studentId;
  const _ParentGradesTab({required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final scores = provider.getScoresForStudent(studentId);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          if (scores.isEmpty)
            const EmptyState(message: '成績データがありません')
          else
            ...scores.reversed.map((s) => _ParentScoreCard(score: s, studentId: studentId)),
        ],
      ),
    );
  }
}

class _ParentScoreCard extends StatelessWidget {
  final ExamScore score;
  final String studentId;
  const _ParentScoreCard({required this.score, required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    final diffs = provider.getSubjectDiffs(studentId, score.examType);

    return GlowCard(
      margin: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AppChip(label: score.examType, color: AppColors.info),
              const Spacer(),
              Text('${score.totalScore}点', style: const TextStyle(
                color: AppColors.yellow, fontSize: 22, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 12),
          ...score.scores.entries.map((e) {
            final val = e.value;
            final diff = diffs[e.key];
            final isHigh = val != null && val >= 90;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  SizedBox(width: 72, child: Text(e.key,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: val != null ? val / 100 : 0,
                      backgroundColor: AppColors.navyCard,
                      color: isHigh ? AppColors.yellow : AppColors.silver,
                      minHeight: 6, borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 32,
                    child: Text(val?.toString() ?? '-', style: TextStyle(
                      color: isHigh ? AppColors.yellow : AppColors.textPrimary,
                      fontWeight: FontWeight.w700, fontSize: 13,
                    ), textAlign: TextAlign.right),
                  ),
                  const SizedBox(width: 4),
                  SizedBox(
                    width: 34,
                    child: diff != null
                        ? Text('${diff >= 0 ? '+' : ''}$diff',
                            style: TextStyle(
                              color: diff > 0 ? AppColors.success : diff < 0 ? AppColors.danger : AppColors.silverDim,
                              fontSize: 10, fontWeight: FontWeight.w700,
                            ))
                        : const SizedBox.shrink(),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

// ============================================================
// Contact Tab — 欠席連絡履歴 + 保護者→管理者メッセージ送信
// ============================================================
class _ParentContactTab extends StatefulWidget {
  final String studentId;
  const _ParentContactTab({required this.studentId});

  @override
  State<_ParentContactTab> createState() => _ParentContactTabState();
}

class _ParentContactTabState extends State<_ParentContactTab> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _textCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  bool _isSending = false;
  Uint8List? _selectedImageBytes;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    try {
      if (kIsWeb) {
        final uploadInput = html.FileUploadInputElement()..accept = 'image/*';
        uploadInput.click();
        await uploadInput.onChange.first;
        if (uploadInput.files == null || uploadInput.files!.isEmpty) return;
        final file = uploadInput.files![0];
        final reader = html.FileReader();
        reader.readAsArrayBuffer(file);
        await reader.onLoad.first;
        final bytes = Uint8List.fromList(reader.result as List<int>);
        setState(() => _selectedImageBytes = bytes);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('画像の読み込みに失敗しました: $e'),
              behavior: SnackBarBehavior.floating),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final absences = provider.getAbsencesForStudent(widget.studentId);
    final parentMsgs = provider.getParentMessagesForStudent(widget.studentId);
    final adminReplies = provider.getAdminReplies('parent', widget.studentId);
    final unreadReplies = adminReplies.where((r) => !r.isRead).length;
    final parentUser = provider.currentUser;
    final parentId = parentUser?.id ?? '';
    final announcements = provider.getAnnouncementsForUser(parentId, 'parent');
    final unreadAnnounce = announcements.where((a) => !a.isReadBy(parentId)).length;

    return Column(
      children: [
        // ── Tab bar ──
        Container(
          color: AppColors.navyDark,
          child: TabBar(
            controller: _tabController,
            indicatorColor: AppColors.info,
            labelColor: AppColors.info,
            unselectedLabelColor: AppColors.silverDim,
            labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            tabs: [
              Tab(text: '欠席連絡 (${absences.length})'),
              Tab(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('先生への連絡'),
                    if (unreadReplies > 0) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(color: AppColors.danger, borderRadius: BorderRadius.circular(8)),
                        child: Text('$unreadReplies', style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ],
                ),
              ),
              Tab(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('お知らせ'),
                    if (unreadAnnounce > 0) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(color: AppColors.info, borderRadius: BorderRadius.circular(8)),
                        child: Text('$unreadAnnounce', style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),

        // ── Tab views ──
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              // ---- 欠席連絡履歴 ----
              _buildAbsenceList(absences),

              // ---- 先生への連絡（チャット形式） ----
              _buildChatTab(context, provider, parentMsgs, adminReplies),

              // ---- お知らせ履歴 ----
              _buildAnnouncementList(provider, parentId, announcements),
            ],
          ),
        ),
      ],
    );
  }

  // 欠席連絡履歴
  Widget _buildAbsenceList(List<AbsenceNotification> absences) {
    if (absences.isEmpty) {
      return const Center(child: EmptyState(message: '欠席連絡はありません', icon: Icons.event_available));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: absences.length,
      itemBuilder: (context, i) {
        final a = absences[absences.length - 1 - i];
        return GlowCard(
          margin: const EdgeInsets.only(bottom: 10),
          glowColor: AppColors.danger,
          child: Row(
            children: [
              const Icon(Icons.event_busy, color: AppColors.danger, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${a.subject}　${a.lessonDate.month}/${a.lessonDate.day}',
                        style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
                    Text('理由: ${a.reason}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                    Text('送信: ${_fmt(a.sentAt)}　送信者: ${a.senderName}',
                        style: const TextStyle(color: AppColors.silverDim, fontSize: 11)),
                  ],
                ),
              ),
              const AppChip(label: '送信済', color: AppColors.success),
            ],
          ),
        );
      },
    );
  }

  // 先生への連絡タブ（チャット形式）
  Widget _buildChatTab(BuildContext context, AppProvider provider, List<ParentMessage> parentMsgs, List<AdminReply> adminReplies) {
    // 時系列マージ
    final allItems = [
      ...parentMsgs.map((m) => _PChatItem(
        isMe: true,
        name: m.fromName,
        text: m.text ?? '',
        time: m.createdAt,
        imageBytes: m.imageBytes != null ? Uint8List.fromList(m.imageBytes!) : null,
      )),
      ...adminReplies.map((r) => _PChatItem(
        isMe: false,
        name: '管理者',
        text: r.text,
        time: r.createdAt,
        imageBytes: r.imageBytes != null ? Uint8List.fromList(r.imageBytes!) : null,
        imageUrl: r.imageUrl,
      )),
    ]..sort((a, b) => a.time.compareTo(b.time));

    // 管理者返信を既読にする
    if (adminReplies.any((r) => !r.isRead)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        provider.markAdminReplyRead('parent', widget.studentId);
      });
    }

    return Column(
      children: [
        // ── チャット一覧 ──
        Expanded(
          child: allItems.isEmpty
              ? const Center(child: EmptyState(message: '連絡履歴はありません', icon: Icons.chat_bubble_outline))
              : ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  itemCount: allItems.length,
                  itemBuilder: (_, i) => _ParentChatBubble(item: allItems[i]),
                ),
        ),

        // ── 入力エリア ──
        Container(
          padding: EdgeInsets.fromLTRB(12, 8, 12, MediaQuery.of(context).viewInsets.bottom + 10),
          decoration: BoxDecoration(
            color: AppColors.navyDark,
            border: Border(top: BorderSide(color: AppColors.cardBorder, width: 0.5)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 画像プレビュー
              if (_selectedImageBytes != null) ...[
                const SizedBox(height: 6),
                Stack(
                  alignment: Alignment.topRight,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.memory(
                        _selectedImageBytes!,
                        height: 120,
                        width: double.infinity,
                        fit: BoxFit.cover,
                      ),
                    ),
                    GestureDetector(
                      onTap: () => setState(() => _selectedImageBytes = null),
                      child: Container(
                        margin: const EdgeInsets.all(4),
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                        child: const Icon(Icons.close, color: Colors.white, size: 16),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
              ],
              Row(children: [
                // カメラアイコン（画像選択）
                GestureDetector(
                  onTap: _pickImage,
                  child: Container(
                    width: 40, height: 40,
                    decoration: BoxDecoration(
                      color: _selectedImageBytes != null
                          ? AppColors.info.withValues(alpha: 0.18)
                          : AppColors.navyCard,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: _selectedImageBytes != null ? AppColors.info : AppColors.cardBorder,
                      ),
                    ),
                    child: Icon(
                      Icons.photo_camera_outlined,
                      color: _selectedImageBytes != null ? AppColors.info : AppColors.silverDim,
                      size: 18,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _textCtrl,
                    maxLines: 4, minLines: 1,
                    decoration: InputDecoration(
                      hintText: '塾への連絡を入力...',
                      hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 13),
                      filled: true, fillColor: AppColors.navyCard,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    ),
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: _isSending ? null : () => _sendMessage(context, provider),
                  child: Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: _isSending ? AppColors.silverDim : AppColors.info,
                      shape: BoxShape.circle,
                    ),
                    child: _isSending
                        ? const Padding(padding: EdgeInsets.all(12),
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ],
    );
  }

  void _sendMessage(BuildContext context, AppProvider provider) {
    final text = _textCtrl.text.trim();
    if (text.isEmpty && _selectedImageBytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('メッセージまたは画像を入力してください'), behavior: SnackBarBehavior.floating),
      );
      return;
    }

    setState(() => _isSending = true);

    final parentUser = provider.currentUser!;
    final student = provider.getStudentById(widget.studentId);
    final imageBytesCopy = _selectedImageBytes != null ? List<int>.from(_selectedImageBytes!) : null;

    provider.sendParentMessage(ParentMessage(
      id: 'pmsg_${DateTime.now().millisecondsSinceEpoch}',
      fromParentId: parentUser.id,
      fromName: parentUser.name,
      studentId: widget.studentId,
      studentName: student?.name ?? '',
      text: text.isEmpty ? null : text,
      imageBytes: imageBytesCopy,
      createdAt: DateTime.now(),
    ));
    _textCtrl.clear();
    setState(() {
      _isSending = false;
      _selectedImageBytes = null;
    });

    Future.delayed(const Duration(milliseconds: 200), () {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: const Text('塾へ連絡を送信しました'),
          backgroundColor: AppColors.success, behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
    );
  }

  String _fmt(DateTime dt) =>
      '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

  // お知らせ一覧ビュー
  Widget _buildAnnouncementList(AppProvider provider, String userId, List<Announcement> announcements) {
    if (announcements.isEmpty) {
      return const Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.campaign_outlined, color: AppColors.silverDim, size: 56),
          SizedBox(height: 12),
          Text('お知らせはまだありません', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ]),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: announcements.length,
      itemBuilder: (_, i) {
        final a = announcements[i];
        final isRead = a.isReadBy(userId);
        return _ParentAnnouncementCard(announcement: a, userId: userId, isRead: isRead);
      },
    );
  }
}

// ---- 保護者チャット用データクラス ----
class _PChatItem {
  final bool isMe;
  final String name;
  final String text;
  final DateTime time;
  final Uint8List? imageBytes;
  final String? imageUrl;
  _PChatItem({required this.isMe, required this.name, required this.text, required this.time, this.imageBytes, this.imageUrl});
}

// ---- 保護者チャットバブル ----
class _ParentChatBubble extends StatelessWidget {
  final _PChatItem item;
  const _ParentChatBubble({required this.item});

  @override
  Widget build(BuildContext context) {
    final timeStr = _fmt(item.time);

    if (item.isMe) {
      // 右側：保護者（自分）
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
            const SizedBox(width: 6),
            Text(item.name, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w600)),
            const SizedBox(width: 4),
            const Icon(Icons.person, color: AppColors.info, size: 12),
          ]),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            const SizedBox(width: 60),
            Flexible(
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                if (item.text.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF1E6FC5), Color(0xFF1A5BA8)],
                        begin: Alignment.topLeft, end: Alignment.bottomRight,
                      ),
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(14), topRight: Radius.circular(4),
                        bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                      ),
                      boxShadow: [BoxShadow(color: AppColors.info.withValues(alpha: 0.2), blurRadius: 6, offset: const Offset(0, 2))],
                    ),
                    child: Text(item.text, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.5)),
                  ),
                if (item.imageBytes != null) ...[
                  if (item.text.isNotEmpty) const SizedBox(height: 6),
                  GestureDetector(
                    onTap: () => _showImageDialog(context, imageBytes: item.imageBytes),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.memory(item.imageBytes!, width: 200, fit: BoxFit.cover),
                    ),
                  ),
                ],
              ]),
            ),
          ]),
          const SizedBox(height: 2),
          const Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Icon(Icons.done_all, color: AppColors.success, size: 12),
            SizedBox(width: 3),
            Text('送信済', style: TextStyle(color: AppColors.success, fontSize: 10)),
          ]),
        ]),
      );
    } else {
      // 左側：管理者
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(color: AppColors.yellow.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: const Icon(Icons.admin_panel_settings, color: AppColors.yellow, size: 16),
            ),
            const SizedBox(width: 6),
            const Text('管理者', style: TextStyle(color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w700)),
            const SizedBox(width: 6),
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            const SizedBox(width: 34),
            Flexible(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.navyCard,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(4), topRight: Radius.circular(14),
                      bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                    ),
                    border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
                  ),
                  child: Text(item.text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
                ),
                if (item.imageBytes != null) ...[
                  const SizedBox(height: 6),
                  GestureDetector(
                    onTap: () => _showImageDialog(context, imageBytes: item.imageBytes),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.memory(item.imageBytes!, width: 200, fit: BoxFit.cover),
                    ),
                  ),
                ] else if (item.imageUrl != null) ...[
                  const SizedBox(height: 6),
                  GestureDetector(
                    onTap: () => _showImageDialog(context, imageUrl: item.imageUrl),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.network(item.imageUrl!, width: 200, fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, color: AppColors.silverDim)),
                    ),
                  ),
                ],
              ]),
            ),
            const SizedBox(width: 60),
          ]),
        ]),
      );
    }
  }

  String _fmt(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'たった今';
    if (diff.inMinutes < 60) return '${diff.inMinutes}分前';
    if (diff.inHours < 24) return '${diff.inHours}時間前';
    return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _showImageDialog(BuildContext context, {Uint8List? imageBytes, String? imageUrl}) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(children: [
          InteractiveViewer(
            child: imageBytes != null
                ? Image.memory(imageBytes, fit: BoxFit.contain)
                : Image.network(imageUrl!, fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const Center(
                      child: Icon(Icons.broken_image, color: Colors.white54, size: 64))),
          ),
          Positioned(
            top: 8, right: 8,
            child: GestureDetector(
              onTap: () => Navigator.pop(ctx),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 20),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

// ============================================================
// 保護者用お知らせカード
// ============================================================
class _ParentAnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  final String userId;
  final bool isRead;
  const _ParentAnnouncementCard({
    required this.announcement, required this.userId, required this.isRead});

  @override
  Widget build(BuildContext context) {
    final a = announcement;
    final provider = context.read<AppProvider>();
    final timeStr = '${a.createdAt.month}/${a.createdAt.day} '
        '${a.createdAt.hour.toString().padLeft(2, '0')}:${a.createdAt.minute.toString().padLeft(2, '0')}';

    return GlowCard(
      margin: const EdgeInsets.only(bottom: 12),
      glowColor: isRead ? AppColors.cardBorder : AppColors.info,
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: (isRead ? AppColors.silverDim : AppColors.info).withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.campaign_rounded,
                color: isRead ? AppColors.silverDim : AppColors.info, size: 16),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(a.title, style: TextStyle(
              color: isRead ? AppColors.textSecondary : AppColors.textPrimary,
              fontSize: 14, fontWeight: FontWeight.w700,
            )),
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ])),
          if (!isRead)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: AppColors.info, borderRadius: BorderRadius.circular(8)),
              child: const Text('NEW', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
            )
          else
            const Icon(Icons.check_circle, color: AppColors.success, size: 16),
        ]),
        const SizedBox(height: 10),
        Text(a.body, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5)),
        if (a.imageBytes != null) ...[
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => _showImageDialogBytes(context, Uint8List.fromList(a.imageBytes!)),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(
                Uint8List.fromList(a.imageBytes!),
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Text('タップで拡大', style: TextStyle(color: AppColors.silverDim, fontSize: 10)),
        ] else if (a.imageUrl != null && a.imageUrl!.isNotEmpty) ...[
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => _showImageDialogUrl(context, a.imageUrl!),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                a.imageUrl!,
                width: double.infinity,
                fit: BoxFit.cover,
                loadingBuilder: (_, child, progress) => progress == null
                    ? child
                    : Container(height: 120, color: AppColors.navyCard,
                        child: const Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.info))),
                errorBuilder: (_, __, ___) => Container(
                  height: 60,
                  decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.cardBorder)),
                  child: const Center(child: Icon(Icons.broken_image, color: AppColors.silverDim, size: 24)),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Text('タップで拡大', style: TextStyle(color: AppColors.silverDim, fontSize: 10)),
        ],
        if (!isRead) ...[
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => provider.markAnnouncementRead(a.id, userId),
              icon: const Icon(Icons.check_circle_outline, size: 16, color: AppColors.info),
              label: const Text('既読にする', style: TextStyle(color: AppColors.info, fontSize: 13)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.info),
                minimumSize: const Size(0, 38),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ]),
    );
  }

  void _showImageDialogBytes(BuildContext context, Uint8List bytes) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(children: [
          InteractiveViewer(child: Image.memory(bytes, fit: BoxFit.contain)),
          Positioned(
            top: 8, right: 8,
            child: GestureDetector(
              onTap: () => Navigator.pop(ctx),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 20),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  void _showImageDialogUrl(BuildContext context, String url) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(children: [
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
            top: 8, right: 8,
            child: GestureDetector(
              onTap: () => Navigator.pop(ctx),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 20),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}
