import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:confetti/confetti.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';


class ProgressTab extends StatefulWidget {
  const ProgressTab({super.key});

  @override
  State<ProgressTab> createState() => _ProgressTabState();
}

class _ProgressTabState extends State<ProgressTab> {
  late ConfettiController _confettiController;

  @override
  void initState() {
    super.initState();
    _confettiController = ConfettiController(duration: const Duration(seconds: 3));
  }

  @override
  void dispose() {
    _confettiController.dispose();
    super.dispose();
  }

  void _onItemToggled(bool wasCompleted) {
    if (!wasCompleted) {
      _confettiController.play();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: const [
                Text('🎉 ', style: TextStyle(fontSize: 20)),
                Text('達成！　素晴らしい！', style: TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
            backgroundColor: AppColors.success,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final userId = provider.currentUser?.id ?? '';
    final rate = provider.getProgressRate(userId);
    final cats = provider.progressCategories;

    return Stack(
      children: [
        SingleChildScrollView(
          child: Column(
            children: [
              const SectionHeader(title: '授業進捗管理', subtitle: '管理者が完了を登録します'),
              // Read-only notice
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.navyCard,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                child: Row(
                  children: const [
                    Icon(Icons.lock_outline, color: AppColors.silverDim, size: 16),
                    SizedBox(width: 8),
                    Text(
                      '進捗の完了登録は管理者（塾長）が行います',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              // Overall progress
              Padding(
                padding: const EdgeInsets.all(16),
                child: GlowCard(
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('全体達成率', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                const SizedBox(height: 8),
                                Text('${(rate * 100).toInt()}%', style: const TextStyle(
                                  color: AppColors.yellow, fontSize: 48, fontWeight: FontWeight.w900,
                                )),
                              ],
                            ),
                          ),
                          _CircularProgress(rate: rate),
                        ],
                      ),
                      const SizedBox(height: 16),
                      AnimatedProgressBar(value: rate, height: 12, label: '進捗'),
                    ],
                  ),
                ),
              ),

              // Categories (read-only for student)
              ...cats.map((cat) => _CategorySection(
                category: cat,
                userId: userId,
                onToggled: _onItemToggled,
                readOnly: true,
              )),
              const SizedBox(height: 32),
            ],
          ),
        ),
        // Confetti
        Align(
          alignment: Alignment.topCenter,
          child: ConfettiWidget(
            confettiController: _confettiController,
            blastDirectionality: BlastDirectionality.explosive,
            shouldLoop: false,
            colors: const [AppColors.yellow, AppColors.silver, AppColors.info, AppColors.success],
            numberOfParticles: 30,
          ),
        ),
      ],
    );
  }
}

class _CircularProgress extends StatelessWidget {
  final double rate;
  const _CircularProgress({required this.rate});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 80,
      height: 80,
      child: Stack(
        children: [
          CircularProgressIndicator(
            value: rate,
            strokeWidth: 8,
            backgroundColor: AppColors.navyCard,
            valueColor: AlwaysStoppedAnimation<Color>(
              rate >= 0.8 ? AppColors.success : rate >= 0.5 ? AppColors.yellow : AppColors.info,
            ),
          ),
          Center(
            child: Text('${(rate * 100).toInt()}', style: const TextStyle(
              color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w800,
            )),
          ),
        ],
      ),
    );
  }
}

class _CategorySection extends StatelessWidget {
  final ProgressCategory category;
  final String userId;
  final Function(bool) onToggled;
  final bool readOnly;

  const _CategorySection({
    required this.category,
    required this.userId,
    required this.onToggled,
    this.readOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final total = category.items.length;
    final done = category.items.where((i) => provider.isItemCompleted(userId, i.id)).length;
    final catRate = total > 0 ? done / total : 0.0;

    Color subjectColor;
    switch (category.subject) {
      case '数学': subjectColor = AppColors.info; break;
      case '英語': subjectColor = AppColors.success; break;
      case '国語': subjectColor = AppColors.warning; break;
      default: subjectColor = AppColors.silver;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: category.subject,
          subtitle: '$done / $total 完了',
          accentColor: subjectColor,
          trailing: Text('${(catRate * 100).toInt()}%',
              style: TextStyle(color: subjectColor, fontWeight: FontWeight.w800, fontSize: 16)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: AnimatedProgressBar(value: catRate, color: subjectColor, height: 6),
        ),
        const SizedBox(height: 8),
        ...category.items.map((item) => _ProgressItemTile(
          item: item,
          userId: userId,
          onToggled: onToggled,
          readOnly: readOnly,
        )),
        const SizedBox(height: 8),
      ],
    );
  }
}

class _ProgressItemTile extends StatelessWidget {
  final ProgressItem item;
  final String userId;
  final Function(bool) onToggled;
  final bool readOnly;

  const _ProgressItemTile({required this.item, required this.userId, required this.onToggled, this.readOnly = false});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final isCompleted = provider.isItemCompleted(userId, item.id);
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
        leading: readOnly
            // 生徒・保護者：タップ不可・表示のみ
            ? AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCompleted ? AppColors.success : Colors.transparent,
                  border: Border.all(
                    color: isCompleted ? AppColors.success : AppColors.silverDim.withValues(alpha: 0.5),
                    width: 2,
                  ),
                  boxShadow: isCompleted ? [BoxShadow(color: AppColors.success.withValues(alpha: 0.4), blurRadius: 8)] : null,
                ),
                child: isCompleted
                    ? const Icon(Icons.check, color: Colors.white, size: 16)
                    : null,
              )
            // 管理者：タップで完了切り替え可能
            : GestureDetector(
                onTap: () {
                  final wasCompleted = provider.isItemCompleted(userId, item.id);
                  provider.toggleProgress(userId, item.id);
                  onToggled(wasCompleted);
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
                    boxShadow: isCompleted ? [BoxShadow(color: AppColors.success.withValues(alpha: 0.4), blurRadius: 8)] : null,
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
        trailing: _buildStatusChip(item, isCompleted, isOverdue, isDueSoon),
      ),
    );
  }

  Widget? _buildDeadline(ProgressItem item, bool isCompleted) {
    if (item.deadline == null) return null;
    final diff = item.deadline!.difference(DateTime.now()).inDays;
    final color = item.isOverdue ? AppColors.danger : item.isDueSoon ? AppColors.warning : AppColors.textSecondary;
    String text;
    if (isCompleted) {
      text = '✓ 完了';
    } else if (item.isOverdue) {
      text = '期限超過';
    } else {
      text = '残り$diff日';
    }
    return Text(text, style: TextStyle(color: isCompleted ? AppColors.success : color, fontSize: 11));
  }

  Widget? _buildStatusChip(ProgressItem item, bool isCompleted, bool isOverdue, bool isDueSoon) {
    if (isCompleted) {
      return const AppChip(label: '達成 ✦', color: AppColors.success);
    } else if (isOverdue) {
      return const AppChip(label: '期限超過', color: AppColors.danger);
    } else if (isDueSoon) {
      return const AppChip(label: 'まもなく', color: AppColors.warning);
    }
    return null;
  }
}
