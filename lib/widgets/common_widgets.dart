import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

// ---- Glowing Card ----
class GlowCard extends StatelessWidget {
  final Widget child;
  final Color glowColor;
  final EdgeInsets? padding;
  final EdgeInsets? margin;
  final VoidCallback? onTap;
  final double borderRadius;

  const GlowCard({
    super.key,
    required this.child,
    this.glowColor = AppColors.yellow,
    this.padding,
    this.margin,
    this.onTap,
    this.borderRadius = 16,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        boxShadow: [
          BoxShadow(
            color: glowColor.withValues(alpha: 0.08),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(borderRadius),
          child: Container(
            padding: padding ?? const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(borderRadius),
              gradient: AppGradients.cardGradient,
              border: Border.all(color: AppColors.cardBorder, width: 1),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

// ---- Score Badge ----
class ScoreBadge extends StatelessWidget {
  final int? score;
  final double fontSize;

  const ScoreBadge({super.key, this.score, this.fontSize = 22});

  Color get _color {
    if (score == null) return AppColors.silverDim;
    if (score! >= 90) return AppColors.yellow;
    if (score! >= 70) return AppColors.silver;
    if (score! >= 50) return AppColors.info;
    return AppColors.danger;
  }

  bool get _isHighScore => score != null && score! >= 90;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _color.withValues(alpha: 0.5)),
        boxShadow: _isHighScore
            ? [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.3), blurRadius: 8)]
            : null,
      ),
      child: Text(
        score?.toString() ?? '-',
        style: TextStyle(
          color: _color,
          fontSize: fontSize,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

// ---- Section Header ----
class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Color accentColor;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    this.accentColor = AppColors.yellow,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 20,
            decoration: BoxDecoration(
              color: accentColor,
              borderRadius: BorderRadius.circular(2),
              boxShadow: [BoxShadow(color: accentColor.withValues(alpha: 0.6), blurRadius: 6)],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                )),
                if (subtitle != null)
                  Text(subtitle!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

// ---- Progress Bar ----
class AnimatedProgressBar extends StatelessWidget {
  final double value; // 0.0 - 1.0
  final Color color;
  final double height;
  final String? label;

  const AnimatedProgressBar({
    super.key,
    required this.value,
    this.color = AppColors.yellow,
    this.height = 8,
    this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              Text('${(value * 100).toInt()}%',
                  style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 4),
        ],
        Container(
          height: height,
          decoration: BoxDecoration(
            color: AppColors.navyCard,
            borderRadius: BorderRadius.circular(height / 2),
          ),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: value.clamp(0.0, 1.0),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(height / 2),
                gradient: LinearGradient(colors: [color, color.withValues(alpha: 0.7)]),
                boxShadow: [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 4)],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ---- Stat Card ----
class StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? unit;
  final Color valueColor;
  final IconData? icon;

  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.unit,
    this.valueColor = AppColors.yellow,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      glowColor: valueColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, color: valueColor, size: 20),
            const SizedBox(height: 8),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(value, style: TextStyle(
                color: valueColor,
                fontSize: 32,
                fontWeight: FontWeight.w800,
              )),
              if (unit != null) Padding(
                padding: const EdgeInsets.only(bottom: 5, left: 4),
                child: Text(unit!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}

// ---- Tag Chip ----
class AppChip extends StatelessWidget {
  final String label;
  final Color color;

  const AppChip({super.key, required this.label, this.color = AppColors.yellow});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

// ---- Loading Indicator ----
class AppLoader extends StatelessWidget {
  const AppLoader({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 3),
    );
  }
}

// ---- Empty State ----
class EmptyState extends StatelessWidget {
  final String message;
  final IconData icon;

  const EmptyState({super.key, required this.message, this.icon = Icons.inbox_outlined});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: AppColors.silverDim, size: 56),
          const SizedBox(height: 16),
          Text(message, style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ],
      ),
    );
  }
}
