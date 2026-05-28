import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:intl/intl.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';

class CalendarTab extends StatefulWidget {
  const CalendarTab({super.key});

  @override
  State<CalendarTab> createState() => _CalendarTabState();
}

class _CalendarTabState extends State<CalendarTab> {
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
    final selectedLessons = _selectedDay != null
        ? provider.getLessonsOnDate(userId, _selectedDay!)
        : <Lesson>[];

    return SingleChildScrollView(
      child: Column(
        children: [
          const SectionHeader(title: '授業カレンダー', subtitle: '授業日をタップして詳細を確認'),
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
              onDaySelected: (selected, focused) {
                setState(() {
                  _selectedDay = selected;
                  _focusedDay = focused;
                });
              },
              onPageChanged: (focused) => setState(() => _focusedDay = focused),
              calendarStyle: CalendarStyle(
                defaultTextStyle: const TextStyle(color: AppColors.textPrimary),
                weekendTextStyle: const TextStyle(color: AppColors.silver),
                outsideDaysVisible: false,
                outsideTextStyle: const TextStyle(color: AppColors.silverDim),
                selectedDecoration: BoxDecoration(
                  color: AppColors.yellow,
                  shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.5), blurRadius: 8)],
                ),
                selectedTextStyle: const TextStyle(color: AppColors.navyDark, fontWeight: FontWeight.w800),
                todayDecoration: BoxDecoration(
                  color: AppColors.yellow.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.yellow, width: 1.5),
                ),
                todayTextStyle: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700),
                markerDecoration: const BoxDecoration(
                  color: AppColors.yellow,
                  shape: BoxShape.circle,
                ),
                markerSize: 5,
                markerMargin: const EdgeInsets.symmetric(horizontal: 1),
              ),
              headerStyle: HeaderStyle(
                formatButtonVisible: false,
                titleCentered: true,
                titleTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700),
                leftChevronIcon: const Icon(Icons.chevron_left, color: AppColors.silver),
                rightChevronIcon: const Icon(Icons.chevron_right, color: AppColors.silver),
                headerPadding: const EdgeInsets.symmetric(vertical: 12),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.cardBorder)),
                ),
              ),
              daysOfWeekStyle: const DaysOfWeekStyle(
                weekdayStyle: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                weekendStyle: TextStyle(color: AppColors.silverDim, fontSize: 12),
              ),
            ),
          ),
          const SizedBox(height: 20),
          if (_selectedDay != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.event, color: AppColors.yellow, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        DateFormat('M月d日（E）', 'ja').format(_selectedDay!),
                        style: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (selectedLessons.isEmpty)
                    const Text('授業の予定はありません', style: TextStyle(color: AppColors.textSecondary))
                  else
                    ...selectedLessons.map((l) => _LessonDetailCard(lesson: l)),
                ],
              ),
            ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _LessonDetailCard extends StatefulWidget {
  final Lesson lesson;
  const _LessonDetailCard({required this.lesson});

  @override
  State<_LessonDetailCard> createState() => _LessonDetailCardState();
}

class _LessonDetailCardState extends State<_LessonDetailCard> {
  bool _showAbsentForm = false;
  final _reasonController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final lesson = widget.lesson;
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 12),
      glowColor: lesson.isAbsent ? AppColors.danger : AppColors.yellow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.yellow.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
                ),
                child: Text(lesson.subject, style: const TextStyle(
                  color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 14,
                )),
              ),
              const SizedBox(width: 10),
              Text('${lesson.startTime} 〜 ${lesson.endTime}',
                  style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (lesson.isAbsent)
                const AppChip(label: '欠席', color: AppColors.danger),
            ],
          ),
          if (lesson.memo != null && lesson.memo!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('📝 ${lesson.memo}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
          if (lesson.isAbsent && lesson.absentReason != null) ...[
            const SizedBox(height: 8),
            Text('理由: ${lesson.absentReason}', style: const TextStyle(color: AppColors.danger, fontSize: 13)),
          ],
          if (!lesson.isAbsent) ...[
            const SizedBox(height: 12),
            if (_showAbsentForm) ...[
              TextField(
                controller: _reasonController,
                decoration: const InputDecoration(
                  labelText: '欠席理由',
                  hintText: '例：体調不良のため',
                ),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        final provider = context.read<AppProvider>();
                        final user = provider.currentUser;
                        final notif = AbsenceNotification(
                          id: 'abs_${DateTime.now().millisecondsSinceEpoch}',
                          studentId: user?.id ?? '',
                          studentName: user?.name ?? '',
                          lessonId: lesson.id,
                          subject: lesson.subject,
                          lessonDate: lesson.date,
                          reason: _reasonController.text.isNotEmpty
                              ? _reasonController.text
                              : '欠席連絡',
                          sender: 'student',
                          senderName: user?.name ?? '',
                          sentAt: DateTime.now(),
                        );
                        provider.sendAbsenceNotification(notif);
                        setState(() => _showAbsentForm = false);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.danger,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 42),
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
                icon: const Icon(Icons.warning_amber_rounded, size: 16),
                label: const Text('欠席連絡'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.warning,
                  side: const BorderSide(color: AppColors.warning),
                  minimumSize: const Size(0, 38),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
