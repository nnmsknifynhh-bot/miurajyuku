// ============================================================
// 採点結果の表示部品（生徒・先生 共通）
// ============================================================
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../services/grading_service.dart';
import '../theme/app_theme.dart';

/// 点数の大きな表示
class ScoreHeader extends StatelessWidget {
  final int score;
  final int total;
  const ScoreHeader({super.key, required this.score, required this.total});

  @override
  Widget build(BuildContext context) {
    final rate = total == 0 ? 0.0 : score / total;
    final color = rate >= 0.8
        ? AppColors.success
        : rate >= 0.5
            ? AppColors.warning
            : AppColors.danger;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(children: [
        Icon(Icons.task_alt, color: color, size: 28),
        const SizedBox(width: 10),
        Text('$score', style: TextStyle(color: color, fontSize: 32, fontWeight: FontWeight.w900)),
        Text(' / $total 問 正解',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
        const Spacer(),
        Text('${(rate * 100).round()}%',
            style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

/// 1問ごとの ○× 行。[onToggle] を渡すと先生が ○× を切り替えられる
class GradeItemTile extends StatelessWidget {
  final GradeItem item;
  final VoidCallback? onToggle;
  final String answerLabel;
  const GradeItemTile({super.key, required this.item, this.onToggle, this.answerLabel = 'あなたの答え'});

  @override
  Widget build(BuildContext context) {
    final color = item.correct ? AppColors.success : AppColors.danger;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(
          onTap: onToggle,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color.withValues(alpha: 0.15),
              border: Border.all(color: color, width: 2),
            ),
            alignment: Alignment.center,
            child: Icon(item.correct ? Icons.circle_outlined : Icons.close_rounded, color: color, size: 24),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.number,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            _line(answerLabel, item.studentAnswer, AppColors.silver),
            if (!item.correct) _line('正解', item.correctAnswer, AppColors.success),
            if (!item.correct && item.comment.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(item.comment,
                    style: const TextStyle(color: AppColors.warning, fontSize: 12, height: 1.4)),
              ),
          ]),
        ),
        if (onToggle != null)
          IconButton(
            tooltip: '○×を切り替え',
            icon: const Icon(Icons.swap_horiz, color: AppColors.silverDim, size: 20),
            onPressed: onToggle,
          ),
      ]),
    );
  }

  Widget _line(String label, String value, Color color) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: '$label：', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          TextSpan(text: value, style: TextStyle(color: color, fontSize: 13)),
        ])),
      );
}

/// コメント枠
class CommentBox extends StatelessWidget {
  final String title;
  final String text;
  final IconData icon;
  final Color color;
  const CommentBox(
      {super.key, required this.title, required this.text, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Text(title, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 6),
        Text(text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
      ]),
    );
  }
}

/// 答案写真の横並びサムネイル（タップで拡大）
class PhotoStrip extends StatelessWidget {
  final List<Uint8List>? photos; // null = 読み込み中
  final String? error;
  const PhotoStrip({super.key, required this.photos, this.error});

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Text('写真を読み込めませんでした: $error',
          style: const TextStyle(color: AppColors.danger, fontSize: 12));
    }
    if (photos == null) {
      return const SizedBox(
        height: 120,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: photos!.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) => GestureDetector(
          onTap: () => showPhotoViewer(ctx, photos!, i),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.memory(photos![i], height: 120, fit: BoxFit.cover),
          ),
        ),
      ),
    );
  }
}

void showPhotoViewer(BuildContext context, List<Uint8List> photos, int initial) {
  showDialog(
    context: context,
    barrierColor: Colors.black,
    builder: (ctx) => Stack(children: [
      PageView.builder(
        controller: PageController(initialPage: initial),
        itemCount: photos.length,
        itemBuilder: (_, i) => InteractiveViewer(
          maxScale: 5,
          child: Center(child: Image.memory(photos[i])),
        ),
      ),
      Positioned(
        top: 16,
        right: 16,
        child: SafeArea(
          child: IconButton(
            style: IconButton.styleFrom(backgroundColor: Colors.black54),
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(ctx),
          ),
        ),
      ),
    ]),
  );
}

/// 状態ラベルの色
Color statusColor(String status) {
  switch (status) {
    case HomeworkSubmission.statusReturned:
      return AppColors.success;
    case HomeworkSubmission.statusGraded:
      return AppColors.yellow;
    case HomeworkSubmission.statusError:
      return AppColors.danger;
    default:
      return AppColors.info;
  }
}
