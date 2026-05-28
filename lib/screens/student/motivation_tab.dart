import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../widgets/common_widgets.dart';

class MotivationTab extends StatelessWidget {
  const MotivationTab({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final userId = provider.currentUser?.id ?? '';
    final streak = provider.getStreak(userId);
    final progressRate = provider.getProgressRate(userId);
    final scores = provider.getScoresForStudent(userId);

    // Compute badges
    final badges = _computeBadges(scores, progressRate, streak?.currentStreak ?? 0);

    return SingleChildScrollView(
      child: Column(
        children: [
          const SectionHeader(title: 'モチベーション', subtitle: '毎日積み上げよう'),
          // Streak card
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: _StreakCard(streak: streak),
          ),
          const SizedBox(height: 16),
          // Stats row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(child: StatCard(
                  label: '全体達成率',
                  value: '${(progressRate * 100).toInt()}',
                  unit: '%',
                  icon: Icons.check_circle_outline,
                  valueColor: AppColors.success,
                )),
                const SizedBox(width: 12),
                Expanded(child: StatCard(
                  label: '最高連続記録',
                  value: '${streak?.maxStreak ?? 0}',
                  unit: '日',
                  icon: Icons.local_fire_department,
                  valueColor: AppColors.warning,
                )),
              ],
            ),
          ),
          const SizedBox(height: 24),
          // Badges
          const SectionHeader(title: '獲得バッジ', subtitle: '目標を達成してバッジを集めよう'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: badges.isEmpty
                ? const EmptyState(message: '頑張ってバッジを獲得しよう！', icon: Icons.emoji_events_outlined)
                : _BadgeGrid(badges: badges),
          ),
          const SizedBox(height: 24),
          // Ranking placeholder
          const SectionHeader(title: '今月のランキング', subtitle: '達成数で比較'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: GlowCard(
              child: Column(
                children: [
                  _RankRow(rank: 1, name: provider.currentUser?.name ?? '---', score: (progressRate * 100).toInt(), isMe: true),
                  const Divider(color: AppColors.cardBorder),
                  _RankRow(rank: 2, name: '鈴木 花子', score: 55),
                  const Divider(color: AppColors.cardBorder),
                  _RankRow(rank: 3, name: '佐藤 次郎', score: 42),
                ],
              ),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  List<_BadgeData> _computeBadges(List<dynamic> scores, double rate, int streak) {
    final badges = <_BadgeData>[];

    if (streak >= 7) badges.add(_BadgeData('🔥', '一週間連続', '7日連続達成！'));
    if (streak >= 3) badges.add(_BadgeData('⚡', '3日連続', '連続3日達成'));
    if (rate >= 0.5) badges.add(_BadgeData('🎯', '半分突破', '達成率50%超え'));
    if (rate >= 0.8) badges.add(_BadgeData('🏆', '優秀賞', '達成率80%超え'));

    for (final score in scores) {
      for (final entry in (score.scores as Map).entries) {
        final val = entry.value;
        if (val != null && val >= 90) {
          badges.add(_BadgeData('✦', '90点突破', '${entry.key}で90点超え'));
          break;
        }
      }
    }

    return badges;
  }
}

class _BadgeData {
  final String emoji;
  final String title;
  final String description;
  _BadgeData(this.emoji, this.title, this.description);
}

class _BadgeGrid extends StatelessWidget {
  final List<_BadgeData> badges;
  const _BadgeGrid({required this.badges});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 0.85,
      ),
      itemCount: badges.length,
      itemBuilder: (_, i) {
        final b = badges[i];
        return Container(
          decoration: BoxDecoration(
            gradient: AppGradients.cardGradient,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
            boxShadow: [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.1), blurRadius: 10)],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(b.emoji, style: const TextStyle(fontSize: 32)),
              const SizedBox(height: 6),
              Text(b.title, style: const TextStyle(
                color: AppColors.yellow, fontSize: 12, fontWeight: FontWeight.w700,
              ), textAlign: TextAlign.center),
              const SizedBox(height: 2),
              Text(b.description, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10),
                  textAlign: TextAlign.center),
            ],
          ),
        );
      },
    );
  }
}

class _StreakCard extends StatelessWidget {
  final dynamic streak;
  const _StreakCard({this.streak});

  @override
  Widget build(BuildContext context) {
    final current = streak?.currentStreak ?? 0;
    return GlowCard(
      glowColor: AppColors.warning,
      child: Row(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.warning.withValues(alpha: 0.1),
              border: Border.all(color: AppColors.warning.withValues(alpha: 0.5), width: 2),
            ),
            child: const Center(child: Text('🔥', style: TextStyle(fontSize: 32))),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('連続達成ストリーク', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('$current', style: const TextStyle(
                      color: AppColors.warning, fontSize: 48, fontWeight: FontWeight.w900,
                    )),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 10, left: 4),
                      child: Text('日', style: TextStyle(color: AppColors.textSecondary, fontSize: 16)),
                    ),
                  ],
                ),
                Text(current >= 7 ? '素晴らしい！この調子で！🎉'
                    : current >= 3 ? 'いい感じ！続けよう！'
                    : '毎日続けることが大切！',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RankRow extends StatelessWidget {
  final int rank;
  final String name;
  final int score;
  final bool isMe;

  const _RankRow({required this.rank, required this.name, required this.score, this.isMe = false});

  @override
  Widget build(BuildContext context) {

    final medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : '$rank';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SizedBox(width: 36, child: Text(medal, style: const TextStyle(fontSize: 20), textAlign: TextAlign.center)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(name, style: TextStyle(
              color: isMe ? AppColors.yellow : AppColors.textPrimary,
              fontWeight: isMe ? FontWeight.w700 : FontWeight.w500,
              fontSize: 14,
            )),
          ),
          if (isMe) const AppChip(label: 'あなた', color: AppColors.yellow),
          const SizedBox(width: 8),
          Text('$score%', style: TextStyle(
            color: rank == 1 ? AppColors.yellow : AppColors.textPrimary,
            fontWeight: FontWeight.w700, fontSize: 16,
          )),
        ],
      ),
    );
  }
}
