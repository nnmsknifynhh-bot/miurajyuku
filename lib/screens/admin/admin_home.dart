// ============================================================
// 管理者ホーム画面 — 三浦塾 学習管理システム
// タブ: ダッシュボード(カレンダートップ) / 連絡 / 進捗管理 / 設定
// ============================================================
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';
import '../auth/login_screen.dart';

class AdminHome extends StatefulWidget {
  const AdminHome({super.key});
  @override
  State<AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<AdminHome> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final unreadMsg = provider.unreadMessageCount;
    final unreadAbs = provider.unreadAbsenceCount;
    final totalUnread = unreadMsg + unreadAbs;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: AppColors.navyDark,
        elevation: 0,
        title: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.yellow.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
            ),
            child: const Text('管理者', style: TextStyle(color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 8),
          const Text('三浦塾 管理画面', style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
        ]),
        actions: [
          if (totalUnread > 0)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: AppColors.danger, borderRadius: BorderRadius.circular(12)),
                child: Text('通知 $totalUnread', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
              )),
            ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.silverDim),
            onPressed: () {
              context.read<AppProvider>().logout();
              Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
            },
          ),
        ],
      ),
      body: SafeArea(
        child: IndexedStack(index: _currentIndex, children: const [
          _AdminDashboardTab(),
          _AdminContactTab(),
          _AdminProgressTab(),
          _AdminAnnouncementTab(),
          _AdminSettingsTab(),
        ]),
      ),
      bottomNavigationBar: _buildNav(totalUnread, unreadMsg, unreadAbs),
    );
  }

  Widget _buildNav(int totalUnread, int unreadMsg, int unreadAbs) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.navyDark,
        border: Border(top: BorderSide(color: AppColors.cardBorder, width: 0.5)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
            _navItem(0, Icons.dashboard_rounded, 'ダッシュボード', 0),
            _navItem(1, Icons.mail_rounded, '連絡', unreadMsg + unreadAbs),
            _navItem(2, Icons.checklist_rounded, '進捗管理', 0),
            _navItem(3, Icons.campaign_rounded, 'お知らせ', 0),
            _navItem(4, Icons.settings_rounded, '設定', 0),
          ]),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label, int badge) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.yellow.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Stack(clipBehavior: Clip.none, children: [
          Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: selected ? AppColors.yellow : AppColors.silverDim, size: 22),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(
              color: selected ? AppColors.yellow : AppColors.silverDim,
              fontSize: 9, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
            )),
          ]),
          if (badge > 0)
            Positioned(top: -4, right: -8,
              child: Container(
                padding: const EdgeInsets.all(3),
                decoration: const BoxDecoration(color: AppColors.danger, shape: BoxShape.circle),
                child: Text('$badge', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700)),
              )),
        ]),
      ),
    );
  }
}

// ============================================================
// ダッシュボード：全授業カレンダートップ → 欠席/連絡通知 → 進捗/成績 → 在籍数(下部)
// ============================================================
class _AdminDashboardTab extends StatefulWidget {
  const _AdminDashboardTab();
  @override
  State<_AdminDashboardTab> createState() => _AdminDashboardTabState();
}

class _AdminDashboardTabState extends State<_AdminDashboardTab> {
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
    final students = provider.allStudents;
    final allDates = provider.getAllLessonDates();
    final selectedLessons = _selectedDay != null
        ? provider.getAllLessonsOnDate(_selectedDay!) : <Lesson>[];
    final unreadAbs = provider.absenceNotifications.where((a) => !a.isRead).toList();
    final unreadMsgs = provider.messages.where((m) => !m.isRead).toList();
    final unreadParent = provider.parentMessages.where((m) => !m.isRead).toList();

    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // ── 全授業カレンダー（最上部）──
        Container(
          margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          decoration: BoxDecoration(
            gradient: AppGradients.cardGradient,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.cardBorder),
            boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.08), blurRadius: 12)],
          ),
          child: TableCalendar(
            firstDay: DateTime.utc(2025, 1, 1),
            lastDay: DateTime.utc(2027, 12, 31),
            focusedDay: _focusedDay,
            selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
            calendarFormat: CalendarFormat.month,
            eventLoader: (day) {
              final d = DateTime(day.year, day.month, day.day);
              return allDates.contains(d) ? ['lesson'] : [];
            },
            onDaySelected: (sel, foc) => setState(() { _selectedDay = sel; _focusedDay = foc; }),
            onPageChanged: (foc) => setState(() => _focusedDay = foc),
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
              markerDecoration: const BoxDecoration(color: AppColors.info, shape: BoxShape.circle),
              markerSize: 5,
            ),
            headerStyle: HeaderStyle(
              formatButtonVisible: false, titleCentered: true,
              titleTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700),
              leftChevronIcon: const Icon(Icons.chevron_left, color: AppColors.silver),
              rightChevronIcon: const Icon(Icons.chevron_right, color: AppColors.silver),
              headerPadding: const EdgeInsets.symmetric(vertical: 10),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.cardBorder))),
            ),
            daysOfWeekStyle: const DaysOfWeekStyle(
              weekdayStyle: TextStyle(color: AppColors.textSecondary, fontSize: 11),
              weekendStyle: TextStyle(color: AppColors.silverDim, fontSize: 11),
            ),
          ),
        ),

        // ── 選択日の授業 ──
        if (_selectedDay != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              const Icon(Icons.event, color: AppColors.yellow, size: 14),
              const SizedBox(width: 6),
              Text(DateFormat('M月d日（E）', 'ja').format(_selectedDay!),
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700)),
              const Spacer(),
              Text('${selectedLessons.length}件', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ]),
          ),
          if (selectedLessons.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text('授業の予定はありません', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            )
          else
            ...selectedLessons.map((l) => _AdminLessonCard(lesson: l)),
        ],

        // ── 新規問い合わせ（カレンダー直下）──
        const SizedBox(height: 16),
        _InquirySection(),

        // ── 欠席連絡通知 ──
        if (unreadAbs.isNotEmpty) ...[
          const SizedBox(height: 12),
          const SectionHeader(title: '🔔 欠席連絡', subtitle: '未確認', accentColor: AppColors.warning),
          ...unreadAbs.map((a) => _AbsenceNotifCard(absence: a)),
        ],

        // ── メッセージ通知 ──
        if (unreadMsgs.isNotEmpty || unreadParent.isNotEmpty) ...[
          const SizedBox(height: 12),
          const SectionHeader(title: '📩 未読メッセージ', accentColor: AppColors.info),
          ...unreadMsgs.map((m) => _MsgNotifCard(
            name: m.fromName, text: m.text ?? '', color: AppColors.info,
            onRead: () => provider.markMessageRead(m.id),
          )),
          ...unreadParent.map((m) => _MsgNotifCard(
            name: '${m.fromName}（保護者）', text: m.text ?? '', color: AppColors.success,
            onRead: () => provider.markParentMessageRead(m.id),
          )),
        ],

        // ── 在籍生徒数（最下部）──
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: GlowCard(
            child: Row(children: [
              const Icon(Icons.people, color: AppColors.yellow, size: 28),
              const SizedBox(width: 14),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('在籍生徒数', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                Text('${students.length}名', style: const TextStyle(
                  color: AppColors.yellow, fontSize: 28, fontWeight: FontWeight.w900,
                )),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 32),
      ]),
    );
  }

}


// ── 授業カードウィジェット ──
class _AdminLessonCard extends StatelessWidget {
  final Lesson lesson;
  const _AdminLessonCard({required this.lesson});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    final student = provider.getStudentById(lesson.studentId);
    final teacher = lesson.teacherId != null ? provider.getTeacherById(lesson.teacherId!) : null;
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: lesson.isAbsent ? AppColors.danger : AppColors.yellow,
      child: Row(children: [
        CircleAvatar(
          radius: 18,
          backgroundColor: AppColors.yellow.withValues(alpha: 0.12),
          child: Text(student?.name[0] ?? '?',
              style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w800, fontSize: 14)),
        ),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(student?.name ?? '---',
              style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
          Text('${lesson.subject}　${lesson.startTime}〜${lesson.endTime}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          if (teacher != null)
            Text('担当: ${teacher.name}', style: const TextStyle(color: AppColors.silverDim, fontSize: 11)),
        ])),
        if (lesson.isAbsent)
          const AppChip(label: '欠席', color: AppColors.danger)
        else
          AppChip(label: '中${student?.grade ?? '-'}', color: AppColors.info),
      ]),
    );
  }
}

// ── 欠席通知カード ──
class _AbsenceNotifCard extends StatelessWidget {
  final AbsenceNotification absence;
  const _AbsenceNotifCard({required this.absence});

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: AppColors.warning,
      child: Row(children: [
        const Icon(Icons.event_busy, color: AppColors.warning, size: 22),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${absence.studentName}　${absence.subject}',
              style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
          Text('${absence.lessonDate.month}/${absence.lessonDate.day}　${absence.senderName}より',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          Text('理由: ${absence.reason}', style: const TextStyle(color: AppColors.warning, fontSize: 12)),
        ])),
        TextButton(
          onPressed: () => context.read<AppProvider>().markAbsenceRead(absence.id),
          child: const Text('確認', style: TextStyle(color: AppColors.yellow, fontSize: 12)),
        ),
      ]),
    );
  }
}

// ── 未読メッセージ通知カード ──
class _MsgNotifCard extends StatelessWidget {
  final String name;
  final String text;
  final Color color;
  final VoidCallback onRead;
  const _MsgNotifCard({required this.name, required this.text, required this.color, required this.onRead});

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: color,
      child: Row(children: [
        CircleAvatar(
          radius: 16, backgroundColor: color.withValues(alpha: 0.15),
          child: Text(name[0], style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 13)),
        ),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 12)),
          if (text.isNotEmpty)
            Text(text, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
        TextButton(onPressed: onRead, child: const Text('既読', style: TextStyle(color: AppColors.info, fontSize: 11))),
      ]),
    );
  }
}

// ── 進捗サマリーカード ──
// ============================================================
// 新規問い合わせセクション
// ============================================================
class _InquirySection extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final inquiries = provider.inquiries;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          const Icon(Icons.person_add, color: AppColors.info, size: 16),
          const SizedBox(width: 6),
          const Text('新規問い合わせ', style: TextStyle(
              color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
          const Spacer(),
          Builder(
            builder: (btnCtx) => GestureDetector(
              onTap: () => _showInquiryDialog(btnCtx, provider, null),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.info.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.info.withValues(alpha: 0.4)),
                ),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.add, color: AppColors.info, size: 14),
                  SizedBox(width: 4),
                  Text('追加', style: TextStyle(color: AppColors.info, fontSize: 12, fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
          ),
        ]),
      ),
      if (inquiries.isEmpty)
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text('問い合わせはまだありません', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        )
      else
        ...inquiries.map((inq) => _InquiryCard(inquiry: inq)),
    ]);
  }

  // ── 追加・編集共通ダイアログ（inquiry==nullなら追加モード）──
  static void _showInquiryDialog(BuildContext context, AppProvider provider, Inquiry? inquiry) {
    final isEdit = inquiry != null;

    // テキスト系
    final nameCtrl   = TextEditingController(text: inquiry?.name   ?? '');
    final schoolCtrl = TextEditingController(text: inquiry?.school ?? '');
    final gradeCtrl  = TextEditingController(text: inquiry?.grade  ?? '');
    final memoCtrl   = TextEditingController(text: inquiry?.memo   ?? '');
    final bankMemoCtrl = TextEditingController(text: inquiry?.bankMemo ?? '');
    final textMemoCtrl = TextEditingController(text: inquiry?.textMemo ?? '');

    // 問い合わせ日
    DateTime? inquiryDate    = inquiry?.inquiryDate;
    String    inquiryMethod  = inquiry?.inquiryMethod ?? '電話';

    // 体験授業
    DateTime? trialDate      = inquiry?.trialDate;
    String    trialStart     = inquiry?.trialStartTime     ?? '16:00';
    String    trialEnd       = inquiry?.trialEndTime       ?? '17:00';

    // 面談
    DateTime? interviewDate  = inquiry?.interviewDate;
    String    ivStart        = inquiry?.interviewStartTime  ?? '16:00';
    String    ivEnd          = inquiry?.interviewEndTime    ?? '17:00';

    // 初回授業
    DateTime? firstDate      = inquiry?.firstLessonDate;
    String    firstStart     = inquiry?.firstLessonStartTime ?? '16:00';
    String    firstEnd       = inquiry?.firstLessonEndTime   ?? '18:00';

    // 口座・テキスト
    DateTime? bankDate       = inquiry?.bankRegisteredDate;
    DateTime? textDate       = inquiry?.textDeliveredDate;

    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) {
          // ── 共通ピッカー ──
          Future<DateTime?> pickDate(DateTime? init) => showDatePicker(
            context: ctx, initialDate: init ?? DateTime.now(),
            firstDate: DateTime(2024), lastDate: DateTime(2030),
            builder: (c, child) => Theme(
              data: ThemeData.dark().copyWith(
                  colorScheme: const ColorScheme.dark(primary: AppColors.info, surface: AppColors.card)),
              child: child!,
            ),
          );
          Future<String?> pickTime(String cur) async {
            final p = cur.split(':');
            final t = await showTimePicker(
              context: ctx,
              initialTime: TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1])),
              builder: (c, child) => Theme(
                data: ThemeData.dark().copyWith(
                    colorScheme: const ColorScheme.dark(primary: AppColors.info, surface: AppColors.card)),
                child: child!,
              ),
            );
            if (t == null) return null;
            return '${t.hour.toString().padLeft(2,'0')}:${t.minute.toString().padLeft(2,'0')}';
          }
          String fd(DateTime? d) => d == null ? '未設定' : '${d.month}/${d.day}';

          // ── セクションヘッダー ──
          Widget sec(String label) => Padding(
            padding: const EdgeInsets.fromLTRB(0, 14, 0, 6),
            child: Row(children: [
              Container(width: 3, height: 14, decoration: BoxDecoration(
                  color: AppColors.info, borderRadius: BorderRadius.circular(2))),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(
                  color: AppColors.info, fontSize: 12, fontWeight: FontWeight.w700)),
            ]),
          );

          // ── 日付 + 時間行 ──
          Widget dateTimeRow({
            required String label,
            required DateTime? date,
            required String startTime,
            required String endTime,
            required void Function(DateTime) onDateSet,
            required void Function(String) onStartSet,
            required void Function(String) onEndSet,
          }) {
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // 日付ボタン
              GestureDetector(
                onTap: () async { final d = await pickDate(date); if (d != null) setS(() => onDateSet(d)); },
                child: Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: date != null ? AppColors.info.withValues(alpha: 0.08) : AppColors.navyCard,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: date != null ? AppColors.info.withValues(alpha: 0.5) : AppColors.cardBorder),
                  ),
                  child: Row(children: [
                    Icon(Icons.calendar_today,
                        color: date != null ? AppColors.info : AppColors.silverDim, size: 14),
                    const SizedBox(width: 8),
                    Text(label, style: TextStyle(
                        color: date != null ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 13)),
                    const Spacer(),
                    Text(fd(date), style: TextStyle(
                        color: date != null ? AppColors.info : AppColors.silverDim,
                        fontSize: 13, fontWeight: date != null ? FontWeight.w600 : FontWeight.w400)),
                    const SizedBox(width: 4),
                    Icon(Icons.chevron_right,
                        color: date != null ? AppColors.info : AppColors.silverDim, size: 16),
                  ]),
                ),
              ),
              // 時間ボタン（日付が設定されている時のみ）
              if (date != null)
                Row(children: [
                  Expanded(child: GestureDetector(
                    onTap: () async { final t = await pickTime(startTime); if (t != null) setS(() => onStartSet(t)); },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.cardBorder)),
                      child: Row(children: [
                        const Icon(Icons.access_time, color: AppColors.info, size: 13),
                        const SizedBox(width: 4),
                        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Text('開始', style: TextStyle(color: AppColors.textSecondary, fontSize: 9)),
                          Text(startTime, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700)),
                        ]),
                      ]),
                    ),
                  )),
                  const SizedBox(width: 8),
                  Expanded(child: GestureDetector(
                    onTap: () async { final t = await pickTime(endTime); if (t != null) setS(() => onEndSet(t)); },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.cardBorder)),
                      child: Row(children: [
                        const Icon(Icons.access_time, color: AppColors.silverDim, size: 13),
                        const SizedBox(width: 4),
                        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Text('終了', style: TextStyle(color: AppColors.textSecondary, fontSize: 9)),
                          Text(endTime, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700)),
                        ]),
                      ]),
                    ),
                  )),
                ]),
              const SizedBox(height: 8),
            ]);
          }

          // ── 日付のみ行（口座・テキスト）+ コメント欄 ──
          Widget dateWithMemo({
            required String label,
            required DateTime? date,
            required TextEditingController memoCtrl,
            required String memoHint,
            required void Function(DateTime) onDateSet,
          }) {
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              GestureDetector(
                onTap: () async { final d = await pickDate(date); if (d != null) setS(() => onDateSet(d)); },
                child: Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: date != null ? AppColors.info.withValues(alpha: 0.08) : AppColors.navyCard,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: date != null ? AppColors.info.withValues(alpha: 0.5) : AppColors.cardBorder),
                  ),
                  child: Row(children: [
                    Icon(Icons.calendar_today,
                        color: date != null ? AppColors.info : AppColors.silverDim, size: 14),
                    const SizedBox(width: 8),
                    Text(label, style: TextStyle(
                        color: date != null ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 13)),
                    const Spacer(),
                    Text(fd(date), style: TextStyle(
                        color: date != null ? AppColors.info : AppColors.silverDim,
                        fontSize: 13, fontWeight: date != null ? FontWeight.w600 : FontWeight.w400)),
                    const SizedBox(width: 4),
                    Icon(Icons.chevron_right,
                        color: date != null ? AppColors.info : AppColors.silverDim, size: 16),
                  ]),
                ),
              ),
              TextField(
                controller: memoCtrl,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 12),
                maxLines: 2, minLines: 1,
                decoration: InputDecoration(
                  hintText: memoHint,
                  hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
                  filled: true, fillColor: AppColors.navyCard,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                ),
              ),
              const SizedBox(height: 8),
            ]);
          }

          return AlertDialog(
            backgroundColor: AppColors.card,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Text(isEdit ? '問い合わせ編集' : '新規問い合わせ追加',
                style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w700, fontSize: 15)),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start, children: [

                // ── 基本情報 ──
                sec('基本情報'),
                _inquiryField('名前 *', nameCtrl,
                    hint: '例：山田太郎', onChanged: (_) => setS(() {})),
                const SizedBox(height: 8),
                _inquiryField('学校', schoolCtrl, hint: '例：○○中学校'),
                const SizedBox(height: 8),
                _inquiryField('学年', gradeCtrl, hint: '例：中1'),

                // ── 問い合わせ日 ──
                sec('問い合わせ'),
                // 方法選択
                Row(children: ['電話', 'LINE', 'その他'].map((m) {
                  final sel = inquiryMethod == m;
                  return GestureDetector(
                    onTap: () => setS(() => inquiryMethod = m),
                    child: Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      decoration: BoxDecoration(
                        color: sel ? AppColors.info.withValues(alpha: 0.2) : AppColors.navyCard,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                            color: sel ? AppColors.info : AppColors.cardBorder),
                      ),
                      child: Text(m, style: TextStyle(
                          color: sel ? AppColors.info : AppColors.silverDim,
                          fontSize: 12, fontWeight: sel ? FontWeight.w700 : FontWeight.w400)),
                    ),
                  );
                }).toList()),
                const SizedBox(height: 8),
                GestureDetector(
                  onTap: () async { final d = await pickDate(inquiryDate); if (d != null) setS(() => inquiryDate = d); },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: inquiryDate != null ? AppColors.info.withValues(alpha: 0.08) : AppColors.navyCard,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: inquiryDate != null ? AppColors.info.withValues(alpha: 0.5) : AppColors.cardBorder),
                    ),
                    child: Row(children: [
                      Icon(Icons.phone, color: inquiryDate != null ? AppColors.info : AppColors.silverDim, size: 14),
                      const SizedBox(width: 8),
                      Text('問い合わせ日（$inquiryMethod）', style: TextStyle(
                          color: inquiryDate != null ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 13)),
                      const Spacer(),
                      Text(fd(inquiryDate), style: TextStyle(
                          color: inquiryDate != null ? AppColors.info : AppColors.silverDim,
                          fontSize: 13, fontWeight: inquiryDate != null ? FontWeight.w600 : FontWeight.w400)),
                      const SizedBox(width: 4),
                      Icon(Icons.chevron_right,
                          color: inquiryDate != null ? AppColors.info : AppColors.silverDim, size: 16),
                    ]),
                  ),
                ),

                // ── 体験授業 ──
                sec('体験授業'),
                dateTimeRow(
                  label: '体験授業日',
                  date: trialDate, startTime: trialStart, endTime: trialEnd,
                  onDateSet: (d) => trialDate = d,
                  onStartSet: (t) => trialStart = t,
                  onEndSet: (t) => trialEnd = t,
                ),

                // ── 面談 ──
                sec('面談'),
                dateTimeRow(
                  label: '面談日',
                  date: interviewDate, startTime: ivStart, endTime: ivEnd,
                  onDateSet: (d) => interviewDate = d,
                  onStartSet: (t) => ivStart = t,
                  onEndSet: (t) => ivEnd = t,
                ),

                // ── 初回授業 ──
                sec('初回授業'),
                dateTimeRow(
                  label: '初回授業日',
                  date: firstDate, startTime: firstStart, endTime: firstEnd,
                  onDateSet: (d) => firstDate = d,
                  onStartSet: (t) => firstStart = t,
                  onEndSet: (t) => firstEnd = t,
                ),

                // ── 口座登録 ──
                sec('口座登録'),
                dateWithMemo(
                  label: '口座登録完了日',
                  date: bankDate, memoCtrl: bankMemoCtrl,
                  memoHint: '備考（例：ゆうちょ、引き落とし日など）',
                  onDateSet: (d) => bankDate = d,
                ),

                // ── テキスト配布 ──
                sec('テキスト配布'),
                dateWithMemo(
                  label: 'テキスト配布日',
                  date: textDate, memoCtrl: textMemoCtrl,
                  memoHint: '備考（例：数学・英語テキスト配布）',
                  onDateSet: (d) => textDate = d,
                ),

                // ── メモ ──
                sec('メモ'),
                TextField(
                  controller: memoCtrl,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                  maxLines: 3, minLines: 2,
                  decoration: InputDecoration(
                    hintText: '備考・メモを入力',
                    hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
                    filled: true, fillColor: AppColors.navyCard,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ])),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx, rootNavigator: true).pop(),
                  child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
              ElevatedButton(
                onPressed: nameCtrl.text.trim().isEmpty ? null : () {
                  final built = Inquiry(
                    id: isEdit ? inquiry.id : 'inq_${DateTime.now().millisecondsSinceEpoch}',
                    name: nameCtrl.text.trim(),
                    school: schoolCtrl.text.trim(),
                    grade: gradeCtrl.text.trim(),
                    memo: memoCtrl.text.trim(),
                    inquiryDate: inquiryDate,
                    inquiryMethod: inquiryMethod,
                    trialDate: trialDate,
                    trialStartTime: trialStart,
                    trialEndTime: trialEnd,
                    interviewDate: interviewDate,
                    interviewStartTime: ivStart,
                    interviewEndTime: ivEnd,
                    firstLessonDate: firstDate,
                    firstLessonStartTime: firstStart,
                    firstLessonEndTime: firstEnd,
                    bankRegisteredDate: bankDate,
                    bankMemo: bankMemoCtrl.text.trim(),
                    textDeliveredDate: textDate,
                    textMemo: textMemoCtrl.text.trim(),
                    createdAt: isEdit ? inquiry.createdAt : DateTime.now(),
                  );
                  if (isEdit) {
                    provider.updateInquiry(built);
                  } else {
                    provider.addInquiry(built);
                  }
                  Navigator.of(ctx, rootNavigator: true).pop();
                },
                style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.info, foregroundColor: Colors.white),
                child: Text(isEdit ? '保存' : '追加',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          );
        },
      ),
    );
  }

  static Widget _inquiryField(String label, TextEditingController ctrl,
      {String hint = '', void Function(String)? onChanged}) {
    return TextField(
      controller: ctrl,
      onChanged: onChanged,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
        filled: true, fillColor: AppColors.navyCard,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}

/// 問い合わせカード
class _InquiryCard extends StatelessWidget {
  final Inquiry inquiry;
  const _InquiryCard({required this.inquiry});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    String fd(DateTime? d) => d == null ? '―' : '${d.month}/${d.day}';

    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      glowColor: AppColors.info,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // ── ヘッダー行 ──
        Row(children: [
          CircleAvatar(
            radius: 16, backgroundColor: AppColors.info.withValues(alpha: 0.15),
            child: Text(inquiry.name.isNotEmpty ? inquiry.name[0] : '?',
                style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w800, fontSize: 13)),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(inquiry.name,
                style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 14)),
            if (inquiry.school.isNotEmpty || inquiry.grade.isNotEmpty)
              Text('${inquiry.school}　${inquiry.grade}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
            if (inquiry.inquiryDate != null)
              Text('問い合わせ: ${fd(inquiry.inquiryDate)}（${inquiry.inquiryMethod}）',
                  style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ])),
          // 編集ボタン
          Builder(
            builder: (editCtx) => IconButton(
              icon: const Icon(Icons.edit_note, color: AppColors.info, size: 18),
              onPressed: () => _InquirySection._showInquiryDialog(editCtx, provider, inquiry),
              padding: EdgeInsets.zero, constraints: const BoxConstraints(),
            ),
          ),
          const SizedBox(width: 4),
          // 削除ボタン
          Builder(
            builder: (delCtx) => IconButton(
              icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 18),
              onPressed: () => showDialog(
                context: delCtx,
                useRootNavigator: true,
                builder: (c) => AlertDialog(
                  backgroundColor: AppColors.card,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  title: const Text('削除確認', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
                  content: Text('${inquiry.name} の問い合わせを削除しますか？',
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
                  actions: [
                    TextButton(onPressed: () => Navigator.of(c, rootNavigator: true).pop(),
                        child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
                    ElevatedButton(
                      onPressed: () {
                        provider.deleteInquiry(inquiry.id);
                        Navigator.of(c, rootNavigator: true).pop();
                      },
                      style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                      child: const Text('削除'),
                    ),
                  ],
                ),
              ),
              padding: EdgeInsets.zero, constraints: const BoxConstraints(),
            ),
          ),
        ]),
        const SizedBox(height: 10),

        // ── 日程チップ ──
        Wrap(spacing: 6, runSpacing: 6, children: [
          _chip('体験', inquiry.trialDate, inquiry.trialStartTime, inquiry.trialEndTime, fd),
          _chip('面談', inquiry.interviewDate, inquiry.interviewStartTime, inquiry.interviewEndTime, fd),
          _chip('初回授業', inquiry.firstLessonDate, inquiry.firstLessonStartTime, inquiry.firstLessonEndTime, fd),
          _simpleChip('口座登録', inquiry.bankRegisteredDate, fd),
          _simpleChip('テキスト', inquiry.textDeliveredDate, fd),
        ]),

        // ── 入塾ボタン ──
        const SizedBox(height: 10),
        Builder(
          builder: (enrollCtx) => SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () => _showEnrollDialog(enrollCtx, provider),
              icon: const Icon(Icons.school, size: 16),
              label: const Text('入塾登録', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.success,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 10),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ),
      ]),
    );
  }

  // 時間付きチップ
  Widget _chip(String label, DateTime? date, String start, String end, String Function(DateTime?) fd) {
    final has = date != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: has ? AppColors.info.withValues(alpha: 0.12) : AppColors.navyCard,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: has ? AppColors.info.withValues(alpha: 0.4) : AppColors.cardBorder),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9)),
        Text(fd(date), style: TextStyle(
            color: has ? AppColors.info : AppColors.silverDim,
            fontSize: 12, fontWeight: has ? FontWeight.w700 : FontWeight.w400)),
        if (has) Text('$start〜$end',
            style: const TextStyle(color: AppColors.silverDim, fontSize: 9)),
      ]),
    );
  }

  // 日付のみチップ
  Widget _simpleChip(String label, DateTime? date, String Function(DateTime?) fd) {
    final has = date != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: has ? AppColors.success.withValues(alpha: 0.1) : AppColors.navyCard,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: has ? AppColors.success.withValues(alpha: 0.4) : AppColors.cardBorder),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9)),
        Text(fd(date), style: TextStyle(
            color: has ? AppColors.success : AppColors.silverDim,
            fontSize: 12, fontWeight: has ? FontWeight.w700 : FontWeight.w400)),
      ]),
    );
  }

  // ── 入塾登録ダイアログ ──
  void _showEnrollDialog(BuildContext context, AppProvider provider) {
    final schoolCtrl = TextEditingController(text: inquiry.school);
    final gradeCtrl  = TextEditingController(text: inquiry.grade);
    final clubCtrl   = TextEditingController();
    final scoreCtrl  = TextEditingController();
    final targetCtrl = TextEditingController();

    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('${inquiry.name} を入塾登録',
            style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 15)),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('以下の情報で生徒登録します',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            _studentField('学校', schoolCtrl, hint: inquiry.school.isNotEmpty ? inquiry.school : '例：○○中学校'),
            const SizedBox(height: 8),
            _studentField('学年', gradeCtrl, hint: '例：中1'),
            const SizedBox(height: 8),
            _studentField('部活', clubCtrl, hint: '例：サッカー部'),
            const SizedBox(height: 8),
            _studentField('現在の成績', scoreCtrl, hint: '例：オール3'),
            const SizedBox(height: 8),
            _studentField('志望校', targetCtrl, hint: '例：○○高校'),
          ])),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx, rootNavigator: true).pop(),
              child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () {
              // 学年から数値を取り出す（中1→1, 中2→2, 中3→3）
              int? gradeNum;
              final g = gradeCtrl.text.trim();
              if (g.contains('1')) { gradeNum = 1; }
              else if (g.contains('2')) { gradeNum = 2; }
              else if (g.contains('3')) { gradeNum = 3; }

              provider.addStudent(AppUser(
                id: 's_${DateTime.now().millisecondsSinceEpoch}',
                name: inquiry.name,
                role: UserRole.student,
                grade: gradeNum,
                className: schoolCtrl.text.trim(),
              ));
              // 問い合わせから削除
              provider.deleteInquiry(inquiry.id);
              Navigator.of(ctx, rootNavigator: true).pop();

              // 完了スナックバー
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('${inquiry.name} を生徒登録しました'),
                  backgroundColor: AppColors.success,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
            style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.success, foregroundColor: Colors.white),
            child: const Text('入塾登録', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  static Widget _studentField(String label, TextEditingController ctrl, {String hint = ''}) {
    return TextField(
      controller: ctrl,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        labelText: label, hintText: hint,
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
        filled: true, fillColor: AppColors.navyCard,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}

// ============================================================
// 連絡タブ：生徒 / 保護者 / 欠席
// ============================================================
class _AdminContactTab extends StatefulWidget {
  const _AdminContactTab();
  @override
  State<_AdminContactTab> createState() => _AdminContactTabState();
}

class _AdminContactTabState extends State<_AdminContactTab> with SingleTickerProviderStateMixin {
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
    final students = provider.allStudents;
    final unreadStudent = provider.messages.where((m) => !m.isRead).length;
    final unreadParent = provider.unreadParentMessageCount;
    final unreadAbs = provider.unreadAbsenceCount;

    return Column(children: [
      Row(
        children: [
          const Expanded(child: SectionHeader(title: '連絡管理', subtitle: '生徒・保護者からの連絡')),
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: ElevatedButton.icon(
              onPressed: () => _showComposeSheet(context),
              icon: const Icon(Icons.edit_square, size: 15),
              label: const Text('新規作成', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow,
                foregroundColor: AppColors.navyDark,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ),
      Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        decoration: BoxDecoration(
          color: AppColors.navyCard, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: TabBar(
          controller: _tabCtrl,
          indicator: BoxDecoration(color: AppColors.yellow, borderRadius: BorderRadius.circular(10)),
          indicatorPadding: const EdgeInsets.all(4),
          labelColor: AppColors.navyDark,
          unselectedLabelColor: AppColors.silverDim,
          labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
          dividerColor: Colors.transparent,
          tabs: [
            Tab(text: '生徒($unreadStudent)'),
            Tab(text: '保護者($unreadParent)'),
            Tab(text: '欠席($unreadAbs)'),
          ],
        ),
      ),
      Expanded(
        child: TabBarView(controller: _tabCtrl, children: [
          // 生徒リスト
          ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            itemCount: students.length,
            itemBuilder: (_, i) => _ContactStudentTile(
              student: students[i],
              onTap: () => _showStudentSheet(context, students[i]),
            ),
          ),
          // 保護者リスト
          ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            itemCount: students.length,
            itemBuilder: (_, i) => _ContactParentTile(
              student: students[i],
              onTap: () => _showParentSheet(context, students[i]),
            ),
          ),
          // 欠席連絡一覧
          provider.absenceNotifications.isEmpty
              ? const Center(child: EmptyState(message: '欠席連絡はありません', icon: Icons.event_available))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: provider.absenceNotifications.length,
                  itemBuilder: (_, i) {
                    final a = provider.absenceNotifications.reversed.toList()[i];
                    return _AbsenceDetailCard(absence: a);
                  },
                ),
        ]),
      ),
    ]);
  }

  void _showStudentSheet(BuildContext context, AppUser student) {
    showModalBottomSheet(
      context: context, backgroundColor: AppColors.card, isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _StudentDetailSheet(student: student),
    );
  }

  void _showParentSheet(BuildContext context, AppUser student) {
    showModalBottomSheet(
      context: context, backgroundColor: AppColors.card, isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _ParentDetailSheet(student: student),
    );
  }

  void _showComposeSheet(BuildContext context) {
    showModalBottomSheet(
      context: context, backgroundColor: AppColors.card, isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => const _ComposeMessageSheet(),
    );
  }
}

// ── 生徒連絡タイル ──
class _ContactStudentTile extends StatelessWidget {
  final AppUser student;
  final VoidCallback onTap;
  const _ContactStudentTile({required this.student, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final msgs = provider.getMessagesFromStudent(student.id);
    final unread = msgs.where((m) => !m.isRead).length;
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 8), onTap: onTap,
      child: Row(children: [
        CircleAvatar(radius: 22, backgroundColor: AppColors.yellow.withValues(alpha: 0.12),
            child: Text(student.name[0], style: const TextStyle(color: AppColors.yellow, fontSize: 18, fontWeight: FontWeight.w800))),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(student.name, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(width: 6),
            AppChip(label: '中${student.grade ?? '-'}', color: AppColors.info),
            if (unread > 0) ...[const SizedBox(width: 4), AppChip(label: '未読$unread', color: AppColors.danger)],
          ]),
          Text('メッセージ ${msgs.length}件', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        ])),
        const Icon(Icons.chevron_right, color: AppColors.silverDim),
      ]),
    );
  }
}

// ── 保護者連絡タイル ──
class _ContactParentTile extends StatelessWidget {
  final AppUser student;
  final VoidCallback onTap;
  const _ContactParentTile({required this.student, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final msgs = provider.getParentMessagesForStudent(student.id);
    final unread = msgs.where((m) => !m.isRead).length;
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 8), onTap: onTap,
      child: Row(children: [
        CircleAvatar(radius: 22, backgroundColor: AppColors.success.withValues(alpha: 0.12),
            child: Text(student.name[0], style: const TextStyle(color: AppColors.success, fontSize: 18, fontWeight: FontWeight.w800))),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('${student.name}の保護者', style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
            if (unread > 0) ...[const SizedBox(width: 6), AppChip(label: '未読$unread', color: AppColors.danger)],
          ]),
          Text('メッセージ ${msgs.length}件', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        ])),
        const Icon(Icons.chevron_right, color: AppColors.silverDim),
      ]),
    );
  }
}

// ── 欠席詳細カード ──
class _AbsenceDetailCard extends StatelessWidget {
  final AbsenceNotification absence;
  const _AbsenceDetailCard({required this.absence});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 8),
      glowColor: absence.isRead ? AppColors.cardBorder : AppColors.warning,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.event_busy, color: AppColors.warning, size: 18),
          const SizedBox(width: 8),
          Text('${absence.studentName}　${absence.subject}',
              style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
          const Spacer(),
          AppChip(label: absence.sender == 'parent' ? '保護者' : '生徒', color: AppColors.info),
        ]),
        const SizedBox(height: 4),
        Text('${absence.lessonDate.month}/${absence.lessonDate.day}　理由: ${absence.reason}',
            style: const TextStyle(color: AppColors.warning, fontSize: 12)),
        Text('送信: ${absence.senderName}', style: const TextStyle(color: AppColors.silverDim, fontSize: 11)),
        if (!absence.isRead) ...[
          const SizedBox(height: 6),
          SizedBox(width: double.infinity, child: OutlinedButton(
            onPressed: () => provider.markAbsenceRead(absence.id),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.warning, side: const BorderSide(color: AppColors.warning),
              minimumSize: const Size(0, 34), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('確認済みにする', style: TextStyle(fontSize: 12)),
          )),
        ],
      ]),
    );
  }
}

// ── 生徒詳細シート（双方向チャット）──
class _StudentDetailSheet extends StatefulWidget {
  final AppUser student;
  const _StudentDetailSheet({required this.student});
  @override
  State<_StudentDetailSheet> createState() => _StudentDetailSheetState();
}

class _StudentDetailSheetState extends State<_StudentDetailSheet> {
  final _scrollCtrl = ScrollController();

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final msgs = provider.getMessagesFromStudent(widget.student.id);
    final replies = provider.getAdminReplies('student', widget.student.id);

    // 時系列で合成
    final allItems = [
      ...msgs.map((m) => _ChatItem(isAdmin: false, name: m.fromName, text: m.text ?? '', time: m.createdAt,
          isRead: m.isRead, onRead: () => provider.markMessageRead(m.id))),
      ...replies.map((r) => _ChatItem(isAdmin: true, name: '管理者', text: r.text,
          imageBytes: r.imageBytes, imageUrl: r.imageUrl, time: r.createdAt, isRead: true)),
    ]..sort((a, b) => a.time.compareTo(b.time));

    return DraggableScrollableSheet(
      initialChildSize: 0.85, maxChildSize: 0.95, minChildSize: 0.5, expand: false,
      builder: (_, __) => Column(children: [
        // ヘッダー
        Center(child: Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: AppColors.cardBorder, borderRadius: BorderRadius.circular(2)))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Row(children: [
          CircleAvatar(radius: 20, backgroundColor: AppColors.yellow.withValues(alpha: 0.15),
              child: Text(widget.student.name[0], style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w800))),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.student.name, style: const TextStyle(color: AppColors.yellow, fontSize: 15, fontWeight: FontWeight.w800)),
            Text('中${widget.student.grade ?? '-'}年生　生徒チャット',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ]),
          const Spacer(),
          IconButton(icon: const Icon(Icons.close, color: AppColors.silverDim, size: 20),
              onPressed: () => Navigator.pop(context)),
        ])),
        const Divider(color: AppColors.cardBorder, height: 1),
        // チャット一覧
        Expanded(
          child: allItems.isEmpty
              ? const Center(child: EmptyState(message: 'メッセージはまだありません', icon: Icons.chat_bubble_outline))
              : ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  itemCount: allItems.length,
                  itemBuilder: (_, i) => _ChatBubble(item: allItems[i]),
                ),
        ),
        // 返信入力エリア
        _ReplyInputBar(
          accentColor: AppColors.yellow,
          hintText: '${widget.student.name}さんへ返信...',
          onSend: (text, bytes) {
            if (text.isNotEmpty || bytes != null) {
              provider.sendAdminReply(AdminReply(
                id: 'ar_${DateTime.now().millisecondsSinceEpoch}',
                threadType: 'student',
                threadId: widget.student.id,
                text: text.isNotEmpty ? text : '📷 画像を送信しました',
                imageBytes: bytes,
                createdAt: DateTime.now(),
              ));
              _scrollToBottom();
            }
          },
        ),
      ]),
    );
  }
}

// ── 保護者詳細シート（双方向チャット）──
class _ParentDetailSheet extends StatefulWidget {
  final AppUser student;
  const _ParentDetailSheet({required this.student});
  @override
  State<_ParentDetailSheet> createState() => _ParentDetailSheetState();
}

class _ParentDetailSheetState extends State<_ParentDetailSheet> {
  final _scrollCtrl = ScrollController();

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final msgs = provider.getParentMessagesForStudent(widget.student.id);
    final replies = provider.getAdminReplies('parent', widget.student.id);
    final absences = provider.getAbsencesForStudent(widget.student.id)
        .where((a) => a.sender == 'parent').toList();

    final allItems = [
      ...msgs.map((m) => _ChatItem(isAdmin: false, name: '${m.fromName}（保護者）', text: m.text ?? '', time: m.createdAt,
          isRead: m.isRead, onRead: () => provider.markParentMessageRead(m.id))),
      ...replies.map((r) => _ChatItem(isAdmin: true, name: '管理者', text: r.text,
          imageUrl: r.imageUrl, imageBytes: r.imageBytes, time: r.createdAt, isRead: true)),
    ]..sort((a, b) => a.time.compareTo(b.time));

    return DraggableScrollableSheet(
      initialChildSize: 0.85, maxChildSize: 0.95, minChildSize: 0.5, expand: false,
      builder: (_, __) => Column(children: [
        Center(child: Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: AppColors.cardBorder, borderRadius: BorderRadius.circular(2)))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Row(children: [
          CircleAvatar(radius: 20, backgroundColor: AppColors.success.withValues(alpha: 0.15),
              child: Text(widget.student.name[0], style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w800))),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${widget.student.name}の保護者', style: const TextStyle(color: AppColors.success, fontSize: 15, fontWeight: FontWeight.w800)),
            const Text('保護者チャット', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ]),
          const Spacer(),
          IconButton(icon: const Icon(Icons.close, color: AppColors.silverDim, size: 20),
              onPressed: () => Navigator.pop(context)),
        ])),
        // 欠席連絡バナー
        if (absences.any((a) => !a.isRead))
          Container(
            width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: AppColors.warning.withValues(alpha: 0.12),
            child: Row(children: [
              const Icon(Icons.event_busy, color: AppColors.warning, size: 14),
              const SizedBox(width: 6),
              Text('未確認の欠席連絡 ${absences.where((a) => !a.isRead).length}件',
                  style: const TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w700)),
              const Spacer(),
              TextButton(onPressed: () {
                for (final a in absences.where((a) => !a.isRead)) {
                  provider.markAbsenceRead(a.id);
                }
              }, child: const Text('すべて確認済みに', style: TextStyle(color: AppColors.warning, fontSize: 11))),
            ]),
          ),
        const Divider(color: AppColors.cardBorder, height: 1),
        Expanded(
          child: allItems.isEmpty
              ? const Center(child: EmptyState(message: 'メッセージはまだありません', icon: Icons.chat_bubble_outline))
              : ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  itemCount: allItems.length,
                  itemBuilder: (_, i) => _ChatBubble(item: allItems[i]),
                ),
        ),
        _ReplyInputBar(
          accentColor: AppColors.success,
          hintText: '${widget.student.name}の保護者へ返信...',
          onSend: (text, bytes) {
            if (text.isNotEmpty || bytes != null) {
              provider.sendAdminReply(AdminReply(
                id: 'ar_${DateTime.now().millisecondsSinceEpoch}',
                threadType: 'parent',
                threadId: widget.student.id,
                text: text.isNotEmpty ? text : '📷 画像を送信しました',
                imageBytes: bytes,
                createdAt: DateTime.now(),
              ));
              _scrollToBottom();
            }
          },
        ),
      ]),
    );
  }
}

// ============================================================
// チャットUI共通ウィジェット
// ============================================================

/// チャット1件のデータ
class _ChatItem {
  final bool isAdmin;
  final String name;
  final String text;
  final String? imageUrl;       // 画像URL（後方互換）
  final List<int>? imageBytes;  // バイナリ画像（カメラロール）
  final DateTime time;
  final bool isRead;
  final VoidCallback? onRead;
  _ChatItem({required this.isAdmin, required this.name, required this.text,
    this.imageUrl, this.imageBytes, required this.time, required this.isRead, this.onRead});
}

/// チャットバブル（左=相手、右=管理者）
class _ChatBubble extends StatelessWidget {
  final _ChatItem item;
  const _ChatBubble({required this.item});

  @override
  Widget build(BuildContext context) {
    final timeStr = _fmtTime(item.time);
    if (item.isAdmin) {
      // 右側：管理者（自分）
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
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
                  boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.2), blurRadius: 6, offset: const Offset(0, 2))],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (item.imageBytes != null) ...[
                      GestureDetector(
                        onTap: () => _showImageDialog(context, bytes: Uint8List.fromList(item.imageBytes!)),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            Uint8List.fromList(item.imageBytes!),
                            width: 200, fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      if (item.text != '📷 画像を送信しました') const SizedBox(height: 6),
                    ] else if (item.imageUrl != null) ...[
                      GestureDetector(
                        onTap: () => _showImageDialog(context, url: item.imageUrl),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            item.imageUrl!,
                            width: 200, fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              width: 200, height: 80,
                              color: AppColors.navyCard,
                              child: const Center(child: Icon(Icons.broken_image, color: AppColors.silverDim)),
                            ),
                          ),
                        ),
                      ),
                      if (item.text != '📷 画像を送信しました') const SizedBox(height: 6),
                    ],
                    if (item.text != '📷 画像を送信しました' || (item.imageBytes == null && item.imageUrl == null))
                      Text(item.text, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.5)),
                  ],
                ),
              ),
            ),
          ]),
        ]),
      );
    } else {
      // 左側：相手（生徒/保護者）
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.person, color: AppColors.info, size: 12),
            const SizedBox(width: 4),
            Text(item.name, style: const TextStyle(color: AppColors.info, fontSize: 11, fontWeight: FontWeight.w600)),
            const SizedBox(width: 6),
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
            if (!item.isRead) ...[
              const SizedBox(width: 6),
              GestureDetector(
                onTap: item.onRead,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.danger, borderRadius: BorderRadius.circular(6)),
                  child: const Text('未読 タップで既読', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700)),
                ),
              ),
            ],
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
                  border: Border.all(color: item.isRead ? AppColors.cardBorder : AppColors.info.withValues(alpha: 0.5)),
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

  String _fmtTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'たった今';
    if (diff.inMinutes < 60) return '${diff.inMinutes}分前';
    if (diff.inHours < 24) return '${diff.inHours}時間前';
    return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _showImageDialog(BuildContext context, {Uint8List? bytes, String? url}) {
    showDialog(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.transparent,
        child: GestureDetector(
          onTap: () => Navigator.pop(context),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: bytes != null
                ? Image.memory(bytes, fit: BoxFit.contain)
                : Image.network(url!, fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, color: Colors.white, size: 64)),
          ),
        ),
      ),
    );
  }
}

/// 返信入力バー（ImagePicker対応・StatefulWidget）
class _ReplyInputBar extends StatefulWidget {
  final Color accentColor;
  final String hintText;
  final void Function(String text, List<int>? imageBytes) onSend;
  const _ReplyInputBar({
    required this.accentColor,
    required this.hintText,
    required this.onSend,
  });
  @override
  State<_ReplyInputBar> createState() => _ReplyInputBarState();
}

class _ReplyInputBarState extends State<_ReplyInputBar> {
  final _ctrl = TextEditingController();
  Uint8List? _imageBytes;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    try {
      if (kIsWeb) {
        final uploadInput = html.FileUploadInputElement()..accept = 'image/*';
        uploadInput.click();
        await uploadInput.onChange.first;
        if (uploadInput.files!.isEmpty) return;
        final file = uploadInput.files![0];
        final reader = html.FileReader();
        reader.readAsArrayBuffer(file);
        await reader.onLoad.first;
        final bytes = Uint8List.fromList(reader.result as List<int>);
        setState(() => _imageBytes = bytes);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('画像の読み込みに失敗しました')),
        );
      }
    }
  }

  void _send() {
    final text = _ctrl.text.trim();
    if (text.isEmpty && _imageBytes == null) return;
    widget.onSend(text, _imageBytes != null ? List<int>.from(_imageBytes!) : null);
    _ctrl.clear();
    setState(() => _imageBytes = null);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 10, 12, MediaQuery.of(context).viewInsets.bottom + 10),
      decoration: const BoxDecoration(
        color: AppColors.navyDark,
        border: Border(top: BorderSide(color: AppColors.cardBorder, width: 0.5)),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (_imageBytes != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.memory(_imageBytes!, width: 72, height: 72, fit: BoxFit.cover),
              ),
              const SizedBox(width: 8),
              Expanded(child: Text('画像を添付中', style: TextStyle(color: widget.accentColor, fontSize: 12))),
              IconButton(
                onPressed: () => setState(() => _imageBytes = null),
                icon: const Icon(Icons.close, color: AppColors.silverDim, size: 18),
              ),
            ]),
          ),
        Row(children: [
          GestureDetector(
            onTap: _pickImage,
            child: Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: AppColors.navyCard, shape: BoxShape.circle,
                border: Border.all(color: AppColors.cardBorder),
              ),
              child: Icon(Icons.image_outlined, color: widget.accentColor, size: 20),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: _ctrl,
              maxLines: 3, minLines: 1,
              decoration: InputDecoration(
                hintText: widget.hintText,
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
            onTap: _send,
            child: Container(
              width: 44, height: 44,
              decoration: BoxDecoration(color: widget.accentColor, shape: BoxShape.circle),
              child: const Icon(Icons.send_rounded, color: AppColors.navyDark, size: 20),
            ),
          ),
        ]),
      ]),
    );
  }
}

// ============================================================
// 新規メッセージ作成ボトムシート
// ============================================================
class _ComposeMessageSheet extends StatefulWidget {
  const _ComposeMessageSheet();
  @override
  State<_ComposeMessageSheet> createState() => _ComposeMessageSheetState();
}

class _ComposeMessageSheetState extends State<_ComposeMessageSheet> {
  String _targetType = 'student';
  final Set<String> _selectedIds = {};
  final _bodyCtrl = TextEditingController();
  Uint8List? _imageBytes;
  bool _selectAll = false;

  @override
  void dispose() {
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    try {
      if (kIsWeb) {
        final uploadInput = html.FileUploadInputElement()..accept = 'image/*';
        uploadInput.click();
        await uploadInput.onChange.first;
        if (uploadInput.files!.isEmpty) return;
        final file = uploadInput.files![0];
        final reader = html.FileReader();
        reader.readAsArrayBuffer(file);
        await reader.onLoad.first;
        final bytes = Uint8List.fromList(reader.result as List<int>);
        setState(() => _imageBytes = bytes);
      }
    } catch (_) {}
  }

  void _toggleAll(List<AppUser> targets) {
    setState(() {
      _selectAll = !_selectAll;
      if (_selectAll) {
        _selectedIds.addAll(targets.map((t) => t.id));
      } else {
        _selectedIds.clear();
      }
    });
  }

  void _send(BuildContext context) {
    final text = _bodyCtrl.text.trim();
    if (_selectedIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('送信先を1人以上選択してください')));
      return;
    }
    if (text.isEmpty && _imageBytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('本文または画像を入力してください')));
      return;
    }
    context.read<AppProvider>().sendAdminMessage(
      targetType: _targetType,
      targetIds: _selectedIds.toList(),
      text: text.isEmpty ? '📷 画像を送信しました' : text,
      imageBytes: _imageBytes != null ? List<int>.from(_imageBytes!) : null,
    );
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${_selectedIds.length}名に送信しました')));
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final students = provider.allStudents;
    final targets = students;

    return DraggableScrollableSheet(
      initialChildSize: 0.85, maxChildSize: 0.95, minChildSize: 0.5, expand: false,
      builder: (_, sc) => Column(children: [
        Center(child: Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: AppColors.cardBorder, borderRadius: BorderRadius.circular(2)))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: Row(children: [
          const Icon(Icons.edit_square, color: AppColors.yellow, size: 18),
          const SizedBox(width: 8),
          const Text('新規メッセージ作成',
              style: TextStyle(color: AppColors.yellow, fontSize: 15, fontWeight: FontWeight.w800)),
          const Spacer(),
          IconButton(icon: const Icon(Icons.close, color: AppColors.silverDim, size: 20),
              onPressed: () => Navigator.pop(context)),
        ])),
        const Divider(color: AppColors.cardBorder, height: 1),
        Expanded(
          child: SingleChildScrollView(
            controller: sc,
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // 送信先種別
              const Text('送信先', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Row(children: [
                _TypeChip(
                  label: '生徒', icon: Icons.school,
                  selected: _targetType == 'student', color: AppColors.yellow,
                  onTap: () => setState(() { _targetType = 'student'; _selectedIds.clear(); _selectAll = false; }),
                ),
                const SizedBox(width: 10),
                _TypeChip(
                  label: '保護者', icon: Icons.family_restroom,
                  selected: _targetType == 'parent', color: AppColors.success,
                  onTap: () => setState(() { _targetType = 'parent'; _selectedIds.clear(); _selectAll = false; }),
                ),
              ]),
              const SizedBox(height: 14),
              // 個別選択
              Row(children: [
                Text('個別選択', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton(
                  onPressed: () => _toggleAll(targets),
                  child: Text(_selectAll ? '選択解除' : '全選択',
                      style: TextStyle(color: _targetType == 'student' ? AppColors.yellow : AppColors.success, fontSize: 12)),
                ),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 8, runSpacing: 6, children: targets.map((t) {
                final sel = _selectedIds.contains(t.id);
                final color = _targetType == 'student' ? AppColors.yellow : AppColors.success;
                return GestureDetector(
                  onTap: () => setState(() {
                    if (sel) { _selectedIds.remove(t.id); _selectAll = false; }
                    else { _selectedIds.add(t.id); }
                  }),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: sel ? color.withValues(alpha: 0.2) : AppColors.navyCard,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: sel ? color : AppColors.cardBorder),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (sel) Icon(Icons.check_circle, color: color, size: 14),
                      if (sel) const SizedBox(width: 4),
                      Text('${_targetType == 'student' ? t.name : '${t.name}の保護者'}',
                          style: TextStyle(color: sel ? color : AppColors.textSecondary, fontSize: 12, fontWeight: sel ? FontWeight.w700 : FontWeight.w400)),
                    ]),
                  ),
                );
              }).toList()),
              const SizedBox(height: 14),
              // 本文
              const Text('本文', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextField(
                controller: _bodyCtrl,
                maxLines: 5, minLines: 3,
                decoration: InputDecoration(
                  hintText: 'メッセージを入力...',
                  hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 13),
                  filled: true, fillColor: AppColors.navyCard,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.all(14),
                ),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              ),
              const SizedBox(height: 12),
              // 画像添付
              if (_imageBytes != null) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.memory(_imageBytes!, height: 140, width: double.infinity, fit: BoxFit.cover),
                ),
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.check_circle, color: AppColors.success, size: 14),
                  const SizedBox(width: 4),
                  const Text('画像添付済み', style: TextStyle(color: AppColors.success, fontSize: 12)),
                  const Spacer(),
                  TextButton(onPressed: () => setState(() => _imageBytes = null),
                      child: const Text('削除', style: TextStyle(color: AppColors.danger, fontSize: 12))),
                ]),
              ] else
                OutlinedButton.icon(
                  onPressed: _pickImage,
                  icon: const Icon(Icons.image_outlined, size: 16),
                  label: const Text('画像を添付', style: TextStyle(fontSize: 13)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.silverDim,
                    side: const BorderSide(color: AppColors.cardBorder),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  ),
                ),
              const SizedBox(height: 20),
              // 送信ボタン
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _send(context),
                  icon: const Icon(Icons.send_rounded, size: 18),
                  label: Text(
                    _selectedIds.isEmpty ? '送信先を選択してください' : '${_selectedIds.length}名に送信',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _selectedIds.isEmpty ? AppColors.silverDim : AppColors.yellow,
                    foregroundColor: AppColors.navyDark,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _TypeChip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _TypeChip({required this.label, required this.icon, required this.selected, required this.color, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.15) : AppColors.navyCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? color : AppColors.cardBorder, width: selected ? 1.5 : 1),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, color: selected ? color : AppColors.silverDim, size: 16),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(color: selected ? color : AppColors.silverDim,
              fontSize: 13, fontWeight: selected ? FontWeight.w700 : FontWeight.w400)),
        ]),
      ),
    );
  }
}

// ============================================================
// 進捗管理タブ
// ============================================================
class _AdminProgressTab extends StatefulWidget {
  const _AdminProgressTab();
  @override
  State<_AdminProgressTab> createState() => _AdminProgressTabState();
}

class _AdminProgressTabState extends State<_AdminProgressTab> {
  String? _selectedStudentId;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final students = provider.allStudents;
    final cats = provider.progressCategories;
    final selectedId = _selectedStudentId ?? (students.isNotEmpty ? students.first.id : null);

    return Column(children: [
      SizedBox(
        height: 52,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          itemCount: students.length,
          itemBuilder: (_, i) {
            final s = students[i];
            final sel = selectedId == s.id;
            return GestureDetector(
              onTap: () => setState(() => _selectedStudentId = s.id),
              child: Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: sel ? AppColors.yellow : AppColors.navyCard,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: sel ? AppColors.yellow : AppColors.cardBorder),
                ),
                child: Text(s.name, style: TextStyle(
                  color: sel ? AppColors.navyDark : AppColors.textPrimary,
                  fontWeight: sel ? FontWeight.w700 : FontWeight.w400, fontSize: 12,
                )),
              ),
            );
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: OutlinedButton.icon(
          onPressed: () => _showAddCategoryDialog(context),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('進捗項目を追加'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.yellow, side: const BorderSide(color: AppColors.yellow),
            minimumSize: const Size(double.infinity, 42),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      ),
      Expanded(
        child: selectedId == null
            ? const EmptyState(message: '生徒を選択してください')
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: cats.length,
                itemBuilder: (_, i) => _AdminCategorySection(category: cats[i], studentId: selectedId),
              ),
      ),
    ]);
  }

  void _showAddCategoryDialog(BuildContext context) {
    final provider = context.read<AppProvider>();
    final subjectCtrl = TextEditingController();
    final itemCtrl = TextEditingController();
    DateTime? deadline;
    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          backgroundColor: AppColors.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('進捗項目追加', style: TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700)),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: subjectCtrl, decoration: const InputDecoration(labelText: '教科名'),
                style: const TextStyle(color: AppColors.textPrimary)),
            const SizedBox(height: 12),
            TextField(controller: itemCtrl, decoration: const InputDecoration(labelText: '項目名'),
                style: const TextStyle(color: AppColors.textPrimary)),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: () async {
                final picked = await showDatePicker(
                  context: ctx,
                  initialDate: DateTime.now().add(const Duration(days: 7)),
                  firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 90)),
                  builder: (c, child) => Theme(
                    data: ThemeData.dark().copyWith(colorScheme: const ColorScheme.dark(primary: AppColors.yellow)),
                    child: child!,
                  ),
                );
                if (picked != null) setS(() => deadline = picked);
              },
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.cardBorder)),
                child: Row(children: [
                  const Icon(Icons.calendar_today, color: AppColors.yellow, size: 16),
                  const SizedBox(width: 8),
                  Text(deadline != null ? '締切: ${deadline!.month}/${deadline!.day}' : '締切日を選択',
                      style: const TextStyle(color: AppColors.textPrimary)),
                ]),
              ),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx),
                child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
            ElevatedButton(
              onPressed: () {
                if (subjectCtrl.text.isNotEmpty && itemCtrl.text.isNotEmpty) {
                  final existing = provider.progressCategories.where((c) => c.subject == subjectCtrl.text).firstOrNull;
                  if (existing != null) {
                    provider.addProgressItem(existing.id, ProgressItem(
                      id: 'pi_${DateTime.now().millisecondsSinceEpoch}',
                      categoryId: existing.id, title: itemCtrl.text, deadline: deadline,
                    ));
                  } else {
                    final catId = 'pc_${DateTime.now().millisecondsSinceEpoch}';
                    provider.addProgressCategory(ProgressCategory(
                      id: catId, subject: subjectCtrl.text,
                      items: [ProgressItem(id: 'pi_${DateTime.now().millisecondsSinceEpoch}',
                          categoryId: catId, title: itemCtrl.text, deadline: deadline)],
                    ));
                  }
                  Navigator.pop(ctx);
                }
              },
              child: const Text('追加'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminCategorySection extends StatelessWidget {
  final ProgressCategory category;
  final String studentId;
  const _AdminCategorySection({required this.category, required this.studentId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final total = category.items.length;
    final done = category.items.where((i) => provider.isItemCompleted(studentId, i.id)).length;
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(category.subject, style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 15)),
          const Spacer(),
          Text('$done / $total', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ]),
        const SizedBox(height: 6),
        AnimatedProgressBar(value: total > 0 ? done / total : 0, height: 5),
        const SizedBox(height: 10),
        ...category.items.map((item) {
          final isCompleted = provider.isItemCompleted(studentId, item.id);
          final isOverdue = item.isOverdue;
          return ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            leading: GestureDetector(
              onTap: () => provider.toggleProgress(studentId, item.id),
              child: Container(
                width: 26, height: 26,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCompleted ? AppColors.success : Colors.transparent,
                  border: Border.all(
                    color: isCompleted ? AppColors.success : isOverdue ? AppColors.danger : AppColors.silverDim,
                    width: 2,
                  ),
                ),
                child: isCompleted
                    ? const Icon(Icons.check, size: 14, color: Colors.white)
                    : const Icon(Icons.add, size: 12, color: AppColors.silverDim),
              ),
            ),
            title: Text(item.title, style: TextStyle(
              color: isCompleted ? AppColors.textSecondary : isOverdue ? AppColors.danger : AppColors.textPrimary,
              fontSize: 13, decoration: isCompleted ? TextDecoration.lineThrough : null,
            )),
            subtitle: item.deadline != null
                ? Text(isOverdue ? '⚠ 期限超過' : '締切: ${item.deadline!.month}/${item.deadline!.day}',
                    style: TextStyle(color: isOverdue ? AppColors.danger : AppColors.textSecondary, fontSize: 10))
                : null,
          );
        }),
      ]),
    );
  }
}

// ============================================================
// ============================================================
// お知らせ送信タブ（管理者→生徒/保護者/講師）
// ============================================================
class _AdminAnnouncementTab extends StatefulWidget {
  const _AdminAnnouncementTab();
  @override
  State<_AdminAnnouncementTab> createState() => _AdminAnnouncementTabState();
}

class _AdminAnnouncementTabState extends State<_AdminAnnouncementTab> {
  final _titleCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();

  // 添付画像（カメラロール / ファイル選択から取得したバイナリ）
  Uint8List? _pickedImageBytes;
  String? _pickedImageName;

  // 宛先ロール選択
  bool _toStudents = true;
  bool _toParents = false;
  bool _toTeachers = false;

  // 個別選択モード（空=全員）
  bool _selectIndividual = false;
  final Set<String> _selectedStudentIds = {};
  final Set<String> _selectedTeacherIds = {};

  // 送信済みリスト表示
  bool _showSent = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  // 画像ピッカーを開く（Web対応）
  Future<void> _pickImage() async {
    try {
      if (kIsWeb) {
        final uploadInput = html.FileUploadInputElement()..accept = 'image/*';
        uploadInput.click();
        await uploadInput.onChange.first;
        if (uploadInput.files!.isEmpty) return;
        final file = uploadInput.files![0];
        final reader = html.FileReader();
        reader.readAsArrayBuffer(file);
        await reader.onLoad.first;
        final bytes = Uint8List.fromList(reader.result as List<int>);
        setState(() {
          _pickedImageBytes = bytes;
          _pickedImageName = file.name;
        });
      }
    } catch (_) {}
  }

  void _send(BuildContext context) {
    final title = _titleCtrl.text.trim();
    final body = _bodyCtrl.text.trim();
    if (title.isEmpty || body.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('タイトルと本文を入力してください'), behavior: SnackBarBehavior.floating),
      );
      return;
    }

    final roles = <String>[];
    if (_toStudents) roles.add('student');
    if (_toParents) roles.add('parent');
    if (_toTeachers) roles.add('teacher');
    if (roles.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('宛先を1つ以上選択してください'), behavior: SnackBarBehavior.floating),
      );
      return;
    }

    final targetIds = _selectIndividual
        ? {..._selectedStudentIds, ..._selectedTeacherIds}.toList()
        : <String>[];

    context.read<AppProvider>().addAnnouncement(Announcement(
      id: 'ann_${DateTime.now().millisecondsSinceEpoch}',
      title: title,
      body: body,
      imageBytes: _pickedImageBytes != null
          ? List<int>.from(_pickedImageBytes!)
          : null,
      targetRoles: roles,
      targetUserIds: targetIds,
      createdAt: DateTime.now(),
    ));

    _titleCtrl.clear();
    _bodyCtrl.clear();
    setState(() {
      _pickedImageBytes = null;
      _pickedImageName = null;
      _selectedStudentIds.clear();
      _selectedTeacherIds.clear();
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('✅ お知らせを送信しました'),
        backgroundColor: AppColors.success,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final announcements = provider.announcements;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── 送信フォーム ──
          const SectionHeader(title: 'お知らせ送信', subtitle: '生徒・保護者・講師にお知らせを配信'),

          GlowCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // タイトル
                const Text('タイトル', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: _titleCtrl,
                  decoration: InputDecoration(
                    hintText: '例：夏期講習のお知らせ',
                    hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 13),
                    filled: true, fillColor: AppColors.navyCard,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                ),
                const SizedBox(height: 14),

                // 本文
                const Text('本文', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: _bodyCtrl,
                  maxLines: 5,
                  decoration: InputDecoration(
                    hintText: 'お知らせ内容を入力してください...',
                    hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 13),
                    filled: true, fillColor: AppColors.navyCard,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5),
                ),
                const SizedBox(height: 14),

                // 添付画像（カメラロール / ファイル選択）
                Row(children: [
                  const Icon(Icons.photo_library_outlined, color: AppColors.info, size: 14),
                  const SizedBox(width: 4),
                  const Text('添付画像（任意）', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ]),
                const SizedBox(height: 6),
                // 画像未選択 → 選択ボタン
                if (_pickedImageBytes == null)
                  OutlinedButton.icon(
                    onPressed: _pickImage,
                    icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
                    label: const Text('カメラロールから選択'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.info,
                      side: const BorderSide(color: AppColors.info),
                      minimumSize: const Size(double.infinity, 44),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                  )
                // 画像選択済み → プレビュー表示
                else
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.memory(
                          Uint8List.fromList(_pickedImageBytes!),
                          height: 160,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
                      // ファイル名
                      Positioned(
                        bottom: 0, left: 0, right: 0,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            borderRadius: const BorderRadius.only(
                              bottomLeft: Radius.circular(10),
                              bottomRight: Radius.circular(10),
                            ),
                          ),
                          child: Row(children: [
                            const Icon(Icons.image, color: Colors.white70, size: 12),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                _pickedImageName ?? '画像',
                                style: const TextStyle(
                                    color: Colors.white70, fontSize: 11),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            // 選択し直しボタン
                            GestureDetector(
                              onTap: _pickImage,
                              child: const Text('変更',
                                  style: TextStyle(
                                      color: AppColors.info,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700)),
                            ),
                            const SizedBox(width: 8),
                            // 削除ボタン
                            GestureDetector(
                              onTap: () => setState(() {
                                _pickedImageBytes = null;
                                _pickedImageName = null;
                              }),
                              child: const Icon(Icons.close,
                                  color: Colors.white70, size: 16),
                            ),
                          ]),
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 16),

                // 宛先ロール選択
                const Text('送信先', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    _RoleChip(label: '生徒', selected: _toStudents, color: AppColors.yellow,
                        onTap: () => setState(() => _toStudents = !_toStudents)),
                    _RoleChip(label: '保護者', selected: _toParents, color: AppColors.info,
                        onTap: () => setState(() => _toParents = !_toParents)),
                    _RoleChip(label: '講師', selected: _toTeachers, color: AppColors.success,
                        onTap: () => setState(() => _toTeachers = !_toTeachers)),
                  ],
                ),
                const SizedBox(height: 14),

                // 個別選択トグル
                Row(
                  children: [
                    Switch(
                      value: _selectIndividual,
                      onChanged: (v) => setState(() => _selectIndividual = v),
                      activeColor: AppColors.yellow,
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('個別選択', style: TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
                        Text('オフ=選択したロール全員に送信', style: TextStyle(color: AppColors.silverDim, fontSize: 11)),
                      ]),
                    ),
                  ],
                ),

                // 個別選択UI
                if (_selectIndividual) ...[
                  const SizedBox(height: 12),
                  if (_toStudents) ...[
                    const Text('生徒を選択', style: TextStyle(color: AppColors.yellow, fontSize: 12, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6, runSpacing: 6,
                      children: provider.allStudents.map((s) {
                        final selected = _selectedStudentIds.contains(s.id);
                        return GestureDetector(
                          onTap: () => setState(() {
                            if (selected) { _selectedStudentIds.remove(s.id); }
                            else { _selectedStudentIds.add(s.id); }
                          }),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: selected ? AppColors.yellow.withValues(alpha: 0.2) : AppColors.navyCard,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: selected ? AppColors.yellow : AppColors.cardBorder),
                            ),
                            child: Text(s.name, style: TextStyle(
                              color: selected ? AppColors.yellow : AppColors.textSecondary,
                              fontSize: 12, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                            )),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 8),
                    // 全生徒一括ボタン
                    OutlinedButton.icon(
                      onPressed: () => setState(() {
                        if (_selectedStudentIds.length == provider.allStudents.length) {
                          _selectedStudentIds.clear();
                        } else {
                          _selectedStudentIds.addAll(provider.allStudents.map((s) => s.id));
                        }
                      }),
                      icon: Icon(
                        _selectedStudentIds.length == provider.allStudents.length
                            ? Icons.deselect : Icons.select_all,
                        size: 16, color: AppColors.yellow,
                      ),
                      label: Text(
                        _selectedStudentIds.length == provider.allStudents.length
                            ? '全生徒の選択を解除' : '全生徒を選択',
                        style: const TextStyle(color: AppColors.yellow, fontSize: 12),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.yellow),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_toTeachers) ...[
                    const Text('講師を選択', style: TextStyle(color: AppColors.success, fontSize: 12, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6, runSpacing: 6,
                      children: provider.allTeachers.map((t) {
                        final selected = _selectedTeacherIds.contains(t.id);
                        return GestureDetector(
                          onTap: () => setState(() {
                            if (selected) { _selectedTeacherIds.remove(t.id); }
                            else { _selectedTeacherIds.add(t.id); }
                          }),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: selected ? AppColors.success.withValues(alpha: 0.2) : AppColors.navyCard,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: selected ? AppColors.success : AppColors.cardBorder),
                            ),
                            child: Text(t.name, style: TextStyle(
                              color: selected ? AppColors.success : AppColors.textSecondary,
                              fontSize: 12, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                            )),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 8),
                    // 全講師一括ボタン
                    OutlinedButton.icon(
                      onPressed: () => setState(() {
                        if (_selectedTeacherIds.length == provider.allTeachers.length) {
                          _selectedTeacherIds.clear();
                        } else {
                          _selectedTeacherIds.addAll(provider.allTeachers.map((t) => t.id));
                        }
                      }),
                      icon: Icon(
                        _selectedTeacherIds.length == provider.allTeachers.length
                            ? Icons.deselect : Icons.select_all,
                        size: 16, color: AppColors.success,
                      ),
                      label: Text(
                        _selectedTeacherIds.length == provider.allTeachers.length
                            ? '全講師の選択を解除' : '全講師を選択',
                        style: const TextStyle(color: AppColors.success, fontSize: 12),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.success),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                ],
                const SizedBox(height: 16),

                // 送信ボタン
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _send(context),
                    icon: const Icon(Icons.send_rounded, size: 18),
                    label: const Text('送信する', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.yellow,
                      foregroundColor: AppColors.navyDark,
                      minimumSize: const Size(0, 48),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── 送信済みお知らせ一覧 ──
          GestureDetector(
            onTap: () => setState(() => _showSent = !_showSent),
            child: Row(children: [
              const Icon(Icons.history, color: AppColors.textSecondary, size: 16),
              const SizedBox(width: 6),
              Text('送信済みお知らせ (${announcements.length})',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
              const Spacer(),
              Icon(_showSent ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                  color: AppColors.silverDim, size: 18),
            ]),
          ),

          if (_showSent) ...[
            const SizedBox(height: 10),
            if (announcements.isEmpty)
              const Center(child: Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('送信済みのお知らせはありません', style: TextStyle(color: AppColors.textSecondary)),
              ))
            else
              ...announcements.map((a) => _SentAnnouncementCard(announcement: a)),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

// ── ロール選択チップ ──
class _RoleChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _RoleChip({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.2) : AppColors.navyCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? color : AppColors.cardBorder, width: selected ? 1.5 : 1),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (selected) ...[
            Icon(Icons.check_circle, color: color, size: 14),
            const SizedBox(width: 4),
          ],
          Text(label, style: TextStyle(
            color: selected ? color : AppColors.textSecondary,
            fontSize: 13, fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
          )),
        ]),
      ),
    );
  }
}

// ── 送信済みお知らせカード ──
class _SentAnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  const _SentAnnouncementCard({required this.announcement});

  @override
  Widget build(BuildContext context) {
    final a = announcement;
    final roleLabels = a.targetRoles.map((r) {
      if (r == 'student') return '生徒';
      if (r == 'parent') return '保護者';
      if (r == 'teacher') return '講師';
      return r;
    }).join('・');

    return GlowCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.campaign_rounded, color: AppColors.info, size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(a.title,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700))),
          Text(
            '${a.createdAt.month}/${a.createdAt.day}',
            style: const TextStyle(color: AppColors.silverDim, fontSize: 11),
          ),
        ]),
        const SizedBox(height: 6),
        Text(a.body, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.4),
            maxLines: 2, overflow: TextOverflow.ellipsis),
        if (a.imageBytes != null) ...[
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.memory(
              Uint8List.fromList(a.imageBytes!),
              height: 100,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
        ] else if (a.imageUrl != null) ...[
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              a.imageUrl!,
              height: 100,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                height: 40,
                decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(8)),
                child: const Center(child: Icon(Icons.broken_image, color: AppColors.silverDim, size: 20)),
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.info.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('宛先: $roleLabels${a.targetUserIds.isNotEmpty ? '（個別選択）' : '（全員）'}',
                style: const TextStyle(color: AppColors.info, fontSize: 10, fontWeight: FontWeight.w600)),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('既読 ${a.readByUserIds.length}人',
                style: const TextStyle(color: AppColors.success, fontSize: 10, fontWeight: FontWeight.w600)),
          ),
        ]),
      ]),
    );
  }
}

// 設定タブ：授業組み / 模試・科目管理 / 講師管理
// ============================================================
class _AdminSettingsTab extends StatefulWidget {
  const _AdminSettingsTab();
  @override
  State<_AdminSettingsTab> createState() => _AdminSettingsTabState();
}

class _AdminSettingsTabState extends State<_AdminSettingsTab> with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 5, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Container(
        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        decoration: BoxDecoration(
          color: AppColors.navyCard, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: TabBar(
          controller: _tabCtrl,
          indicator: BoxDecoration(color: AppColors.yellow, borderRadius: BorderRadius.circular(10)),
          indicatorPadding: const EdgeInsets.all(4),
          labelColor: AppColors.navyDark,
          unselectedLabelColor: AppColors.silverDim,
          labelStyle: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
          dividerColor: Colors.transparent,
          tabs: const [
            Tab(text: '授業組み'),
            Tab(text: '生徒登録'),
            Tab(text: '保護者管理'),
            Tab(text: '模試・科目'),
            Tab(text: '講師管理'),
          ],
        ),
      ),
      Expanded(child: TabBarView(controller: _tabCtrl, children: const [
        _LessonScheduleTab(),
        _StudentRegisterTab(),
        _ParentManageTab(),
        _MockSubjectTab(),
        _TeacherManageTab(),
      ])),
    ]);
  }
}

// ── 授業組みタブ ──
class _LessonScheduleTab extends StatefulWidget {
  const _LessonScheduleTab();
  @override
  State<_LessonScheduleTab> createState() => _LessonScheduleTabState();
}

class _LessonScheduleTabState extends State<_LessonScheduleTab> {
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
    final allDates = provider.getAllLessonDates();
    final selectedLessons = _selectedDay != null ? provider.getAllLessonsOnDate(_selectedDay!) : <Lesson>[];

    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionHeader(title: '授業組み', subtitle: '日付を選んで授業を登録'),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            gradient: AppGradients.cardGradient, borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.cardBorder),
          ),
          child: TableCalendar(
            firstDay: DateTime.utc(2025, 1, 1), lastDay: DateTime.utc(2027, 12, 31),
            focusedDay: _focusedDay,
            selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
            calendarFormat: CalendarFormat.month,
            eventLoader: (day) {
              final d = DateTime(day.year, day.month, day.day);
              return allDates.contains(d) ? ['lesson'] : [];
            },
            onDaySelected: (sel, foc) => setState(() { _selectedDay = sel; _focusedDay = foc; }),
            onPageChanged: (foc) => setState(() => _focusedDay = foc),
            calendarStyle: CalendarStyle(
              defaultTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 12),
              weekendTextStyle: const TextStyle(color: AppColors.silver, fontSize: 12),
              outsideDaysVisible: false,
              selectedDecoration: BoxDecoration(
                color: AppColors.yellow, shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.4), blurRadius: 6)],
              ),
              selectedTextStyle: const TextStyle(color: AppColors.navyDark, fontWeight: FontWeight.w800, fontSize: 12),
              todayDecoration: BoxDecoration(
                color: AppColors.yellow.withValues(alpha: 0.2), shape: BoxShape.circle,
                border: Border.all(color: AppColors.yellow, width: 1.5),
              ),
              todayTextStyle: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 12),
              markerDecoration: const BoxDecoration(color: AppColors.info, shape: BoxShape.circle),
              markerSize: 5,
            ),
            headerStyle: HeaderStyle(
              formatButtonVisible: false, titleCentered: true,
              titleTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700),
              leftChevronIcon: const Icon(Icons.chevron_left, color: AppColors.silver, size: 20),
              rightChevronIcon: const Icon(Icons.chevron_right, color: AppColors.silver, size: 20),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.cardBorder))),
            ),
            daysOfWeekStyle: const DaysOfWeekStyle(
              weekdayStyle: TextStyle(color: AppColors.textSecondary, fontSize: 10),
              weekendStyle: TextStyle(color: AppColors.silverDim, fontSize: 10),
            ),
          ),
        ),
        if (_selectedDay != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              const Icon(Icons.event, color: AppColors.yellow, size: 14),
              const SizedBox(width: 6),
              Text(DateFormat('M月d日（E）', 'ja').format(_selectedDay!),
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700)),
              const Spacer(),
              Builder(
                builder: (btnCtx) => ElevatedButton.icon(
                  onPressed: () => _showAddLessonDialog(btnCtx, _selectedDay!),
                  icon: const Icon(Icons.add, size: 14),
                  label: const Text('授業を追加', style: TextStyle(fontSize: 12)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.yellow, foregroundColor: AppColors.navyDark,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ]),
          ),
          // 登録済み授業カード（0件でも常に「タップして追加」を表示）
          ...selectedLessons.map((l) => _ScheduleLessonCard(lesson: l)),
          // ── タップして授業を追加（常時表示） ──
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
            child: Builder(
              builder: (tapCtx) => GestureDetector(
                onTap: () => _showAddLessonDialog(tapCtx, _selectedDay!),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: AppColors.navyCard,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: selectedLessons.isEmpty
                          ? AppColors.yellow.withValues(alpha: 0.5)
                          : AppColors.cardBorder,
                      style: BorderStyle.solid,
                    ),
                  ),
                  child: Row(children: [
                    Icon(
                      Icons.add_circle_outline,
                      color: selectedLessons.isEmpty
                          ? AppColors.yellow
                          : AppColors.silverDim,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Text(
                      selectedLessons.isEmpty ? 'タップして授業を追加' : '＋ もう1つ授業を追加',
                      style: TextStyle(
                        color: selectedLessons.isEmpty
                            ? AppColors.yellow
                            : AppColors.silverDim,
                        fontSize: 13,
                      ),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 32),
      ]),
    );
  }

  void _showAddLessonDialog(BuildContext context, DateTime date) {
    final provider = context.read<AppProvider>();
    final students = provider.allStudents;
    final teachers = provider.allTeachers;
    final subjects = provider.lessonSubjects;
    if (students.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('生徒が登録されていません')));
      return;
    }

    // ── 共通設定 ──
    Set<String> selectedStudentIds = {students.first.id};
    String? selectedTeacherId = teachers.isNotEmpty ? teachers.first.id : null;
    bool isWeekly = false;

    // ── 授業スロット（教科＋時間）リスト ──
    final List<_LessonSlot> slots = [
      _LessonSlot(
        subject: subjects.isNotEmpty ? subjects.first : '数学',
        startTime: '16:00',
        endTime: '18:00',
      ),
    ];

    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) {
          final canRegister = selectedStudentIds.isNotEmpty && slots.isNotEmpty;
          return AlertDialog(
            backgroundColor: AppColors.card,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            titlePadding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            contentPadding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            title: Text('${date.month}/${date.day} 授業を組む',
                style: const TextStyle(
                    color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 15)),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [

                  // ══ 生徒選択 ══
                  _dlgLabel('生徒（複数選択可）'),
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.navyCard,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.cardBorder),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: students.map((s) {
                        final isChecked = selectedStudentIds.contains(s.id);
                        return InkWell(
                          onTap: () => setS(() {
                            if (isChecked) { selectedStudentIds.remove(s.id); }
                            else { selectedStudentIds.add(s.id); }
                          }),
                          borderRadius: BorderRadius.circular(10),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                            child: Row(children: [
                              Checkbox(
                                value: isChecked,
                                onChanged: (v) => setS(() {
                                  if (v == true) { selectedStudentIds.add(s.id); }
                                  else { selectedStudentIds.remove(s.id); }
                                }),
                                activeColor: AppColors.yellow,
                                checkColor: AppColors.navyDark,
                                side: BorderSide(
                                    color: isChecked ? AppColors.yellow : AppColors.silverDim),
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              Expanded(
                                child: Text(
                                  '${s.name}（中${s.grade ?? '-'}年）',
                                  style: TextStyle(
                                    color: isChecked
                                        ? AppColors.textPrimary
                                        : AppColors.textSecondary,
                                    fontSize: 13,
                                    fontWeight: isChecked
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                  ),
                                ),
                              ),
                              if (isChecked)
                                const Icon(Icons.check_circle,
                                    color: AppColors.yellow, size: 16),
                              const SizedBox(width: 8),
                            ]),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  if (selectedStudentIds.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppColors.yellow.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: AppColors.yellow.withValues(alpha: 0.4)),
                          ),
                          child: Text('${selectedStudentIds.length}名選択中',
                              style: const TextStyle(
                                  color: AppColors.yellow,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),

                  const SizedBox(height: 14),
                  const Divider(color: AppColors.cardBorder, height: 1),
                  const SizedBox(height: 10),

                  // ══ 授業スロット一覧 ══
                  _dlgLabel('授業内容（教科・時間）'),
                  ...slots.asMap().entries.map((entry) {
                    final idx = entry.key;
                    final slot = entry.value;
                    return Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.navyCard,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.cardBorder),
                      ),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        // スロットヘッダー（番号 + 削除ボタン）
                        Row(children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.yellow.withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text('授業 ${idx + 1}',
                                style: const TextStyle(
                                    color: AppColors.yellow,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700)),
                          ),
                          const Spacer(),
                          if (slots.length > 1)
                            GestureDetector(
                              onTap: () => setS(() => slots.removeAt(idx)),
                              child: Container(
                                padding: const EdgeInsets.all(4),
                                decoration: BoxDecoration(
                                  color: AppColors.danger.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Icon(Icons.close,
                                    color: AppColors.danger, size: 14),
                              ),
                            ),
                        ]),
                        const SizedBox(height: 8),

                        // 科目チップ
                        Wrap(
                          spacing: 6, runSpacing: 6,
                          children: subjects.map((subj) => GestureDetector(
                            onTap: () => setS(() => slot.subject = subj),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: slot.subject == subj
                                    ? AppColors.yellow
                                    : AppColors.navyDark,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                    color: slot.subject == subj
                                        ? AppColors.yellow
                                        : AppColors.cardBorder),
                              ),
                              child: Text(subj,
                                  style: TextStyle(
                                    color: slot.subject == subj
                                        ? AppColors.navyDark
                                        : AppColors.textPrimary,
                                    fontSize: 12,
                                    fontWeight: slot.subject == subj
                                        ? FontWeight.w700
                                        : FontWeight.w400,
                                  )),
                            ),
                          )).toList(),
                        ),
                        const SizedBox(height: 8),

                        // 時間ピッカー
                        Row(children: [
                          Expanded(
                            child: _TimePicker(
                              label: '開始',
                              value: slot.startTime,
                              onChanged: (v) => setS(() => slot.startTime = v),
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 6),
                            child: Text('〜',
                                style: TextStyle(
                                    color: AppColors.textSecondary, fontSize: 14)),
                          ),
                          Expanded(
                            child: _TimePicker(
                              label: '終了',
                              value: slot.endTime,
                              onChanged: (v) => setS(() => slot.endTime = v),
                            ),
                          ),
                        ]),
                      ]),
                    );
                  }),

                  // ── 授業を追加ボタン ──
                  GestureDetector(
                    onTap: () => setS(() => slots.add(_LessonSlot(
                      subject: subjects.isNotEmpty ? subjects.first : '数学',
                      startTime: '16:00',
                      endTime: '18:00',
                    ))),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.info.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: AppColors.info.withValues(alpha: 0.4),
                            style: BorderStyle.solid),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_circle_outline,
                              color: AppColors.info, size: 16),
                          SizedBox(width: 6),
                          Text('授業を追加',
                              style: TextStyle(
                                  color: AppColors.info,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 14),
                  const Divider(color: AppColors.cardBorder, height: 1),
                  const SizedBox(height: 10),

                  // ══ 担当講師 ══
                  if (teachers.isNotEmpty) ...[
                    _dlgLabel('担当講師（全授業共通）'),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                          color: AppColors.navyCard,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.cardBorder)),
                      child: DropdownButton<String>(
                        value: selectedTeacherId,
                        isExpanded: true,
                        dropdownColor: AppColors.card,
                        underline: const SizedBox(),
                        style: const TextStyle(
                            color: AppColors.textPrimary, fontSize: 13),
                        items: teachers
                            .map((t) => DropdownMenuItem(
                                value: t.id, child: Text(t.name)))
                            .toList(),
                        onChanged: (v) => setS(() => selectedTeacherId = v),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],

                  // ══ 毎週繰り返し ══
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                        color: AppColors.navyCard,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.cardBorder)),
                    child: Row(children: [
                      const Icon(Icons.repeat, color: AppColors.info, size: 16),
                      const SizedBox(width: 8),
                      const Expanded(
                          child: Text('毎週繰り返す（制限なし）',
                              style: TextStyle(
                                  color: AppColors.textPrimary, fontSize: 13))),
                      Switch(
                          value: isWeekly,
                          onChanged: (v) => setS(() => isWeekly = v),
                          activeThumbColor: AppColors.yellow),
                    ]),
                  ),
                  const SizedBox(height: 4),
                ]),
              ),
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.of(ctx, rootNavigator: true).pop(),
                  child: const Text('キャンセル',
                      style: TextStyle(color: AppColors.silverDim))),
              ElevatedButton(
                onPressed: canRegister
                    ? () {
                        // 生徒 × スロット の全組み合わせで登録
                        for (final sid in selectedStudentIds) {
                          for (final slot in slots) {
                            provider.scheduleLesson(
                              studentId: sid,
                              date: date,
                              startTime: slot.startTime,
                              endTime: slot.endTime,
                              subject: slot.subject,
                              teacherId: selectedTeacherId,
                              isWeekly: isWeekly,
                            );
                          }
                        }
                        final sCount = selectedStudentIds.length;
                        final lCount = slots.length;
                        final weekly = isWeekly;
                        Navigator.of(ctx, rootNavigator: true).pop();
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text(weekly
                              ? '$sCount名 × $lCount授業を毎週繰り返しで登録しました！'
                              : '$sCount名 × $lCount授業を登録しました！'),
                          backgroundColor: AppColors.success,
                          behavior: SnackBarBehavior.floating,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ));
                      }
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      canRegister ? AppColors.yellow : AppColors.silverDim,
                  foregroundColor: AppColors.navyDark,
                ),
                child: Text(
                  !canRegister
                      ? '生徒を選択'
                      : '${selectedStudentIds.length}名×${slots.length}授業を登録',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  static Widget _dlgLabel(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Align(
        alignment: Alignment.centerLeft,
        child: Text(text,
            style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w600))),
  );
}

/// 授業スロット（教科＋時間）の一時データクラス
class _LessonSlot {
  String subject;
  String startTime;
  String endTime;
  _LessonSlot({required this.subject, required this.startTime, required this.endTime});
}

class _TimePicker extends StatelessWidget {
  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  const _TimePicker({required this.label, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final parts = value.split(':');
        final initial = TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
        final picked = await showTimePicker(
          context: context, initialTime: initial,
          builder: (c, child) => Theme(
            data: ThemeData.dark().copyWith(
              colorScheme: const ColorScheme.dark(primary: AppColors.yellow, surface: AppColors.card),
            ),
            child: child!,
          ),
        );
        if (picked != null) {
          onChanged('${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(color: AppColors.navyCard, borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.cardBorder)),
        child: Row(children: [
          const Icon(Icons.access_time, color: AppColors.yellow, size: 14),
          const SizedBox(width: 6),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9)),
            Text(value, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 14)),
          ]),
        ]),
      ),
    );
  }
}

class _ScheduleLessonCard extends StatelessWidget {
  final Lesson lesson;
  const _ScheduleLessonCard({required this.lesson});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    final student = provider.getStudentById(lesson.studentId);
    final teacher = lesson.teacherId != null ? provider.getTeacherById(lesson.teacherId!) : null;
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(children: [
        Container(width: 4, height: 50,
            decoration: BoxDecoration(
              color: lesson.isAbsent ? AppColors.danger : AppColors.yellow,
              borderRadius: BorderRadius.circular(2),
            )),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${student?.name ?? '---'}　${lesson.subject}',
              style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13)),
          Text('${lesson.startTime}〜${lesson.endTime}${lesson.isWeekly ? '　🔁毎週' : ''}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          if (teacher != null)
            Text('担当: ${teacher.name}', style: const TextStyle(color: AppColors.silverDim, fontSize: 11)),
        ])),
        IconButton(
          icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 20),
          onPressed: () => showDialog(
            context: context,
            builder: (_) => AlertDialog(
              backgroundColor: AppColors.card,
              title: const Text('授業を削除', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
              content: Text('${student?.name} の ${lesson.subject} を削除しますか？',
                  style: const TextStyle(color: AppColors.textPrimary)),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context),
                    child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
                ElevatedButton(
                  onPressed: () { provider.removeLesson(lesson.id); Navigator.pop(context); },
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                  child: const Text('削除'),
                ),
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

// ── 模試・科目管理タブ ──
class _MockSubjectTab extends StatelessWidget {
  const _MockSubjectTab();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        const SectionHeader(title: '模試名管理'),
        GlowCard(child: Column(children: [
          ...provider.mockTestNames.map((name) => ListTile(
            dense: true,
            leading: const Icon(Icons.assignment, color: AppColors.yellow, size: 18),
            title: Text(name, style: const TextStyle(color: AppColors.textPrimary)),
            trailing: IconButton(
              icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 18),
              onPressed: () => provider.removeMockTestName(name),
            ),
          )),
          const SizedBox(height: 4),
          OutlinedButton.icon(
            onPressed: () => _showAddDialog(context, '模試名を追加', '模試名', (v) => provider.addMockTestName(v), AppColors.yellow),
            icon: const Icon(Icons.add, size: 16), label: const Text('模試を追加'),
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.yellow, side: const BorderSide(color: AppColors.yellow),
                minimumSize: const Size(double.infinity, 42), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          ),
        ])),
        const SizedBox(height: 20),
        const SectionHeader(title: '授業科目管理', subtitle: '授業組みで使用する科目'),
        GlowCard(child: Column(children: [
          ...provider.lessonSubjects.map((subj) => ListTile(
            dense: true,
            leading: const Icon(Icons.book_outlined, color: AppColors.info, size: 18),
            title: Text(subj, style: const TextStyle(color: AppColors.textPrimary)),
            trailing: defaultLessonSubjects.contains(subj)
                ? const SizedBox()
                : IconButton(
                    icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 18),
                    onPressed: () => provider.removeLessonSubject(subj),
                  ),
          )),
          const SizedBox(height: 4),
          OutlinedButton.icon(
            onPressed: () => _showAddDialog(context, '科目を追加', '科目名（例：英会話）', (v) => provider.addLessonSubject(v), AppColors.info),
            icon: const Icon(Icons.add, size: 16), label: const Text('科目を追加'),
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.info, side: const BorderSide(color: AppColors.info),
                minimumSize: const Size(double.infinity, 42), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          ),
        ])),
      ]),
    );
  }

  void _showAddDialog(BuildContext context, String title, String hint, void Function(String) onAdd, Color color) {
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w700)),
        content: TextField(controller: ctrl, decoration: InputDecoration(labelText: hint),
            style: const TextStyle(color: AppColors.textPrimary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
              child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () { if (ctrl.text.trim().isNotEmpty) { onAdd(ctrl.text.trim()); Navigator.pop(ctx); } },
            style: ElevatedButton.styleFrom(backgroundColor: color, foregroundColor: AppColors.navyDark),
            child: const Text('追加'),
          ),
        ],
      ),
    );
  }
}

// ── 生徒登録タブ ──
class _StudentRegisterTab extends StatelessWidget {
  const _StudentRegisterTab();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final students = provider.allStudents;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        const SectionHeader(title: '生徒登録', subtitle: '在籍生徒の管理'),
        GlowCard(
          child: Column(children: [
            if (students.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('生徒が登録されていません',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            else
              ...students.map((s) => Builder(
                builder: (rowCtx) => Container(
                  decoration: const BoxDecoration(
                    border: Border(bottom: BorderSide(color: AppColors.cardBorder, width: 0.5)),
                  ),
                  child: ListTile(
                    dense: true,
                    leading: CircleAvatar(
                      radius: 16,
                      backgroundColor: AppColors.yellow.withValues(alpha: 0.15),
                      child: Text(s.name.isNotEmpty ? s.name[0] : '?',
                          style: const TextStyle(
                              color: AppColors.yellow, fontWeight: FontWeight.w800, fontSize: 13)),
                    ),
                    title: Text(s.name,
                        style: const TextStyle(
                            color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${s.className ?? ''}　中${s.grade ?? '-'}年',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      if (s.club != null && s.club!.isNotEmpty)
                        Text('部活: ${s.club}',
                            style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
                      if (s.targetSchool != null && s.targetSchool!.isNotEmpty)
                        Text('志望校: ${s.targetSchool}',
                            style: const TextStyle(color: AppColors.info, fontSize: 10)),
                    ]),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      // 編集ボタン
                      IconButton(
                        icon: const Icon(Icons.edit_note, color: AppColors.info, size: 20),
                        onPressed: () => _showStudentDialog(rowCtx, provider, s),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      ),
                      // 削除ボタン
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 20),
                        onPressed: () => showDialog(
                          context: rowCtx,
                          useRootNavigator: true,
                          builder: (c) => AlertDialog(
                            backgroundColor: AppColors.card,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            title: const Text('生徒を削除',
                                style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
                            content: Text('${s.name} を削除しますか？',
                                style: const TextStyle(color: AppColors.textPrimary)),
                            actions: [
                              TextButton(
                                  onPressed: () => Navigator.of(c, rootNavigator: true).pop(),
                                  child: const Text('キャンセル',
                                      style: TextStyle(color: AppColors.silverDim))),
                              ElevatedButton(
                                onPressed: () {
                                  provider.removeStudent(s.id);
                                  Navigator.of(c, rootNavigator: true).pop();
                                },
                                style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                                child: const Text('削除'),
                              ),
                            ],
                          ),
                        ),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      ),
                    ]),
                  ),
                ),
              )),
            const SizedBox(height: 8),
            Builder(
              builder: (btnCtx) => OutlinedButton.icon(
                onPressed: () => _showStudentDialog(btnCtx, provider, null),
                icon: const Icon(Icons.person_add, size: 16),
                label: const Text('生徒を追加'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.yellow,
                  side: const BorderSide(color: AppColors.yellow),
                  minimumSize: const Size(double.infinity, 42),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  // 追加・編集共通ダイアログ（student==nullで追加モード）
  void _showStudentDialog(BuildContext context, AppProvider provider, AppUser? student) {
    final isEdit = student != null;
    final nameCtrl   = TextEditingController(text: student?.name   ?? '');
    final schoolCtrl = TextEditingController(text: student?.className ?? '');
    final gradeCtrl  = TextEditingController(
        text: student?.grade != null ? '中${student!.grade}' : '');
    final clubCtrl   = TextEditingController(text: student?.club   ?? '');
    final scoreCtrl  = TextEditingController(text: student?.currentScore ?? '');
    final targetCtrl = TextEditingController(text: student?.targetSchool ?? '');

    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          backgroundColor: AppColors.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(isEdit ? '生徒情報を編集' : '生徒を追加',
              style: TextStyle(
                  color: isEdit ? AppColors.info : AppColors.yellow,
                  fontWeight: FontWeight.w700, fontSize: 15)),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                // 名前フィールドだけ onChanged でボタン有効化を再評価
                _field('名前 *', nameCtrl,
                    hint: '例：山田太郎',
                    onChanged: (_) => setS(() {})),
                const SizedBox(height: 8),
                _field('学校', schoolCtrl, hint: '例：○○中学校'),
                const SizedBox(height: 8),
                _field('学年', gradeCtrl, hint: '例：中1・中2・中3'),
                const SizedBox(height: 8),
                _field('部活', clubCtrl, hint: '例：サッカー部'),
                const SizedBox(height: 8),
                _field('現在の成績', scoreCtrl, hint: '例：オール3、数学5など'),
                const SizedBox(height: 8),
                _field('志望校', targetCtrl, hint: '例：○○高校'),
              ]),
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx, rootNavigator: true).pop(),
                child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
            ElevatedButton(
              onPressed: nameCtrl.text.trim().isEmpty ? null : () {
                int? gradeNum;
                final g = gradeCtrl.text.trim();
                if (g.contains('1')) { gradeNum = 1; }
                else if (g.contains('2')) { gradeNum = 2; }
                else if (g.contains('3')) { gradeNum = 3; }

                final built = AppUser(
                  id: isEdit ? student.id : 's_${DateTime.now().millisecondsSinceEpoch}',
                  name: nameCtrl.text.trim(),
                  role: UserRole.student,
                  grade: gradeNum,
                  className: schoolCtrl.text.trim(),
                  club: clubCtrl.text.trim().isEmpty ? null : clubCtrl.text.trim(),
                  currentScore: scoreCtrl.text.trim().isEmpty ? null : scoreCtrl.text.trim(),
                  targetSchool: targetCtrl.text.trim().isEmpty ? null : targetCtrl.text.trim(),
                );
                if (isEdit) {
                  provider.updateStudent(built);
                } else {
                  provider.addStudent(built);
                }
                Navigator.of(ctx, rootNavigator: true).pop();
              },
              style: ElevatedButton.styleFrom(
                  backgroundColor: isEdit ? AppColors.info : AppColors.yellow,
                  foregroundColor: isEdit ? Colors.white : AppColors.navyDark),
              child: Text(isEdit ? '保存' : '追加',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }

  static Widget _field(String label, TextEditingController ctrl,
      {String hint = '', void Function(String)? onChanged}) {
    return TextField(
      controller: ctrl,
      onChanged: onChanged,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        labelText: label, hintText: hint,
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
        filled: true, fillColor: AppColors.navyCard,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}

// ============================================================
// 保護者管理タブ（登録・生徒紐付け・編集・削除）
// ============================================================
class _ParentManageTab extends StatelessWidget {
  const _ParentManageTab();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final parents = provider.allParents;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        const SectionHeader(title: '保護者管理', subtitle: '保護者アカウントの登録・生徒紐付け'),

        // ── 保護者一覧 ──
        GlowCard(
          child: Column(children: [
            if (parents.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text('保護者が登録されていません',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            else
              ...parents.map((p) => _ParentListTile(parent: p)),
            const SizedBox(height: 8),
            Builder(
              builder: (btnCtx) => OutlinedButton.icon(
                onPressed: () => _showParentDialog(btnCtx, provider, null),
                icon: const Icon(Icons.person_add, size: 16),
                label: const Text('保護者を追加'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.info,
                  side: const BorderSide(color: AppColors.info),
                  minimumSize: const Size(double.infinity, 42),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ]),
        ),

        const SizedBox(height: 20),

        // ── 凡例 ──
        GlowCard(
          glowColor: AppColors.silverDim,
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.info_outline, color: AppColors.info, size: 14),
              SizedBox(width: 6),
              Text('ログイン方法', style: TextStyle(
                  color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 8),
            const Text(
              '• 保護者はログイン画面で「保護者」を選択\n'
              '• ログインID: 登録したID（例: parent1）\n'
              '• パスワード: 登録したパスワード\n'
              '• 複数の子どもを1アカウントで管理可能',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.6),
            ),
          ]),
        ),
      ]),
    );
  }

  static void _showParentDialog(
      BuildContext context, AppProvider provider, AppUser? parent) {
    final isEdit = parent != null;
    final idCtrl   = TextEditingController(text: parent?.id ?? '');
    final nameCtrl = TextEditingController(text: parent?.name ?? '');
    final pwCtrl   = TextEditingController(text: parent?.password ?? '');
    // 紐付けリストのコピー（mutable）
    final linkedIds = List<String>.from(parent?.studentIds ?? []);

    showDialog(
      context: context,
      useRootNavigator: true,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setS) {
          final students = provider.allStudents;

          return AlertDialog(
            backgroundColor: AppColors.card,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Text(
              isEdit ? '保護者情報を編集' : '保護者を追加',
              style: TextStyle(
                color: isEdit ? AppColors.info : AppColors.yellow,
                fontWeight: FontWeight.w700, fontSize: 15,
              ),
            ),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  // ── ID ──
                  TextField(
                    controller: idCtrl,
                    enabled: !isEdit, // 編集時はID変更不可
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: 'ログインID *',
                      hintText: '例: parent3',
                      labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      filled: true,
                      fillColor: isEdit
                          ? AppColors.navyDark.withValues(alpha: 0.5)
                          : AppColors.navyDark,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppColors.cardBorder),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppColors.cardBorder),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  // ── 名前 ──
                  _parentField('名前 *', nameCtrl, hint: '例: 山田 保護者'),
                  const SizedBox(height: 8),
                  // ── パスワード ──
                  _parentField('パスワード *', pwCtrl, hint: '例: pass1234'),
                  const SizedBox(height: 14),

                  // ── 紐付け生徒 ──
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Row(children: [
                      const Icon(Icons.link, color: AppColors.yellow, size: 14),
                      const SizedBox(width: 6),
                      const Text('紐付ける生徒',
                          style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 13,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.yellow.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text('${linkedIds.length}名',
                            style: const TextStyle(
                                color: AppColors.yellow, fontSize: 11)),
                      ),
                    ]),
                  ),
                  const SizedBox(height: 8),
                  if (students.isEmpty)
                    const Text('生徒が登録されていません',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 12))
                  else
                    ...students.map((s) {
                      final checked = linkedIds.contains(s.id);
                      return InkWell(
                        onTap: () => setS(() {
                          if (checked) {
                            linkedIds.remove(s.id);
                          } else {
                            linkedIds.add(s.id);
                          }
                        }),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: checked
                                ? AppColors.yellow.withValues(alpha: 0.1)
                                : AppColors.navyDark,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: checked ? AppColors.yellow : AppColors.cardBorder,
                            ),
                          ),
                          child: Row(children: [
                            Icon(
                              checked ? Icons.check_box : Icons.check_box_outline_blank,
                              color: checked ? AppColors.yellow : AppColors.silverDim,
                              size: 18,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(s.name,
                                  style: TextStyle(
                                    color: checked
                                        ? AppColors.textPrimary
                                        : AppColors.textSecondary,
                                    fontSize: 13,
                                    fontWeight: checked ? FontWeight.w600 : FontWeight.w400,
                                  )),
                            ),
                            Text(
                              '中${s.grade ?? '-'}年　${s.className ?? ''}',
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 11),
                            ),
                          ]),
                        ),
                      );
                    }),
                ]),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx, rootNavigator: true).pop(),
                child: const Text('キャンセル',
                    style: TextStyle(color: AppColors.silverDim)),
              ),
              ElevatedButton(
                onPressed: () {
                  final id   = idCtrl.text.trim();
                  final name = nameCtrl.text.trim();
                  final pw   = pwCtrl.text.trim();
                  if (id.isEmpty || name.isEmpty || pw.isEmpty) return;
                  // 新規時はID重複チェック
                  if (!isEdit && provider.parentIdExists(id)) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(
                        content: Text('そのIDはすでに使用されています'),
                        backgroundColor: AppColors.danger,
                      ),
                    );
                    return;
                  }
                  final updated = AppUser(
                    id: isEdit ? parent.id : id,
                    name: name,
                    role: UserRole.parent,
                    studentIds: List<String>.from(linkedIds),
                    password: pw,
                  );
                  if (isEdit) {
                    provider.updateParent(updated);
                  } else {
                    provider.addParent(updated);
                  }
                  Navigator.of(ctx, rootNavigator: true).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(isEdit
                          ? '${name} の情報を更新しました'
                          : '${name} を保護者登録しました'),
                      backgroundColor: AppColors.success,
                      behavior: SnackBarBehavior.floating,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: isEdit ? AppColors.info : AppColors.yellow,
                  foregroundColor: isEdit ? Colors.white : AppColors.navyDark,
                ),
                child: Text(isEdit ? '保存' : '追加',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          );
        },
      ),
    );
  }

  static Widget _parentField(String label, TextEditingController ctrl,
      {String hint = ''}) {
    return TextField(
      controller: ctrl,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
        filled: true,
        fillColor: AppColors.navyDark,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.yellow),
        ),
      ),
    );
  }
}

// 保護者一覧タイル（StatefulWidget でビルダーコンテキストを持つ）
class _ParentListTile extends StatelessWidget {
  final AppUser parent;
  const _ParentListTile({required this.parent});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final linkedStudents = parent.studentIds
        .map((id) => provider.getStudentById(id))
        .whereType<AppUser>()
        .toList();

    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.cardBorder, width: 0.5)),
      ),
      child: ListTile(
        dense: true,
        leading: CircleAvatar(
          radius: 16,
          backgroundColor: AppColors.info.withValues(alpha: 0.15),
          child: Text(
            parent.name.isNotEmpty ? parent.name[0] : '?',
            style: const TextStyle(
                color: AppColors.info, fontWeight: FontWeight.w800, fontSize: 13),
          ),
        ),
        title: Text(parent.name,
            style: const TextStyle(
                color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
        subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // ID
          Text('ID: ${parent.id}  /  PW: ${parent.password ?? '未設定'}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          // 紐付き生徒
          if (linkedStudents.isEmpty)
            const Text('紐付け生徒なし',
                style: TextStyle(color: AppColors.silverDim, fontSize: 10))
          else
            Wrap(
              spacing: 4,
              children: linkedStudents.map((s) => Container(
                margin: const EdgeInsets.only(top: 2),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: AppColors.yellow.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(s.name,
                    style: const TextStyle(
                        color: AppColors.yellow, fontSize: 10, fontWeight: FontWeight.w600)),
              )).toList(),
            ),
        ]),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          // 編集
          IconButton(
            icon: const Icon(Icons.edit_note, color: AppColors.info, size: 20),
            onPressed: () =>
                _ParentManageTab._showParentDialog(context, provider, parent),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
          // 削除
          IconButton(
            icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 20),
            onPressed: () => showDialog(
              context: context,
              useRootNavigator: true,
              builder: (c) => AlertDialog(
                backgroundColor: AppColors.card,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                title: const Text('保護者を削除',
                    style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
                content: Text('${parent.name} を削除しますか？',
                    style: const TextStyle(color: AppColors.textPrimary)),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(c, rootNavigator: true).pop(),
                    child: const Text('キャンセル',
                        style: TextStyle(color: AppColors.silverDim)),
                  ),
                  ElevatedButton(
                    onPressed: () {
                      provider.removeParent(parent.id);
                      Navigator.of(c, rootNavigator: true).pop();
                    },
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                    child: const Text('削除'),
                  ),
                ],
              ),
            ),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
        ]),
      ),
    );
  }
}

// ── 講師管理タブ ──
class _TeacherManageTab extends StatelessWidget {
  const _TeacherManageTab();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        const SectionHeader(title: '講師管理'),
        GlowCard(child: Column(children: [
          if (provider.allTeachers.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('講師が登録されていません', style: TextStyle(color: AppColors.textSecondary)))
          else
            ...provider.allTeachers.map((t) => ListTile(
              dense: true,
              leading: CircleAvatar(radius: 16, backgroundColor: AppColors.silver.withValues(alpha: 0.15),
                  child: Text(t.name[0], style: const TextStyle(color: AppColors.silver, fontWeight: FontWeight.w800, fontSize: 13))),
              title: Text(t.name, style: const TextStyle(color: AppColors.textPrimary)),
              subtitle: Text('ID: ${t.id}　PW: 1234', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline, color: AppColors.danger, size: 18),
                onPressed: () => showDialog(
                  context: context,
                  builder: (_) => AlertDialog(
                    backgroundColor: AppColors.card,
                    title: const Text('講師を削除', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
                    content: Text('${t.name} を削除しますか？', style: const TextStyle(color: AppColors.textPrimary)),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(context),
                          child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
                      ElevatedButton(
                        onPressed: () { provider.removeTeacher(t.id); Navigator.pop(context); },
                        style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                        child: const Text('削除'),
                      ),
                    ],
                  ),
                ),
              ),
            )),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _showAddTeacherDialog(context),
            icon: const Icon(Icons.person_add, size: 16), label: const Text('講師を追加'),
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.silver, side: const BorderSide(color: AppColors.silver),
                minimumSize: const Size(double.infinity, 42), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          ),
        ])),
        const SizedBox(height: 20),
        const SectionHeader(title: 'アプリ情報'),
        GlowCard(child: Column(children: [
          _row('アプリ名', '三浦塾 STUDY MASTER'),
          const Divider(color: AppColors.cardBorder),
          _row('バージョン', '1.2.0'),
          const Divider(color: AppColors.cardBorder),
          _row('対象', '中学生'),
        ])),
      ]),
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(children: [
      Text(label, style: const TextStyle(color: AppColors.textSecondary)),
      const Spacer(),
      Text(value, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
    ]),
  );

  void _showAddTeacherDialog(BuildContext context) {
    final provider = context.read<AppProvider>();
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('講師追加', style: TextStyle(color: AppColors.silver, fontWeight: FontWeight.w700)),
        content: TextField(controller: ctrl,
            decoration: const InputDecoration(labelText: '講師名（例：山田 先生）'),
            style: const TextStyle(color: AppColors.textPrimary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
              child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () {
              if (ctrl.text.trim().isNotEmpty) {
                provider.addTeacher(AppUser(
                  id: 't_${DateTime.now().millisecondsSinceEpoch}',
                  name: ctrl.text.trim(), role: UserRole.teacher,
                ));
                Navigator.pop(ctx);
              }
            },
            child: const Text('追加'),
          ),
        ],
      ),
    );
  }
}
